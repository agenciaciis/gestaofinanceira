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

export function collectDebts(
  transactions: Transaction[],
  debts: Debt[],
  cards: CreditCard[],
  meta: DebtMeta = {},
  reference: Date = new Date()
): DebtView[] {
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  return [...fromInstallments(transactions, meta, today)];
}
