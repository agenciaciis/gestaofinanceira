/**
 * "Posso gastar?" — quanto sobra HOJE sem se enrolar.
 *
 * Puro e testado porque é o número em que o usuário vai confiar para decidir
 * uma compra. A regra é conservadora de propósito: é melhor mostrar menos e a
 * pessoa sobrar dinheiro do que mostrar mais e ela furar o mês.
 *
 * Cuidado central do módulo: **não contar o mesmo compromisso duas vezes**.
 * Despesa lançada no cartão entra só pela fatura; conta em aberto entra só
 * pelas contas a pagar.
 */
import { BankAccount, CreditCard, Transaction } from '../types';
import { computeBalances, computeCardInvoice, parseLocalDate, round2 } from './finance';

/**
 * Categorias que oscilam mês a mês — é o que dá para "não gastar".
 * Moradia, educação e serviços ficam de fora: são fixas, já entram como
 * contas a pagar quando lançadas.
 */
export const VARIABLE_CATEGORY_IDS = ['alimentacao', 'transporte', 'lazer', 'saude', 'outros'];

/** Empréstimo cadastrado cuja parcela do mês precisa ser reservada. */
export interface LoanCommitment {
  id: string;
  name: string;
  monthlyPayment: number;
}

export interface SpendableInput {
  accounts: BankAccount[];
  transactions: Transaction[];
  cards: CreditCard[];
  loans: LoanCommitment[];
  /** Quanto proteger de reserva de emergência. */
  reserve: number;
  reference?: Date;
}

export interface SpendableResult {
  balance: number;
  billsDueThisMonth: number;
  cardInvoices: number;
  loanPayments: number;
  expectedVariable: number;
  reserve: number;
  /** O número da pergunta. Negativo = você já estourou o mês. */
  spendable: number;
  daysLeft: number;
}

/**
 * Média mensal de um tipo de lançamento sobre os meses COMPLETOS anteriores,
 * dividindo pelos meses que têm movimento. Base de `averageMonthlyExpense` e
 * `averageMonthlyIncome`.
 */
function averageMonthlyByType(
  transactions: Transaction[],
  type: 'income' | 'expense',
  reference: Date,
  months: number
): number {
  const count = Math.max(1, Math.floor(months));
  const firstOfCurrent = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const start = new Date(reference.getFullYear(), reference.getMonth() - count, 1);

  let total = 0;
  const monthsWithData = new Set<string>();
  for (const t of transactions) {
    if (t.type !== type || t.status !== 'completed') continue;
    const d = parseLocalDate(t.date);
    if (Number.isNaN(d.getTime())) continue;
    if (d < start || d >= firstOfCurrent) continue;
    total += Number(t.amount) || 0;
    monthsWithData.add(`${d.getFullYear()}-${d.getMonth()}`);
  }

  if (monthsWithData.size === 0) return 0;
  return round2(total / monthsWithData.size);
}

/** Receita média por mês — base para medir comprometimento da renda. */
export function averageMonthlyIncome(
  transactions: Transaction[],
  reference: Date = new Date(),
  months = 3
): number {
  return averageMonthlyByType(transactions, 'income', reference, months);
}

/**
 * Despesa média por mês, olhando só os `months` meses COMPLETOS anteriores.
 * O mês corrente fica de fora porque ainda está pela metade e puxaria a média
 * para baixo.
 *
 * Divide pelos meses que REALMENTE têm movimento, não pela janela fixa: quem
 * usa o sistema há um mês teria a média (e portanto a reserva) subestimada em
 * três vezes — justamente quem menos pode errar para menos.
 */
export function averageMonthlyExpense(
  transactions: Transaction[],
  reference: Date = new Date(),
  months = 3
): number {
  return averageMonthlyByType(transactions, 'expense', reference, months);
}

/**
 * Quanto proteger de reserva.
 *
 * Com dívida em aberto, 1 mês: é o para-choque que impede um imprevisto de
 * virar dívida nova, sem travar dinheiro que renderia menos que o juro da
 * dívida custa. Quitada a dívida, 6 meses.
 */
export function suggestReserve(
  transactions: Transaction[],
  reference: Date = new Date(),
  hasDebt = true
): { months: number; amount: number; monthlyExpense: number } {
  const monthlyExpense = averageMonthlyExpense(transactions, reference, 3);
  const months = hasDebt ? 1 : 6;
  return { months, amount: round2(monthlyExpense * months), monthlyExpense };
}

/**
 * Empréstimos cadastrados que provavelmente JÁ estão lançados como conta a
 * pagar do mês — nesse caso a parcela é descontada duas vezes.
 *
 * Não corrige sozinho de propósito: adivinhar errado esconderia um
 * compromisso real. Avisa e deixa o usuário decidir.
 */
export function detectDuplicateLoanCommitments(
  loans: LoanCommitment[],
  transactions: Transaction[],
  reference: Date = new Date()
): LoanCommitment[] {
  const monthStart = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const monthEnd = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);

  const pendingThisMonth = transactions.filter(t => {
    if (t.type !== 'expense' || t.status !== 'pending' || t.cardId) return false;
    const d = parseLocalDate(t.date);
    return !Number.isNaN(d.getTime()) && d >= monthStart && d < monthEnd;
  });

  return loans.filter(loan => {
    const payment = Number(loan.monthlyPayment) || 0;
    if (payment <= 0) return false;
    return pendingThisMonth.some(t => {
      const amount = Number(t.amount) || 0;
      // Mesmo valor (1% de folga) OU descrição que cita o nome do empréstimo.
      const sameAmount = Math.abs(amount - payment) <= Math.max(0.01, payment * 0.01);
      const nameMentioned =
        loan.name.trim().length > 2 &&
        t.description.toLowerCase().includes(loan.name.trim().toLowerCase());
      return sameAmount || nameMentioned;
    });
  });
}

export function computeSpendable(input: SpendableInput): SpendableResult {
  const reference = input.reference ?? new Date();
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const daysInMonth = endOfMonth.getDate();
  // Conta o dia de hoje: ainda dá para gastar hoje.
  const daysLeft = daysInMonth - today.getDate() + 1;

  const balances = computeBalances(input.accounts, input.transactions);
  const balance = round2(Object.values(balances).reduce((a, v) => a + v, 0));

  // Contas a pagar até o fim do mês. Vencidas contam (continuam devidas).
  // Despesa no cartão NÃO entra aqui — vem pela fatura, senão conta duas vezes.
  let billsDueThisMonth = 0;
  for (const t of input.transactions) {
    if (t.type !== 'expense' || t.status !== 'pending') continue;
    if (t.cardId) continue;
    const d = parseLocalDate(t.date);
    if (Number.isNaN(d.getTime())) continue;
    if (d > endOfMonth) continue;
    billsDueThisMonth = round2(billsDueThisMonth + (Number(t.amount) || 0));
  }

  const cardInvoices = round2(
    input.cards.reduce(
      (acc, c) => acc + computeCardInvoice(c.id, c.closingDay, input.transactions, today),
      0
    )
  );

  const loanPayments = round2(
    input.loans.reduce((acc, l) => acc + (Number(l.monthlyPayment) || 0), 0)
  );

  // Gasto variável que ainda deve acontecer: a média mensal, proporcional aos
  // dias que faltam.
  const variableOnly = input.transactions.filter(t => VARIABLE_CATEGORY_IDS.includes(t.categoryId));
  const monthlyVariable = averageMonthlyExpense(variableOnly, today, 3);
  const expectedVariable = round2((monthlyVariable * daysLeft) / daysInMonth);

  const reserve = round2(Math.max(0, Number(input.reserve) || 0));

  const spendable = round2(
    balance - billsDueThisMonth - cardInvoices - loanPayments - expectedVariable - reserve
  );

  return {
    balance,
    billsDueThisMonth,
    cardInvoices,
    loanPayments,
    expectedVariable,
    reserve,
    spendable,
    daysLeft,
  };
}
