/**
 * Motor de dívidas — puro, sem Firebase/React.
 *
 * A ideia central: **dívida é derivada, não declarada**. O saldo devedor de um
 * parcelamento sai da soma das parcelas ainda em aberto, não de um campo que
 * alguém precisa lembrar de atualizar. Isso elimina a classe inteira de bugs de
 * "número desatualizado" e faz o total devido ser sempre verdadeiro.
 *
 * Três fontes alimentam a mesma visão normalizada (`DebtView`):
 *   1. parcelamentos em aberto  (grupos de `installmentGroupId`)
 *   2. dívidas com juros        (coleção `debts`)
 *   3. fatura de cartão aberta  (`computeCardInvoice`)
 */
import { CreditCard, Debt, Transaction } from '../types';
import { computeCardInvoice, parseLocalDate, round2 } from './finance';

export type DebtSource = 'installments' | 'loan' | 'card';

export interface DebtView {
  id: string;
  source: DebtSource;
  name: string;
  balance: number;
  monthlyPayment: number;
  /** % ao mês. `null` significa "taxa não informada" — não é o mesmo que zero. */
  interestRate: number | null;
  dueDay: number;
  installmentsLeft: number | null;
  overdue: boolean;
}

/** Taxa mensal informada pelo usuário para fontes que não têm campo próprio. */
export type DebtMeta = Record<string, { interestRate: number }>;

/** Remove o sufixo "(3/12)" que o cadastro de parcelas acrescenta à descrição. */
export function stripInstallmentSuffix(description: string): string {
  return description.replace(/\s*\(\d+\s*\/\s*\d+\)\s*$/, '').trim();
}

function fromInstallments(
  transactions: Transaction[],
  meta: DebtMeta,
  today: Date
): DebtView[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    if (t.status !== 'pending') continue;
    if (!t.installmentGroupId) continue;
    if (t.recurringGroupId) continue; // despesa fixa recorrente não tem fim: não é dívida
    const list = groups.get(t.installmentGroupId) || [];
    list.push(t);
    groups.set(t.installmentGroupId, list);
  }

  const views: DebtView[] = [];
  for (const [groupId, parcels] of groups) {
    const sorted = [...parcels].sort(
      (a, b) => parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime()
    );
    const next = sorted[0];
    const balance = round2(sorted.reduce((acc, t) => acc + (Number(t.amount) || 0), 0));
    views.push({
      id: groupId,
      source: 'installments',
      name: stripInstallmentSuffix(next.description) || 'Parcelamento',
      balance,
      monthlyPayment: round2(Number(next.amount) || 0),
      interestRate: meta[groupId]?.interestRate ?? null,
      dueDay: parseLocalDate(next.date).getDate(),
      installmentsLeft: sorted.length,
      overdue: parseLocalDate(next.date).getTime() < today.getTime(),
    });
  }
  return views;
}

function fromLoans(debts: Debt[]): DebtView[] {
  return debts
    .map(d => ({
      id: d.id,
      source: 'loan' as const,
      name: d.name,
      balance: round2(Number(d.remainingAmount) || 0),
      monthlyPayment: round2(Number(d.monthlyPayment) || 0),
      interestRate: Number.isFinite(Number(d.interestRate)) ? Number(d.interestRate) : null,
      dueDay: Number(d.dueDate) || 1,
      installmentsLeft: null,
      overdue: false,
    }))
    .filter(v => v.balance > 0);
}

function fromCards(
  cards: CreditCard[],
  transactions: Transaction[],
  meta: DebtMeta,
  today: Date
): DebtView[] {
  const views: DebtView[] = [];
  for (const c of cards) {
    const invoice = computeCardInvoice(c.id, c.closingDay, transactions, today);
    if (invoice <= 0) continue;
    const id = `card:${c.id}`;
    views.push({
      id,
      source: 'card',
      name: `Fatura ${c.name}`,
      balance: round2(invoice),
      // Premissa: a fatura é paga integralmente no vencimento.
      monthlyPayment: round2(invoice),
      interestRate: meta[id]?.interestRate ?? null,
      dueDay: Number(c.dueDay) || 1,
      installmentsLeft: null,
      overdue: false,
    });
  }
  return views;
}

export function collectDebts(
  transactions: Transaction[],
  debts: Debt[],
  cards: CreditCard[],
  meta: DebtMeta = {},
  reference: Date = new Date()
): DebtView[] {
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  return [
    ...fromInstallments(transactions, meta, today),
    ...fromLoans(debts),
    ...fromCards(cards, transactions, meta, today),
  ];
}

export interface RankedDebt extends DebtView {
  /** Quanto essa dívida custa de juros por mês, em reais. `null` se a taxa é desconhecida. */
  monthlyCost: number | null;
  unknownRate: boolean;
}

/**
 * Ordena as dívidas pelo que elas realmente custam por mês (saldo × taxa), não
 * pelo tamanho — a dívida cara e pequena sangra mais que a grande e barata.
 *
 * Dívida sem taxa informada vai para o fim, marcada, para a UI pedir a
 * informação em vez de fingir que o custo é zero e enganar a decisão.
 */
export function rankByCost(views: DebtView[]): RankedDebt[] {
  const ranked: RankedDebt[] = views.map(v => ({
    ...v,
    monthlyCost: v.interestRate === null ? null : round2(v.balance * (v.interestRate / 100)),
    unknownRate: v.interestRate === null,
  }));

  return ranked.sort((a, b) => {
    if (a.unknownRate !== b.unknownRate) return a.unknownRate ? 1 : -1;
    if (a.unknownRate) return b.balance - a.balance;
    return (b.monthlyCost as number) - (a.monthlyCost as number);
  });
}
