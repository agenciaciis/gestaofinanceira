import { describe, it, expect } from 'vitest';
import { collectDebts, compareExtraPayment, DebtView, payoffSchedule, rankByCost } from './debts';
import { round2 } from './finance';
import { CreditCard, Debt, Transaction } from '../types';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x', description: 'x', amount: 0, type: 'expense', date: '2026-08-10',
  categoryId: 'c', status: 'pending', entityId: 'e', ...over,
});

describe('collectDebts — parcelamentos', () => {
  it('soma as parcelas pendentes e ignora pagas/canceladas', () => {
    const txs = [
      tx({ id: '1', description: 'Notebook (1/3)', amount: 500, status: 'completed', installmentGroupId: 'g1', installmentNumber: 1, totalInstallments: 3, date: '2026-06-10' }),
      tx({ id: '2', description: 'Notebook (2/3)', amount: 500, status: 'pending', installmentGroupId: 'g1', installmentNumber: 2, totalInstallments: 3, date: '2026-07-10' }),
      tx({ id: '3', description: 'Notebook (3/3)', amount: 500, status: 'pending', installmentGroupId: 'g1', installmentNumber: 3, totalInstallments: 3, date: '2026-08-10' }),
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

const view = (over: Partial<DebtView>): DebtView => ({
  id: 'v', source: 'loan', name: 'V', balance: 1000, monthlyPayment: 100,
  interestRate: 1, dueDay: 10, installmentsLeft: null, overdue: false, ...over,
});

describe('rankByCost', () => {
  it('ordena por custo em reais, não por saldo', () => {
    const ranked = rankByCost([
      view({ id: 'grande', balance: 50000, interestRate: 0.5 }),  // R$ 250/mês
      view({ id: 'cara', balance: 3000, interestRate: 14 }),      // R$ 420/mês
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

describe('payoffSchedule', () => {
  it('quita parcelamento sem juros no número exato de meses', () => {
    const r = payoffSchedule(
      [view({ id: 'p', source: 'installments', balance: 900, monthlyPayment: 300, interestRate: null })],
      0, 'avalanche', new Date(2026, 6, 1)
    );
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
    // mês 1: orçamento 200 → a=100 quita, sobra 100 em b (resta 200)
    // mês 2: orçamento 200 (a liberou a parcela) → b zera
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

describe('collectDebts — compra parcelada NO cartão não é contada em dobro', () => {
  const card = (): CreditCard => ({
    id: 'card1', name: 'Nubank', brand: 'Visa', limit: 5000,
    closingDay: 20, dueDay: 28, color: '#000', entityId: 'e',
  } as CreditCard);

  it('parcelamento no cartão entra só em installments (não soma na fatura)', () => {
    // 3x R$400 no cartão: (1/3) paga, (2/3) e (3/3) pendentes. Uma delas cai no
    // ciclo aberto da fatura. Não pode contar a mesma parcela em installments E na fatura.
    const txs = [
      tx({ id: '1', description: 'TV (1/3)', amount: 400, status: 'completed', cardId: 'card1', installmentGroupId: 'g1', date: '2026-06-10' }),
      tx({ id: '2', description: 'TV (2/3)', amount: 400, status: 'pending', cardId: 'card1', installmentGroupId: 'g1', date: '2026-08-10' }),
      tx({ id: '3', description: 'TV (3/3)', amount: 400, status: 'pending', cardId: 'card1', installmentGroupId: 'g1', date: '2026-09-10' }),
    ];
    const views = collectDebts(txs, [], [card()], {}, new Date(2026, 7, 1));
    const total = round2(views.reduce((s, v) => s + v.balance, 0));
    // Resta 2 parcelas de 400 = 800. Nem mais (dupla contagem), nem menos.
    expect(total).toBe(800);
    // E não deve existir uma dívida de fatura duplicando essas parcelas.
    expect(views.some(v => v.source === 'card')).toBe(false);
    const inst = views.find(v => v.source === 'installments');
    expect(inst?.balance).toBe(800);
  });

  it('gasto avulso no cartão ainda vira dívida de fatura', () => {
    const txs = [
      tx({ id: '1', description: 'Mercado', amount: 250, status: 'pending', cardId: 'card1', date: '2026-08-10' }),
    ];
    const views = collectDebts(txs, [], [card()], {}, new Date(2026, 7, 1));
    expect(views.some(v => v.source === 'card' && v.balance === 250)).toBe(true);
  });
});
