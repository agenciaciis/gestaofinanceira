import { describe, it, expect } from 'vitest';
import { averageMonthlyExpense, averageMonthlyIncome, suggestReserve, computeSpendable } from './spendable';
import { BankAccount, CreditCard, Transaction } from '../types';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x', description: 'x', amount: 0, type: 'expense', date: '2026-07-10',
  categoryId: 'outros', status: 'completed', entityId: 'e', ...over,
});

const acc = (over: Partial<BankAccount>): BankAccount => ({
  id: 'a1', bankName: 'Banco', type: 'corrente', initialBalance: 0, currentBalance: 0, entityId: 'e', ...over,
});

const card = (over: Partial<CreditCard>): CreditCard => ({
  id: 'c1', name: 'Nubank', brand: 'visa', limit: 5000, dueDay: 15, closingDay: 5, entityId: 'e', ...over,
});

// Referência fixa: 15/07/2026 (julho tem 31 dias → 17 dias restantes contando hoje).
const REF = new Date(2026, 6, 15);

describe('averageMonthlyExpense', () => {
  it('faz a média dos meses COMPLETOS anteriores, ignorando o mês corrente', () => {
    const txs = [
      tx({ id: '1', amount: 1000, date: '2026-04-10' }),
      tx({ id: '2', amount: 2000, date: '2026-05-10' }),
      tx({ id: '3', amount: 3000, date: '2026-06-10' }),
      tx({ id: '4', amount: 9999, date: '2026-07-10' }), // mês corrente: fora
    ];
    expect(averageMonthlyExpense(txs, REF, 3)).toBe(2000);
  });

  it('ignora receitas, transferências e lançamentos não concluídos', () => {
    const txs = [
      tx({ id: '1', amount: 1000, date: '2026-06-10' }),
      tx({ id: '2', amount: 5000, date: '2026-06-11', type: 'income' }),
      tx({ id: '3', amount: 5000, date: '2026-06-12', type: 'transfer' }),
      tx({ id: '4', amount: 5000, date: '2026-06-13', status: 'pending' }),
      tx({ id: '5', amount: 5000, date: '2026-06-14', status: 'cancelled' }),
    ];
    expect(averageMonthlyExpense(txs, REF, 1)).toBe(1000);
  });

  it('sem histórico devolve zero, não NaN', () => {
    expect(averageMonthlyExpense([], REF, 3)).toBe(0);
  });
});

describe('averageMonthlyIncome', () => {
  it('faz a média só das receitas concluídas dos meses completos', () => {
    const txs = [
      tx({ id: '1', amount: 8000, date: '2026-05-05', type: 'income' }),
      tx({ id: '2', amount: 12000, date: '2026-06-05', type: 'income' }),
      tx({ id: '3', amount: 9999, date: '2026-06-06', type: 'income', status: 'pending' }),
      tx({ id: '4', amount: 9999, date: '2026-06-07', type: 'expense' }),
      tx({ id: '5', amount: 9999, date: '2026-07-05', type: 'income' }), // mês corrente
    ];
    expect(averageMonthlyIncome(txs, REF, 3)).toBe(10000);
  });

  it('sem receita devolve zero', () => {
    expect(averageMonthlyIncome([], REF, 3)).toBe(0);
  });
});

describe('suggestReserve', () => {
  it('com dívida, protege 1 mês de despesa', () => {
    const txs = [tx({ id: '1', amount: 3000, date: '2026-06-10' })];
    const r = suggestReserve(txs, REF, true);
    expect(r.months).toBe(1);
    expect(r.amount).toBe(3000);
  });

  it('sem dívida, protege 6 meses', () => {
    const txs = [tx({ id: '1', amount: 3000, date: '2026-06-10' })];
    const r = suggestReserve(txs, REF, false);
    expect(r.months).toBe(6);
    expect(r.amount).toBe(18000);
  });
});

describe('computeSpendable', () => {
  const base = {
    accounts: [acc({ initialBalance: 10000 })],
    cards: [],
    loans: [],
    reserve: 0,
    reference: REF,
  };

  it('parte do saldo realizado das contas', () => {
    const r = computeSpendable({ ...base, transactions: [] });
    expect(r.balance).toBe(10000);
    expect(r.spendable).toBe(10000);
  });

  it('desconta as contas a pagar que vencem até o fim do mês', () => {
    const txs = [
      tx({ id: '1', amount: 1500, date: '2026-07-20', status: 'pending', accountId: 'a1' }),
      tx({ id: '2', amount: 9000, date: '2026-08-20', status: 'pending', accountId: 'a1' }), // mês que vem: fora
    ];
    const r = computeSpendable({ ...base, transactions: txs });
    expect(r.billsDueThisMonth).toBe(1500);
    expect(r.spendable).toBe(8500);
  });

  it('conta a pagar VENCIDA continua sendo compromisso', () => {
    const txs = [tx({ id: '1', amount: 500, date: '2026-07-02', status: 'pending', accountId: 'a1' })];
    expect(computeSpendable({ ...base, transactions: txs }).billsDueThisMonth).toBe(500);
  });

  it('não conta duas vezes a despesa no cartão: ela entra só pela fatura', () => {
    // Fechamento dia 5 → o ciclo aberto em 15/07 vai de 05/07 a 05/08.
    const txs = [
      tx({ id: '1', amount: 300, date: '2026-07-08', status: 'pending', cardId: 'c1' }),
      tx({ id: '2', amount: 200, date: '2026-07-09', status: 'completed', cardId: 'c1' }),
    ];
    const r = computeSpendable({ ...base, transactions: txs, cards: [card({})] });
    expect(r.billsDueThisMonth).toBe(0);
    expect(r.cardInvoices).toBe(500);
    expect(r.spendable).toBe(9500);
  });

  it('desconta a parcela de empréstimos cadastrados', () => {
    const r = computeSpendable({ ...base, transactions: [], loans: [{ id: 'l1', name: 'Banco', monthlyPayment: 700 }] });
    expect(r.loanPayments).toBe(700);
    expect(r.spendable).toBe(9300);
  });

  it('desconta a reserva protegida', () => {
    const r = computeSpendable({ ...base, transactions: [], reserve: 2500 });
    expect(r.reserve).toBe(2500);
    expect(r.spendable).toBe(7500);
  });

  it('reserva o gasto variável esperado, proporcional aos dias que faltam', () => {
    // R$ 3.100 de variável em junho (mês completo) → média 3.100.
    // Em 15/07 faltam 17 dias de 31 → 3100 * 17/31 = 1700.
    const txs = [tx({ id: '1', amount: 3100, date: '2026-06-10', categoryId: 'alimentacao' })];
    const r = computeSpendable({ ...base, transactions: txs });
    expect(r.expectedVariable).toBe(1700);
    expect(r.spendable).toBe(8300);
  });

  it('gasto em categoria FIXA não entra na média de variável', () => {
    const txs = [tx({ id: '1', amount: 3100, date: '2026-06-10', categoryId: 'moradia' })];
    expect(computeSpendable({ ...base, transactions: txs }).expectedVariable).toBe(0);
  });

  it('pode ficar negativo — é o alerta de que você já estourou', () => {
    const txs = [tx({ id: '1', amount: 25000, date: '2026-07-20', status: 'pending', accountId: 'a1' })];
    const r = computeSpendable({ ...base, transactions: txs });
    expect(r.spendable).toBe(-15000);
  });

  it('soma tudo de forma auditável: saldo − cada desconto = disponível', () => {
    const txs = [
      tx({ id: '1', amount: 1000, date: '2026-07-20', status: 'pending', accountId: 'a1' }),
      tx({ id: '2', amount: 200, date: '2026-07-03', status: 'completed', cardId: 'c1' }),
      tx({ id: '3', amount: 3100, date: '2026-06-10', categoryId: 'alimentacao' }),
    ];
    const r = computeSpendable({
      ...base, transactions: txs, cards: [card({})],
      loans: [{ id: 'l1', name: 'Banco', monthlyPayment: 700 }], reserve: 1000,
    });
    const soma = r.balance - r.billsDueThisMonth - r.cardInvoices - r.loanPayments - r.expectedVariable - r.reserve;
    expect(r.spendable).toBe(soma);
  });
});
