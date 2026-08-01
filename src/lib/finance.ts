/**
 * Funções financeiras puras (sem dependência de Firebase/React).
 * Concentram a matemática de dinheiro do sistema para que possa ser testada
 * isoladamente — é aqui que mora o risco financeiro.
 */
import { BankAccount, Transaction } from '../types';

/** Arredonda para 2 casas (centavos), evitando drift de ponto flutuante. */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** `true` se a transação efetivamente movimentou dinheiro (status concluído). */
export function isRealized(t: Pick<Transaction, 'status'>): boolean {
  return t.status === 'completed';
}

/** `true` se a transação NÃO está cancelada (conta para projeções/tendências). */
export function isNotCancelled(t: Pick<Transaction, 'status'>): boolean {
  return t.status !== 'cancelled';
}

/**
 * Converte uma string 'YYYY-MM-DD' em Date no fuso LOCAL (meia-noite local),
 * evitando o bug clássico de `new Date('2026-06-01')` ser interpretado como
 * UTC e "voltar" um dia em fusos negativos (Brasil = UTC-3).
 * Aceita também strings ISO completas (com 'T'), repassando ao Date nativo.
 */
export function parseLocalDate(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date(NaN);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (match) {
    const [, y, m, d] = match;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  return new Date(dateStr);
}

/** Formata um Date como 'YYYY-MM-DD' usando componentes LOCAIS. */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Divide um valor total em `n` parcelas, garantindo que a SOMA das parcelas
 * seja exatamente igual ao total (a última parcela absorve os centavos de resto).
 * Ex.: splitInstallments(1000, 3) => [333.33, 333.33, 333.34]
 */
export function splitInstallments(total: number, n: number): number[] {
  const count = Math.max(1, Math.floor(n));
  const base = round2(total / count);
  const parcels: number[] = [];
  let accumulated = 0;
  for (let i = 0; i < count - 1; i++) {
    parcels.push(base);
    accumulated = round2(accumulated + base);
  }
  parcels.push(round2(total - accumulated));
  return parcels;
}

/**
 * Calcula o saldo ATUAL de cada conta bancária a partir do saldo inicial mais
 * o efeito das transações CONCLUÍDAS. Esta é a fonte da verdade do saldo —
 * o campo `currentBalance` gravado no Firestore não é mais confiável.
 *
 * Regras:
 *  - receita concluída com `accountId`  => + amount na conta
 *  - despesa concluída com `accountId`  => - amount na conta
 *  - transferência concluída            => - amount na origem (accountId) e
 *                                          + amount no destino (toAccountId)
 *  - lançamentos de cartão (cardId, sem accountId) NÃO afetam saldo de conta
 */
export function computeBalances(
  accounts: Pick<BankAccount, 'id' | 'initialBalance'>[],
  transactions: Transaction[]
): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const acc of accounts) {
    balances[acc.id] = Number(acc.initialBalance) || 0;
  }

  for (const t of transactions) {
    if (!isRealized(t)) continue;
    const amount = Number(t.amount) || 0;

    if (t.type === 'transfer') {
      if (t.accountId && t.accountId in balances) {
        balances[t.accountId] = round2(balances[t.accountId] - amount);
      }
      if (t.toAccountId && t.toAccountId in balances) {
        balances[t.toAccountId] = round2(balances[t.toAccountId] + amount);
      }
      continue;
    }

    // Receita/despesa só afetam conta bancária (não cartão).
    if (!t.accountId || !(t.accountId in balances)) continue;
    if (t.type === 'income') {
      balances[t.accountId] = round2(balances[t.accountId] + amount);
    } else if (t.type === 'expense') {
      balances[t.accountId] = round2(balances[t.accountId] - amount);
    }
  }

  return balances;
}

/** Soma total dos saldos calculados de todas as contas. */
export function totalBalance(
  accounts: Pick<BankAccount, 'id' | 'initialBalance'>[],
  transactions: Transaction[]
): number {
  const balances = computeBalances(accounts, transactions);
  return round2(Object.values(balances).reduce((acc, v) => acc + v, 0));
}

/**
 * Uso (fatura em aberto) de um cartão: soma das despesas não-canceladas
 * lançadas no cartão dentro do ciclo de fatura atual, definido pelo dia de
 * fechamento. Se `closingDay` não fizer sentido, cai para o mês corrente.
 */
export function computeCardInvoice(
  cardId: string,
  closingDay: number,
  transactions: Transaction[],
  reference: Date = new Date()
): number {
  const { start, end } = currentInvoiceWindow(closingDay, reference);
  let total = 0;
  for (const t of transactions) {
    if (t.cardId !== cardId) continue;
    if (t.type !== 'expense') continue;
    if (t.status === 'cancelled') continue;
    if (t.settled) continue; // fatura já paga: não conta na fatura atual
    const d = parseLocalDate(t.date);
    if (d >= start && d < end) total = round2(total + (Number(t.amount) || 0));
  }
  return total;
}

/**
 * Dias entre hoje e a PRÓXIMA ocorrência de um dia-do-mês (ex.: vencimento).
 * Respeita o calendário real (meses de 28/30/31 dias), ao contrário da conta
 * antiga que assumia mês fixo de 30 dias e errava na virada de mês.
 * Retorna 0 se o vencimento é hoje.
 */
export function daysUntilDueDay(dueDay: number, reference: Date = new Date()): number {
  const day = Math.min(Math.max(1, Math.floor(dueDay) || 1), 31);
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  let due = new Date(today.getFullYear(), today.getMonth(), day);
  if (due.getTime() < today.getTime()) {
    due = new Date(today.getFullYear(), today.getMonth() + 1, day);
  }
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((due.getTime() - today.getTime()) / MS);
}

/**
 * Janela [start, end) do ciclo de fatura corrente para um dia de fechamento.
 * O ciclo vai do dia seguinte ao fechamento anterior até o fechamento atual.
 */
export function currentInvoiceWindow(
  closingDay: number,
  reference: Date = new Date()
): { start: Date; end: Date } {
  const day = Math.min(Math.max(1, Math.floor(closingDay) || 1), 28);
  const ref = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  // Fechamento deste mês:
  const thisClosing = new Date(ref.getFullYear(), ref.getMonth(), day);
  let end: Date;
  if (ref <= thisClosing) {
    end = thisClosing;
  } else {
    end = new Date(ref.getFullYear(), ref.getMonth() + 1, day);
  }
  const start = new Date(end.getFullYear(), end.getMonth() - 1, day);
  return { start, end };
}

/**
 * Limite UTILIZADO de um cartão: o que está comprometido e ainda não foi pago.
 *
 * Conta a fatura do ciclo aberto mais as parcelas futuras ainda pendentes
 * (elas seguram limite mesmo sem ter fechado). Compras de ciclos já
 * ENCERRADOS ficam de fora — presume-se pagas, e o limite volta.
 *
 * A conta anterior somava todas as despesas do cartão desde sempre, então o
 * "utilizado" só crescia e o "disponível" derretia mês após mês, mesmo com as
 * faturas em dia.
 */
export function computeCardUsage(
  cardId: string,
  closingDay: number,
  transactions: Transaction[],
  reference: Date = new Date()
): number {
  const { start } = currentInvoiceWindow(closingDay, reference);
  let total = 0;
  for (const t of transactions) {
    if (t.cardId !== cardId) continue;
    if (t.type !== 'expense') continue;
    if (t.status === 'cancelled') continue;
    if (t.settled) continue; // fatura paga: libera o limite
    const d = parseLocalDate(t.date);
    if (Number.isNaN(d.getTime())) continue;
    // Do início do ciclo aberto para frente: inclui a fatura atual e o futuro.
    if (d < start) continue;
    total = round2(total + (Number(t.amount) || 0));
  }
  return total;
}
