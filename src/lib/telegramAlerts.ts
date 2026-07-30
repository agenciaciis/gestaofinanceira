/**
 * Seleção e montagem dos alertas do Telegram (função PURA — sem rede/Firestore).
 *
 * O servidor só busca os dados, chama isto para decidir O QUE disparar (com o
 * texto pronto e uma chave de anti-spam por alerta), filtra o que já mandou e
 * envia. Toda a regra de "quando avisar" mora aqui, testável.
 */
import { BankAccount, Transaction } from '../types';
import { computeBalances, parseLocalDate, round2 } from './finance';
import { budgetProgress, BudgetMap } from './budgets';
import { CATEGORIES } from '../constants';

export type AlertKind = 'due' | 'red' | 'budget' | 'summary';

export interface AlertItem {
  /** Chave estável de anti-spam: o servidor guarda as já enviadas. */
  key: string;
  kind: AlertKind;
  entityType: 'PF' | 'PJ';
  /** Texto pronto para enviar (marcado com [PF]/[PJ]). */
  text: string;
}

export interface AlertContext {
  entityName: string;
  entityType: 'PF' | 'PJ';
  accounts: BankAccount[];
  transactions: Transaction[];
  budgets: BudgetMap;
  today: Date;
  /** Avisa contas a vencer em até N dias. Padrão 2. */
  dueDays?: number;
  /** Saldo abaixo disso conta como "vermelho". Padrão 0. */
  balanceFloor?: number;
}

const CAT_NAME: Record<string, string> = Object.fromEntries(CATEGORIES.map(c => [c.id, c.name]));
const fmt = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysBetween = (from: Date, to: Date) => Math.round((midnight(to) - midnight(from)) / 86400000);

/** Alertas por entidade: conta a vencer, saldo no vermelho, orçamento estourado. */
export function selectEntityAlerts(ctx: AlertContext): AlertItem[] {
  const dueDays = ctx.dueDays ?? 2;
  const floor = ctx.balanceFloor ?? 0;
  const tag = ctx.entityType;
  const out: AlertItem[] = [];

  // 1. Conta a vencer (despesa pendente vencendo em <= dueDays, ou já vencida).
  for (const t of ctx.transactions) {
    if (t.status !== 'pending' || t.type !== 'expense') continue;
    const d = parseLocalDate(t.date);
    if (Number.isNaN(d.getTime())) continue;
    const diff = daysBetween(ctx.today, d);
    if (diff > dueDays) continue; // ainda longe: não avisa
    const quando =
      diff < 0 ? `venceu há ${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'dia' : 'dias'}` :
      diff === 0 ? 'vence hoje' :
      diff === 1 ? 'vence amanhã' :
      `vence em ${diff} dias`;
    out.push({
      key: `due:${t.id}`,
      kind: 'due',
      entityType: tag,
      text: `[${tag}] 📅 ${t.description} (${fmt(t.amount)}) ${quando}.`,
    });
  }

  // 2. Saldo no vermelho.
  const balances = computeBalances(ctx.accounts, ctx.transactions);
  for (const acc of ctx.accounts) {
    const saldo = balances[acc.id] ?? 0;
    if (saldo < floor) {
      out.push({
        key: `red:${acc.id}:${ymd(ctx.today)}`,
        kind: 'red',
        entityType: tag,
        text: `[${tag}] 🔴 Conta ${acc.bankName} no vermelho: ${fmt(saldo)}.`,
      });
    }
  }

  // 3. Orçamento estourado (faixa 80% e 100%).
  const ym = `${ctx.today.getFullYear()}${String(ctx.today.getMonth() + 1).padStart(2, '0')}`;
  for (const l of budgetProgress(ctx.budgets, ctx.transactions, ctx.today, 'expense')) {
    const faixa = l.percent >= 100 ? '100' : l.percent >= 80 ? '80' : null;
    if (!faixa) continue;
    const nome = CAT_NAME[l.categoryId] || l.categoryId;
    const text = faixa === '100'
      ? `[${tag}] ⚠️ Orçamento de ${nome} ESTOUROU: ${fmt(l.spent)} de ${fmt(l.limit)} (${Math.round(l.percent)}%).`
      : `[${tag}] 🟡 Orçamento de ${nome} em ${Math.round(l.percent)}%: ${fmt(l.spent)} de ${fmt(l.limit)}.`;
    out.push({ key: `budget:${l.categoryId}:${ym}:${faixa}`, kind: 'budget', entityType: tag, text });
  }

  return out;
}

/** Resumo da semana: entrou, saiu, saldo atual e o que vence nos próximos 7 dias. */
export function buildWeeklySummary(ctx: AlertContext): AlertItem {
  const tag = ctx.entityType;
  const inicio = new Date(ctx.today.getFullYear(), ctx.today.getMonth(), ctx.today.getDate() - 7);
  const fim = new Date(ctx.today.getFullYear(), ctx.today.getMonth(), ctx.today.getDate() + 7);

  let entrou = 0, saiu = 0, aVencer = 0;
  for (const t of ctx.transactions) {
    const d = parseLocalDate(t.date);
    if (Number.isNaN(d.getTime())) continue;
    if (t.status === 'completed' && d >= inicio && d <= ctx.today) {
      if (t.type === 'income') entrou = round2(entrou + (Number(t.amount) || 0));
      else if (t.type === 'expense') saiu = round2(saiu + (Number(t.amount) || 0));
    }
    if (t.status === 'pending' && t.type === 'expense' && d >= ctx.today && d <= fim) {
      aVencer = round2(aVencer + (Number(t.amount) || 0));
    }
  }
  const balances = computeBalances(ctx.accounts, ctx.transactions);
  const saldo = round2(Object.values(balances).reduce((a, v) => a + v, 0));

  const text =
    `[${tag}] 📊 Resumo da semana\n` +
    `Entrou: ${fmt(entrou)}\n` +
    `Saiu: ${fmt(saiu)}\n` +
    `Saldo atual: ${fmt(saldo)}\n` +
    `Vence nos próximos 7 dias: ${fmt(aVencer)}`;
  return { key: `summary:${tag}:${ymd(ctx.today)}`, kind: 'summary', entityType: tag, text };
}

/** Remove os alertas cujas chaves já foram enviadas antes. */
export function filterUnsent(alerts: AlertItem[], sentKeys: Iterable<string>): AlertItem[] {
  const seen = new Set(sentKeys);
  return alerts.filter(a => !seen.has(a.key));
}
