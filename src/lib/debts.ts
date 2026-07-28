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

export type PayoffStrategy = 'avalanche' | 'snowball';

export interface PayoffResult {
  months: number;
  freedomDate: Date;
  totalInterest: number;
  totalPaid: number;
  /** Dívidas cuja parcela não cobre nem os juros — ficam de fora da simulação. */
  neverEnds: DebtView[];
  /** Ordem de ataque efetiva (ids), da primeira à última. */
  order: string[];
  timeline: { month: number; totalBalance: number; interestPaid: number }[];
}

const MAX_MONTHS = 600; // 50 anos — trava de segurança

interface Simulation {
  months: number;
  totalInterest: number;
  totalPaid: number;
  order: string[];
  uncleared: DebtView[];
  timeline: PayoffResult['timeline'];
}

/** Roda a simulação mês a mês para um conjunto fixo de dívidas. */
function simulate(views: DebtView[], extra: number, strategy: PayoffStrategy): Simulation {
  const active = views
    .filter(v => v.balance > 0)
    .map(v => ({ ...v, remaining: v.balance }));

  const order = [...active]
    .sort((a, b) =>
      strategy === 'avalanche'
        ? (b.interestRate ?? 0) - (a.interestRate ?? 0)
        : a.balance - b.balance
    )
    .map(v => v.id);

  const timeline: PayoffResult['timeline'] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let months = 0;

  while (active.some(d => d.remaining > 0.005) && months < MAX_MONTHS) {
    months++;
    let interestThisMonth = 0;

    // 1. Juros do mês sobre o saldo de cada dívida ainda aberta.
    for (const d of active) {
      if (d.remaining <= 0) continue;
      const rate = (d.interestRate ?? 0) / 100;
      const interest = round2(d.remaining * rate);
      d.remaining = round2(d.remaining + interest);
      interestThisMonth = round2(interestThisMonth + interest);
    }
    totalInterest = round2(totalInterest + interestThisMonth);

    // 2. Orçamento do mês: parcela de TODAS (inclusive as já quitadas — é o que
    //    libera a bola de neve) mais o valor extra.
    let budget = extra;
    for (const d of active) {
      budget = round2(budget + d.monthlyPayment);
    }

    // 3. Paga na ordem de ataque; o que sobrar escorre para a próxima da fila.
    for (const id of order) {
      if (budget <= 0) break;
      const d = active.find(x => x.id === id);
      if (!d || d.remaining <= 0) continue;
      const pay = Math.min(budget, d.remaining);
      d.remaining = round2(d.remaining - pay);
      budget = round2(budget - pay);
      totalPaid = round2(totalPaid + pay);
    }

    timeline.push({
      month: months,
      totalBalance: round2(active.reduce((a, d) => a + Math.max(0, d.remaining), 0)),
      interestPaid: interestThisMonth,
    });
  }

  const uncleared = active
    .filter(d => d.remaining > 0.005)
    .map(({ remaining, ...v }) => v as DebtView);

  return { months, totalInterest, totalPaid, order, uncleared, timeline };
}

/**
 * Simula a quitação de TODAS as dívidas em conjunto, mês a mês.
 *
 * O `extraMonthly` vai inteiro na dívida prioritária; quando ela zera, a
 * parcela dela continua no orçamento e passa a engrossar o ataque à próxima —
 * é o efeito bola de neve de verdade, não só a ordenação.
 *
 * Dívida impagável é detectada **rodando a simulação**, não por uma fórmula
 * ingênua: uma dívida cujos juros passam da própria parcela ainda pode ser
 * quitada pelo pagamento extra e pelas parcelas liberadas das outras. Quando
 * uma realmente não converge, ela é retirada (a mais divergente por vez) e a
 * simulação roda de novo com as demais — assim uma única dívida impagável não
 * contamina o resultado inteiro nem trava o plano das outras.
 */
export function payoffSchedule(
  views: DebtView[],
  extraMonthly: number,
  strategy: PayoffStrategy,
  reference: Date = new Date()
): PayoffResult {
  const extra = Math.max(0, Number(extraMonthly) || 0);
  let pool = views.filter(v => v.balance > 0);
  const neverEnds: DebtView[] = [];

  let sim = simulate(pool, extra, strategy);
  // Retira uma dívida divergente por vez e re-simula até o plano fechar.
  for (let guard = 0; guard <= views.length && sim.uncleared.length > 0; guard++) {
    // A mais divergente: maior sobra de juros por mês sobre a própria parcela.
    const worst = [...sim.uncleared].sort(
      (a, b) =>
        b.balance * ((b.interestRate ?? 0) / 100) - b.monthlyPayment -
        (a.balance * ((a.interestRate ?? 0) / 100) - a.monthlyPayment)
    )[0];
    neverEnds.push(worst);
    pool = pool.filter(v => v.id !== worst.id);
    sim = simulate(pool, extra, strategy);
  }

  // Mês do ÚLTIMO pagamento — é quando a pessoa fica livre, não o mês seguinte.
  const freedomDate = new Date(
    reference.getFullYear(),
    reference.getMonth() + Math.max(0, sim.months - 1),
    1
  );

  return {
    months: sim.months,
    freedomDate,
    totalInterest: sim.totalInterest,
    totalPaid: sim.totalPaid,
    neverEnds,
    order: sim.order,
    timeline: sim.timeline,
  };
}

export interface ExtraComparison {
  monthsSaved: number;
  interestSaved: number;
  baseline: PayoffResult;
  withExtra: PayoffResult;
}

/**
 * Responde "e se eu pagar mais por mês?" comparando as duas simulações.
 * É o número que motiva a decisão: quantos meses a menos e quanto de juros
 * a pessoa deixa de pagar.
 */
export function compareExtraPayment(
  views: DebtView[],
  extraMonthly: number,
  strategy: PayoffStrategy,
  reference: Date = new Date()
): ExtraComparison {
  const baseline = payoffSchedule(views, 0, strategy, reference);
  const withExtra = payoffSchedule(views, extraMonthly, strategy, reference);
  return {
    monthsSaved: Math.max(0, baseline.months - withExtra.months),
    interestSaved: round2(Math.max(0, baseline.totalInterest - withExtra.totalInterest)),
    baseline,
    withExtra,
  };
}
