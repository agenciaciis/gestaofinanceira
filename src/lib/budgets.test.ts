import { describe, it, expect } from 'vitest';
import { budgetProgress, exceededBudgets, balanceGoalGap } from './budgets';
import { Transaction } from '../types';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x', description: 'x', amount: 0, type: 'expense', date: '2026-07-10',
  categoryId: 'alimentacao', status: 'completed', entityId: 'e', ...over,
});
const REF = new Date(2026, 6, 15);

describe('budgetProgress', () => {
  const budgets = { alimentacao: 800, transporte: 500, lazer: 0, monthly_balance_goal: 2000 };

  it('compara limite com o gasto do mês', () => {
    const txs = [
      tx({ id: '1', amount: 600 }),
      tx({ id: '2', amount: 250, categoryId: 'transporte' }),
    ];
    const r = budgetProgress(budgets, txs, REF);
    const ali = r.find(l => l.categoryId === 'alimentacao')!;
    expect(ali.spent).toBe(600);
    expect(ali.remaining).toBe(200);
    expect(ali.percent).toBe(75);
    expect(ali.exceeded).toBe(false);
  });

  it('estouro passa de 100% — travar em 100 esconderia o tamanho do problema', () => {
    const r = budgetProgress(budgets, [tx({ id: '1', amount: 1120 })], REF);
    const ali = r.find(l => l.categoryId === 'alimentacao')!;
    expect(ali.percent).toBe(140);
    expect(ali.exceeded).toBe(true);
    expect(ali.remaining).toBe(-320);
  });

  it('ignora limite zero e a meta de sobra, que não é categoria', () => {
    const r = budgetProgress(budgets, [], REF);
    expect(r.map(l => l.categoryId).sort()).toEqual(['alimentacao', 'transporte']);
  });

  it('ignora pendente, cancelado e outro mês', () => {
    const txs = [
      tx({ id: '1', amount: 999, status: 'pending' }),
      tx({ id: '2', amount: 999, status: 'cancelled' }),
      tx({ id: '3', amount: 999, date: '2026-06-10' }),
    ];
    expect(budgetProgress(budgets, txs, REF).find(l => l.categoryId === 'alimentacao')!.spent).toBe(0);
  });

  it('ordena pelo mais crítico primeiro', () => {
    const txs = [tx({ id: '1', amount: 100 }), tx({ id: '2', amount: 490, categoryId: 'transporte' })];
    expect(budgetProgress(budgets, txs, REF)[0].categoryId).toBe('transporte');
  });
});

describe('exceededBudgets', () => {
  it('devolve só as estouradas', () => {
    const linhas = budgetProgress({ alimentacao: 100, transporte: 1000 },
      [tx({ id: '1', amount: 200 })], REF);
    expect(exceededBudgets(linhas).map(l => l.categoryId)).toEqual(['alimentacao']);
  });
});

describe('balanceGoalGap', () => {
  it('diz quanto falta para bater a meta de sobra', () => {
    expect(balanceGoalGap({ monthly_balance_goal: 2000 }, 1500)).toBe(500);
  });
  it('meta batida devolve valor negativo, que significa folga', () => {
    expect(balanceGoalGap({ monthly_balance_goal: 2000 }, 2500)).toBe(-500);
  });
  it('sem meta definida devolve null', () => {
    expect(balanceGoalGap({}, 1500)).toBeNull();
  });
});
