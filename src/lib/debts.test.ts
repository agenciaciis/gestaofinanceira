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
