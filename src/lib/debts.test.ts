import { describe, it, expect } from 'vitest';
import { collectDebts, DebtView, rankByCost } from './debts';
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
