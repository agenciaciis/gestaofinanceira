import { describe, it, expect } from 'vitest';
import { computeGoalProgress, monthlyNeeded, goalForecast, goalStatus } from './goals';
import { Goal, Transaction } from '../types';

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1', name: 'Praia', targetAmount: 5000, entityId: 'pf', createdAt: null, ...over,
});

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x', description: 'Depósito', amount: 0, type: 'transfer', date: '2026-07-10',
  categoryId: 'transferencia', status: 'completed', entityId: 'pf', ...over,
});

const REF = new Date(2026, 6, 15); // 15/07/2026

describe('computeGoalProgress', () => {
  it('soma os depósitos marcados com a meta', () => {
    const txs = [
      tx({ id: '1', amount: 500, goalId: 'g1' }),
      tx({ id: '2', amount: 300, goalId: 'g1' }),
      tx({ id: '3', amount: 900, goalId: 'outra-meta' }),
      tx({ id: '4', amount: 700 }),
    ];
    const p = computeGoalProgress(goal(), txs);
    expect(p.saved).toBe(800);
    expect(p.remaining).toBe(4200);
    expect(p.percent).toBeCloseTo(16, 1);
    expect(p.complete).toBe(false);
  });

  it('resgate (receita marcada com a meta) DIMINUI o guardado', () => {
    const txs = [
      tx({ id: '1', amount: 1000, goalId: 'g1' }),
      tx({ id: '2', amount: 400, goalId: 'g1', type: 'income' }),
    ];
    expect(computeGoalProgress(goal(), txs).saved).toBe(600);
  });

  it('ignora pendentes e cancelados: só conta o que saiu do bolso', () => {
    const txs = [
      tx({ id: '1', amount: 1000, goalId: 'g1' }),
      tx({ id: '2', amount: 5000, goalId: 'g1', status: 'pending' }),
      tx({ id: '3', amount: 5000, goalId: 'g1', status: 'cancelled' }),
    ];
    expect(computeGoalProgress(goal(), txs).saved).toBe(1000);
  });

  it('meta batida trava em 100% e não fica com restante negativo', () => {
    const txs = [tx({ id: '1', amount: 6000, goalId: 'g1' })];
    const p = computeGoalProgress(goal(), txs);
    expect(p.percent).toBe(100);
    expect(p.remaining).toBe(0);
    expect(p.complete).toBe(true);
    expect(p.saved).toBe(6000); // guardou mais que a meta, e isso aparece
  });

  it('meta com alvo zero não estoura em divisão por zero', () => {
    const p = computeGoalProgress(goal({ targetAmount: 0 }), []);
    expect(Number.isFinite(p.percent)).toBe(true);
    expect(p.percent).toBe(0);
  });
});

describe('monthlyNeeded', () => {
  it('divide o que falta pelos meses até o prazo', () => {
    // de 15/07 até 31/12 => 6 meses (jul..dez)
    expect(monthlyNeeded(3000, '2026-12-31', REF)).toBe(500);
  });

  it('prazo neste mês exige o valor inteiro de uma vez', () => {
    expect(monthlyNeeded(1200, '2026-07-31', REF)).toBe(1200);
  });

  it('prazo já vencido devolve o que falta, sem valor negativo de meses', () => {
    expect(monthlyNeeded(800, '2026-01-31', REF)).toBe(800);
  });

  it('sem prazo devolve null — não dá para exigir ritmo sem data', () => {
    expect(monthlyNeeded(800, undefined, REF)).toBeNull();
  });

  it('nada faltando não exige nada', () => {
    expect(monthlyNeeded(0, '2026-12-31', REF)).toBe(0);
  });
});

describe('goalForecast', () => {
  it('projeta pelo ritmo real dos últimos meses', () => {
    const txs = [
      tx({ id: '1', amount: 500, goalId: 'g1', date: '2026-05-10' }),
      tx({ id: '2', amount: 500, goalId: 'g1', date: '2026-06-10' }),
    ];
    const f = goalForecast(goal({ targetAmount: 3000 }), txs, REF);
    expect(f.monthlyPace).toBe(500);
    // faltam 2000, no ritmo de 500/mês => 4 meses
    expect(f.monthsToFinish).toBe(4);
    expect(f.finishDate?.getFullYear()).toBe(2026);
  });

  it('sem ritmo nenhum não inventa data de chegada', () => {
    const f = goalForecast(goal(), [], REF);
    expect(f.monthlyPace).toBe(0);
    expect(f.monthsToFinish).toBeNull();
    expect(f.finishDate).toBeNull();
  });

  it('meta já batida chega em zero meses', () => {
    const txs = [tx({ id: '1', amount: 9000, goalId: 'g1', date: '2026-06-10' })];
    const f = goalForecast(goal(), txs, REF);
    expect(f.monthsToFinish).toBe(0);
  });
});

describe('goalStatus', () => {
  it('sem prazo é apenas em andamento', () => {
    expect(goalStatus(goal(), 1000, REF)).toBe('em-andamento');
  });

  it('meta batida é concluída, mesmo com prazo estourado', () => {
    expect(goalStatus(goal({ deadline: '2026-01-01' }), 5000, REF)).toBe('concluida');
  });

  it('prazo vencido sem bater a meta é atrasada', () => {
    expect(goalStatus(goal({ deadline: '2026-01-01' }), 100, REF)).toBe('atrasada');
  });

  it('dentro do prazo é em andamento', () => {
    expect(goalStatus(goal({ deadline: '2026-12-31' }), 100, REF)).toBe('em-andamento');
  });
});
