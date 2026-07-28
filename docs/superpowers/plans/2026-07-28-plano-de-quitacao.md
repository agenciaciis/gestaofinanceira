# Plano de Quitação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o sistema saber quanto o usuário realmente deve e responder qual dívida atacar primeiro e quando ele fica livre.

**Architecture:** Um módulo puro novo (`src/lib/debts.ts`) deriva a dívida de três fontes — parcelamentos em aberto, dívidas com juros e fatura de cartão — e simula a quitação mês a mês. `FinancialHealth.tsx` deixa de calcular e passa a consumir esse módulo.

**Tech Stack:** TypeScript, Vitest, React 19, Firebase Firestore, date-fns.

## Global Constraints

- Módulo `src/lib/debts.ts` é **puro**: nenhum import de `firebase`, `react` ou `../firebase`.
- Reusa `round2`, `parseLocalDate`, `formatLocalDate` e `computeCardInvoice` de `src/lib/finance.ts` — não reimplementar.
- Todo dinheiro passa por `round2` antes de sair de uma função.
- Testes em `src/lib/debts.test.ts`, Vitest, dados literais, sem mock de Firebase.
- Comentários e strings de UI em português do Brasil, como o resto do repo.
- `npm test`, `npm run lint` e `npm run build` verdes ao fim de cada task.

---

### Task 1: Tipos e derivação de parcelamentos

**Files:**
- Create: `src/lib/debts.ts`
- Test: `src/lib/debts.test.ts`

**Interfaces:**
- Consumes: `Transaction` de `src/types.ts`; `round2`, `parseLocalDate` de `src/lib/finance.ts`
- Produces: `DebtSource`, `DebtView`, `collectDebts(transactions, debts, cards, meta?, reference?)`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { collectDebts } from './debts';
import { Transaction } from '../types';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x', description: 'x', amount: 0, type: 'expense', date: '2026-08-10',
  categoryId: 'c', status: 'pending', entityId: 'e', ...over,
});

describe('collectDebts — parcelamentos', () => {
  it('soma as parcelas pendentes e ignora pagas/canceladas', () => {
    const txs = [
      tx({ id: '1', description: 'Notebook (1/3)', amount: 500, status: 'completed', installmentGroupId: 'g1', installmentNumber: 1, totalInstallments: 3, date: '2026-06-10' }),
      tx({ id: '2', description: 'Notebook (2/3)', amount: 500, status: 'pending',   installmentGroupId: 'g1', installmentNumber: 2, totalInstallments: 3, date: '2026-07-10' }),
      tx({ id: '3', description: 'Notebook (3/3)', amount: 500, status: 'pending',   installmentGroupId: 'g1', installmentNumber: 3, totalInstallments: 3, date: '2026-08-10' }),
      tx({ id: '4', description: 'Cancelada (4/4)', amount: 900, status: 'cancelled', installmentGroupId: 'g1', installmentNumber: 4, totalInstallments: 4, date: '2026-09-10' }),
    ];
    const views = collectDebts(txs, [], [], {}, new Date(2026, 6, 1));
    expect(views).toHaveLength(1);
    expect(views[0].source).toBe('installments');
    expect(views[0].balance).toBe(1000);
    expect(views[0].name).toBe('Notebook');
    expect(views[0].installmentsLeft).toBe(2);
    expect(views[0].interestRate).toBeNull();
  });

  it('usa a próxima parcela a vencer como pagamento mensal e seu dia como vencimento', () => {
    const txs = [
      tx({ id: '2', description: 'Curso (2/3)', amount: 300, installmentGroupId: 'g2', date: '2026-07-15' }),
      tx({ id: '3', description: 'Curso (3/3)', amount: 300, installmentGroupId: 'g2', date: '2026-08-15' }),
    ];
    const views = collectDebts(txs, [], [], {}, new Date(2026, 6, 1));
    expect(views[0].monthlyPayment).toBe(300);
    expect(views[0].dueDay).toBe(15);
  });

  it('marca como atrasada quando há parcela pendente vencida', () => {
    const txs = [tx({ id: '1', description: 'Atrasada (1/2)', amount: 100, installmentGroupId: 'g3', date: '2026-06-01' })];
    const views = collectDebts(txs, [], [], {}, new Date(2026, 6, 1));
    expect(views[0].overdue).toBe(true);
  });

  it('não trata despesa fixa recorrente como dívida', () => {
    const txs = [tx({ id: '1', description: 'Aluguel', amount: 2000, recurringGroupId: 'r1', isRecurring: true })];
    expect(collectDebts(txs, [], [], {}, new Date(2026, 6, 1))).toHaveLength(0);
  });

  it('grupo totalmente pago não gera dívida', () => {
    const txs = [tx({ id: '1', description: 'Quitado (1/1)', amount: 100, status: 'completed', installmentGroupId: 'g4' })];
    expect(collectDebts(txs, [], [], {}, new Date(2026, 6, 1))).toHaveLength(0);
  });

  it('receita parcelada não é dívida', () => {
    const txs = [tx({ id: '1', description: 'A receber (1/2)', amount: 100, type: 'income', installmentGroupId: 'g5' })];
    expect(collectDebts(txs, [], [], {}, new Date(2026, 6, 1))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/debts.test.ts`
Expected: FAIL — `Failed to resolve import "./debts"`

- [ ] **Step 3: Write minimal implementation**

Cria `src/lib/debts.ts` com os tipos e a derivação de parcelamentos:

```ts
import { BankAccount, CreditCard, Debt, Transaction } from '../types';
import { computeCardInvoice, parseLocalDate, round2 } from './finance';

export type DebtSource = 'installments' | 'loan' | 'card';

export interface DebtView {
  id: string;
  source: DebtSource;
  name: string;
  balance: number;
  monthlyPayment: number;
  interestRate: number | null;
  dueDay: number;
  installmentsLeft: number | null;
  overdue: boolean;
}

/** Taxa mensal informada pelo usuário para fontes sem campo próprio. */
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
    if (t.recurringGroupId) continue; // despesa fixa recorrente não é dívida
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/debts.test.ts`
Expected: PASS — 6 testes

- [ ] **Step 5: Commit**

```bash
git add src/lib/debts.ts src/lib/debts.test.ts
git commit -m "feat(dívidas): deriva saldo devedor das parcelas em aberto"
```

---

### Task 2: Dívidas com juros e fatura de cartão

**Files:**
- Modify: `src/lib/debts.ts`
- Test: `src/lib/debts.test.ts`

**Interfaces:**
- Consumes: `collectDebts` da Task 1; `computeCardInvoice` de `src/lib/finance.ts`
- Produces: `collectDebts` agora retorna as três fontes

- [ ] **Step 1: Write the failing test**

```ts
import { Debt, CreditCard } from '../types';

const debt = (over: Partial<Debt>): Debt => ({
  id: 'd1', name: 'Empréstimo', totalAmount: 10000, remainingAmount: 8000,
  interestRate: 2, monthlyPayment: 500, dueDate: 10, entityId: 'e', createdAt: null, ...over,
});

const card = (over: Partial<CreditCard>): CreditCard => ({
  id: 'c1', name: 'Nubank', brand: 'visa', limit: 5000, dueDay: 15, closingDay: 5, entityId: 'e', ...over,
});

describe('collectDebts — juros e cartão', () => {
  it('mapeia dívida com juros preservando taxa zero informada', () => {
    const views = collectDebts([], [debt({}), debt({ id: 'd2', interestRate: 0 })], [], {}, new Date(2026, 6, 1));
    const loans = views.filter(v => v.source === 'loan');
    expect(loans).toHaveLength(2);
    expect(loans[0].balance).toBe(8000);
    expect(loans[0].interestRate).toBe(2);
    expect(loans[1].interestRate).toBe(0); // zero informado ≠ desconhecido
    expect(loans[0].installmentsLeft).toBeNull();
  });

  it('inclui a fatura em aberto do cartão como dívida', () => {
    const txs = [tx({ id: '1', description: 'Mercado', amount: 250, status: 'completed', cardId: 'c1', date: '2026-07-02' })];
    const views = collectDebts(txs, [], [card({})], {}, new Date(2026, 6, 3));
    const cardView = views.find(v => v.source === 'card');
    expect(cardView?.id).toBe('card:c1');
    expect(cardView?.balance).toBe(250);
    expect(cardView?.monthlyPayment).toBe(250);
    expect(cardView?.dueDay).toBe(15);
  });

  it('cartão sem fatura em aberto não vira dívida', () => {
    expect(collectDebts([], [], [card({})], {}, new Date(2026, 6, 3)).filter(v => v.source === 'card')).toHaveLength(0);
  });

  it('aplica taxa informada em debt_meta a parcelamento e cartão', () => {
    const txs = [
      tx({ id: '1', description: 'TV (1/2)', amount: 400, installmentGroupId: 'g9', date: '2026-08-10' }),
      tx({ id: '2', description: 'Posto', amount: 100, status: 'completed', cardId: 'c1', date: '2026-07-02' }),
    ];
    const views = collectDebts(txs, [], [card({})], { g9: { interestRate: 1.5 }, 'card:c1': { interestRate: 12 } }, new Date(2026, 6, 3));
    expect(views.find(v => v.id === 'g9')?.interestRate).toBe(1.5);
    expect(views.find(v => v.id === 'card:c1')?.interestRate).toBe(12);
  });

  it('soma as três fontes no total devido', () => {
    const txs = [
      tx({ id: '1', description: 'TV (1/2)', amount: 400, installmentGroupId: 'g9', date: '2026-08-10' }),
      tx({ id: '2', description: 'Posto', amount: 100, status: 'completed', cardId: 'c1', date: '2026-07-02' }),
    ];
    const views = collectDebts(txs, [debt({})], [card({})], {}, new Date(2026, 6, 3));
    expect(round2(views.reduce((a, v) => a + v.balance, 0))).toBe(8500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/debts.test.ts`
Expected: FAIL — `expected [] to have a length of 2`

- [ ] **Step 3: Write minimal implementation**

Acrescenta as duas fontes e liga em `collectDebts`:

```ts
function fromLoans(debts: Debt[], today: Date): DebtView[] {
  return debts.map(d => ({
    id: d.id,
    source: 'loan' as const,
    name: d.name,
    balance: round2(Number(d.remainingAmount) || 0),
    monthlyPayment: round2(Number(d.monthlyPayment) || 0),
    interestRate: Number.isFinite(Number(d.interestRate)) ? Number(d.interestRate) : null,
    dueDay: Number(d.dueDate) || 1,
    installmentsLeft: null,
    overdue: false,
  })).filter(v => v.balance > 0);
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
      monthlyPayment: round2(invoice),
      interestRate: meta[id]?.interestRate ?? null,
      dueDay: Number(c.dueDay) || 1,
      installmentsLeft: null,
      overdue: false,
    });
  }
  return views;
}
```

E em `collectDebts`:

```ts
  return [
    ...fromInstallments(transactions, meta, today),
    ...fromLoans(debts, today),
    ...fromCards(cards, transactions, meta, today),
  ];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/debts.test.ts`
Expected: PASS — 11 testes

- [ ] **Step 5: Commit**

```bash
git add src/lib/debts.ts src/lib/debts.test.ts
git commit -m "feat(dívidas): fatura de cartão e empréstimos entram no total devido"
```

---

### Task 3: Ranking por custo real

**Files:**
- Modify: `src/lib/debts.ts`
- Test: `src/lib/debts.test.ts`

**Interfaces:**
- Consumes: `DebtView` da Task 1
- Produces: `RankedDebt`, `rankByCost(views): RankedDebt[]`

- [ ] **Step 1: Write the failing test**

```ts
import { rankByCost } from './debts';

const view = (over: Partial<DebtView>): DebtView => ({
  id: 'v', source: 'loan', name: 'V', balance: 1000, monthlyPayment: 100,
  interestRate: 1, dueDay: 10, installmentsLeft: null, overdue: false, ...over,
});

describe('rankByCost', () => {
  it('ordena por custo em reais, não por saldo', () => {
    const ranked = rankByCost([
      view({ id: 'grande', balance: 50000, interestRate: 0.5 }),  // R$ 250/mês
      view({ id: 'cara',   balance: 3000,  interestRate: 14 }),   // R$ 420/mês
    ]);
    expect(ranked.map(r => r.id)).toEqual(['cara', 'grande']);
    expect(ranked[0].monthlyCost).toBe(420);
    expect(ranked[1].monthlyCost).toBe(250);
  });

  it('joga taxa desconhecida para o fim e marca unknownRate', () => {
    const ranked = rankByCost([
      view({ id: 'sem-taxa', interestRate: null, balance: 90000 }),
      view({ id: 'com-taxa', interestRate: 1, balance: 1000 }),
    ]);
    expect(ranked.map(r => r.id)).toEqual(['com-taxa', 'sem-taxa']);
    expect(ranked[1].unknownRate).toBe(true);
    expect(ranked[1].monthlyCost).toBeNull();
    expect(ranked[0].unknownRate).toBe(false);
  });

  it('taxa zero informada não é desconhecida', () => {
    const ranked = rankByCost([view({ id: 'zero', interestRate: 0 })]);
    expect(ranked[0].unknownRate).toBe(false);
    expect(ranked[0].monthlyCost).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/debts.test.ts`
Expected: FAIL — `rankByCost is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
export interface RankedDebt extends DebtView {
  /** Quanto essa dívida custa de juros por mês, em reais. `null` se a taxa é desconhecida. */
  monthlyCost: number | null;
  unknownRate: boolean;
}

/**
 * Ordena as dívidas pelo que elas realmente custam por mês (saldo × taxa),
 * não pelo tamanho. Dívida sem taxa informada vai para o fim, marcada, para a
 * UI pedir a informação em vez de fingir que o custo é zero.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/debts.test.ts`
Expected: PASS — 14 testes

- [ ] **Step 5: Commit**

```bash
git add src/lib/debts.ts src/lib/debts.test.ts
git commit -m "feat(dívidas): ranking de ataque por custo real em R\$/mês"
```

---

### Task 4: Simulação de quitação

**Files:**
- Modify: `src/lib/debts.ts`
- Test: `src/lib/debts.test.ts`

**Interfaces:**
- Consumes: `DebtView` da Task 1
- Produces: `PayoffStrategy`, `PayoffResult`, `payoffSchedule(views, extraMonthly, strategy, reference?)`

- [ ] **Step 1: Write the failing test**

```ts
import { payoffSchedule } from './debts';

describe('payoffSchedule', () => {
  it('quita parcelamento sem juros no número exato de meses', () => {
    const r = payoffSchedule([view({ id: 'p', source: 'installments', balance: 900, monthlyPayment: 300, interestRate: null })], 0, 'avalanche', new Date(2026, 6, 1));
    expect(r.months).toBe(3);
    expect(r.totalInterest).toBe(0);
    expect(r.neverEnds).toHaveLength(0);
    expect(r.freedomDate.getFullYear()).toBe(2026);
    expect(r.freedomDate.getMonth()).toBe(8); // setembro (0-indexed)
  });

  it('cobra juros sobre o saldo de empréstimo', () => {
    const r = payoffSchedule([view({ balance: 1000, monthlyPayment: 200, interestRate: 1 })], 0, 'avalanche', new Date(2026, 6, 1));
    expect(r.totalInterest).toBeGreaterThan(0);
    expect(r.months).toBeGreaterThan(5);
  });

  it('avalanche ataca a de maior juros; bola de neve, a de menor saldo', () => {
    const debts = [
      view({ id: 'juros-alto', balance: 2000, monthlyPayment: 100, interestRate: 10 }),
      view({ id: 'saldo-baixo', balance: 300, monthlyPayment: 100, interestRate: 1 }),
    ];
    const av = payoffSchedule(debts, 500, 'avalanche', new Date(2026, 6, 1));
    const sn = payoffSchedule(debts, 500, 'snowball', new Date(2026, 6, 1));
    expect(av.order[0]).toBe('juros-alto');
    expect(sn.order[0]).toBe('saldo-baixo');
    expect(av.totalInterest).toBeLessThan(sn.totalInterest);
  });

  it('libera a parcela da dívida quitada para a próxima (bola de neve real)', () => {
    const semLiberacao = payoffSchedule([view({ id: 'a', balance: 100, monthlyPayment: 100, interestRate: 0 })], 0, 'avalanche', new Date(2026, 6, 1));
    const comDuas = payoffSchedule([
      view({ id: 'a', balance: 100, monthlyPayment: 100, interestRate: 0 }),
      view({ id: 'b', balance: 300, monthlyPayment: 100, interestRate: 0 }),
    ], 0, 'snowball', new Date(2026, 6, 1));
    expect(semLiberacao.months).toBe(1);
    // mês 1: a=100 quita, b=100 → resta 200; mês 2: b recebe 100+100 liberados → resta 0
    expect(comDuas.months).toBe(2);
  });

  it('isola dívida impagável em neverEnds sem contaminar as demais', () => {
    const r = payoffSchedule([
      view({ id: 'impagavel', balance: 10000, monthlyPayment: 50, interestRate: 10 }),
      view({ id: 'ok', balance: 300, monthlyPayment: 300, interestRate: 0 }),
    ], 0, 'avalanche', new Date(2026, 6, 1));
    expect(r.neverEnds.map(d => d.id)).toEqual(['impagavel']);
    expect(r.months).toBe(1);
    expect(Number.isFinite(r.totalInterest)).toBe(true);
  });

  it('lista vazia devolve resultado zerado, não NaN', () => {
    const r = payoffSchedule([], 0, 'avalanche', new Date(2026, 6, 1));
    expect(r.months).toBe(0);
    expect(r.totalInterest).toBe(0);
    expect(r.timeline).toHaveLength(0);
  });

  it('não paga além do saldo e o extra sobra para a próxima', () => {
    const r = payoffSchedule([
      view({ id: 'a', balance: 50, monthlyPayment: 100, interestRate: 0 }),
      view({ id: 'b', balance: 50, monthlyPayment: 100, interestRate: 0 }),
    ], 0, 'avalanche', new Date(2026, 6, 1));
    expect(r.months).toBe(1);
    expect(r.totalPaid).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/debts.test.ts`
Expected: FAIL — `payoffSchedule is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
export type PayoffStrategy = 'avalanche' | 'snowball';

export interface PayoffResult {
  months: number;
  freedomDate: Date;
  totalInterest: number;
  totalPaid: number;
  /** Dívidas cuja parcela não cobre nem os juros — não entram na simulação. */
  neverEnds: DebtView[];
  /** Ordem de ataque efetiva (ids), da primeira à última. */
  order: string[];
  timeline: { month: number; totalBalance: number; interestPaid: number }[];
}

const MAX_MONTHS = 600; // 50 anos — trava de segurança

/**
 * Simula a quitação de todas as dívidas em conjunto, mês a mês.
 * O `extraMonthly` vai inteiro na dívida prioritária; quando ela zera, a
 * parcela dela é liberada e passa a engrossar o extra (bola de neve real).
 */
export function payoffSchedule(
  views: DebtView[],
  extraMonthly: number,
  strategy: PayoffStrategy,
  reference: Date = new Date()
): PayoffResult {
  const neverEnds = views.filter(v => {
    const rate = (v.interestRate ?? 0) / 100;
    return v.monthlyPayment <= 0 || (rate > 0 && v.balance * rate >= v.monthlyPayment);
  });
  const neverIds = new Set(neverEnds.map(v => v.id));

  const active = views
    .filter(v => !neverIds.has(v.id) && v.balance > 0)
    .map(v => ({ ...v, remaining: v.balance }));

  const order = [...active].sort((a, b) =>
    strategy === 'avalanche'
      ? (b.interestRate ?? 0) - (a.interestRate ?? 0)
      : a.balance - b.balance
  ).map(v => v.id);

  const timeline: PayoffResult['timeline'] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let months = 0;
  const extra = Math.max(0, Number(extraMonthly) || 0);

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

    // 2. Orçamento do mês: parcelas de todas + extra + parcelas já liberadas.
    let budget = extra;
    for (const d of active) {
      budget = round2(budget + d.monthlyPayment);
    }

    // 3. Paga na ordem de ataque; sobra escorre para a próxima.
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

  const freedomDate = new Date(reference.getFullYear(), reference.getMonth() + months, 1);

  return { months, freedomDate, totalInterest, totalPaid, neverEnds, order, timeline };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/debts.test.ts`
Expected: PASS — 21 testes

- [ ] **Step 5: Commit**

```bash
git add src/lib/debts.ts src/lib/debts.test.ts
git commit -m "feat(dívidas): simulação de quitação com avalanche e bola de neve"
```

---

### Task 5: Comparação do pagamento extra

**Files:**
- Modify: `src/lib/debts.ts`
- Test: `src/lib/debts.test.ts`

**Interfaces:**
- Consumes: `payoffSchedule` da Task 4
- Produces: `ExtraComparison`, `compareExtraPayment(views, extraMonthly, strategy, reference?)`

- [ ] **Step 1: Write the failing test**

```ts
import { compareExtraPayment } from './debts';

describe('compareExtraPayment', () => {
  it('mostra meses e juros economizados com o pagamento extra', () => {
    const debts = [view({ balance: 5000, monthlyPayment: 300, interestRate: 2 })];
    const c = compareExtraPayment(debts, 300, 'avalanche', new Date(2026, 6, 1));
    expect(c.monthsSaved).toBeGreaterThan(0);
    expect(c.interestSaved).toBeGreaterThan(0);
    expect(c.withExtra.months).toBeLessThan(c.baseline.months);
  });

  it('extra zero não economiza nada', () => {
    const c = compareExtraPayment([view({ balance: 900, monthlyPayment: 300, interestRate: 0 })], 0, 'avalanche', new Date(2026, 6, 1));
    expect(c.monthsSaved).toBe(0);
    expect(c.interestSaved).toBe(0);
  });

  it('extra maior economiza mais', () => {
    const debts = [view({ balance: 8000, monthlyPayment: 400, interestRate: 3 })];
    const pouco = compareExtraPayment(debts, 100, 'avalanche', new Date(2026, 6, 1));
    const muito = compareExtraPayment(debts, 800, 'avalanche', new Date(2026, 6, 1));
    expect(muito.monthsSaved).toBeGreaterThan(pouco.monthsSaved);
    expect(muito.interestSaved).toBeGreaterThan(pouco.interestSaved);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/debts.test.ts`
Expected: FAIL — `compareExtraPayment is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ExtraComparison {
  monthsSaved: number;
  interestSaved: number;
  baseline: PayoffResult;
  withExtra: PayoffResult;
}

/**
 * Responde "e se eu pagar mais por mês?" comparando a simulação com e sem o
 * valor extra. É o número que motiva a decisão.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/debts.test.ts`
Expected: PASS — 24 testes

- [ ] **Step 5: Commit**

```bash
git add src/lib/debts.ts src/lib/debts.test.ts
git commit -m "feat(dívidas): comparação de quanto o pagamento extra economiza"
```

---

### Task 6: Regra do Firestore para `debt_meta`

**Files:**
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: helpers existentes `isEntityWriter` / leitura de colaborador
- Produces: subcoleção `entities/{entityId}/debt_meta/{docId}` gravável

- [ ] **Step 1: Ler as regras existentes**

Run: `grep -n "match /entities" -A 6 firestore.rules`
Objetivo: copiar exatamente o molde usado por `debts`, sem inventar helper novo.

- [ ] **Step 2: Acrescentar a regra**

Adiciona um bloco `match /debt_meta/{docId}` espelhando o de `debts` (mesma condição de leitura para colaborador, mesma condição de escrita `isEntityWriter`).

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "chore(rules): permite gravar taxa informada em debt_meta"
```

Nota: a regra só passa a valer após `firebase deploy --only firestore:rules`.

---

### Task 7: Tela do Plano de Quitação

**Files:**
- Modify: `src/pages/FinancialHealth.tsx`

**Interfaces:**
- Consumes: `collectDebts`, `rankByCost`, `payoffSchedule`, `compareExtraPayment`, `DebtView`, `RankedDebt`, `PayoffStrategy` de `src/lib/debts.ts`
- Produces: nada (folha da árvore)

- [ ] **Step 1: Carregar as fontes que faltam**

A página já assina `debts`, `transactions` e `accounts`. Acrescentar dois `onSnapshot`: `credit_cards` (para a fatura) e `debt_meta` (para as taxas informadas), no mesmo padrão dos existentes, com cleanup no `return`.

- [ ] **Step 2: Trocar o cálculo local pelo módulo**

Substituir os `useMemo` de `totalDebt` e `debtStats` e **remover** a função local `calculatePayoff`. Novos memos:

```ts
const debtViews = useMemo(
  () => collectDebts(transactions, debts, cards, debtMeta),
  [transactions, debts, cards, debtMeta]
);
const ranked = useMemo(() => rankByCost(debtViews), [debtViews]);
const totalDebt = useMemo(() => round2(debtViews.reduce((a, v) => a + v.balance, 0)), [debtViews]);
const comparison = useMemo(
  () => compareExtraPayment(debtViews, Number(extraPayment) || 0, strategy),
  [debtViews, extraPayment, strategy]
);
```

Estado novo: `const [extraPayment, setExtraPayment] = useState('')` e
`const [strategy, setStrategy] = useState<PayoffStrategy>('avalanche')`.

- [ ] **Step 3: Total devido com quebra por fonte**

No cabeçalho, exibir `totalDebt` e abaixo três linhas: parcelamentos, dívidas com juros e fatura de cartão, cada uma com o subtotal daquela `source`.

- [ ] **Step 4: Seção "Qual atacar primeiro"**

Lista de `ranked`. Cada linha: nome, saldo, e o custo mensal em R$ (`monthlyCost`). Linha com `unknownRate` exibe o aviso "⚠️ taxa não informada" e um input numérico de taxa mensal que, ao salvar, grava em `debts/{id}` quando `source === 'loan'` e em `debt_meta/{view.id}` nos demais casos (`setDoc` com `merge: true`).

- [ ] **Step 5: Seção "Quando eu fico livre"**

Exibir `comparison.withExtra.freedomDate` formatada com `format(date, "MMMM 'de' yyyy", { locale: ptBR })` e `comparison.withExtra.totalInterest`. Toggle avalanche × bola de neve alterando `strategy`. Input do valor extra alterando `extraPayment`, com a frase de resultado montada a partir de `monthsSaved` e `interestSaved`. Se `neverEnds.length > 0`, um aviso listando as dívidas cuja parcela não cobre os juros.

- [ ] **Step 6: Verificar tudo**

```bash
npm test && npm run lint && npm run build
```
Expected: 24+ testes passando, tsc sem erro, build exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/pages/FinancialHealth.tsx
git commit -m "feat(saúde financeira): tela do Plano de Quitação"
```

---

## Self-Review

**Cobertura da spec:**
- Fonte única de verdade (3 fontes) → Tasks 1 e 2 ✓
- `rankByCost` com `unknownRate` → Task 3 ✓
- `payoffSchedule` com `neverEnds` e liberação de parcela → Task 4 ✓
- `compareExtraPayment` → Task 5 ✓
- `debt_meta` + `firestore.rules` → Tasks 2 (leitura) e 6 (regra) ✓
- UI do Plano de Quitação, remoção de `calculatePayoff` → Task 7 ✓
- Testes obrigatórios da spec → distribuídos nas Tasks 1-5 ✓

**Consistência de tipos:** `DebtView` definido na Task 1 é usado sem alteração nas Tasks 3-5. `RankedDebt` estende `DebtView`. `PayoffResult.order` (Task 4) é consumido pelo teste da mesma task e pela UI na Task 7. Nomes conferem.
