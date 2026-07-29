import { describe, it, expect } from 'vitest';
import { plannedOf, computeVariance, periodTotals, verticalAnalysis, horizontalAnalysis } from './variance';
import { Transaction } from '../types';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x', description: 'x', amount: 0, type: 'expense', date: '2026-07-10',
  categoryId: 'outros', status: 'completed', entityId: 'e', ...over,
});

describe('plannedOf', () => {
  it('usa o previsto quando existe', () => {
    expect(plannedOf(tx({ amount: 530, plannedAmount: 500 }))).toBe(500);
  });
  it('sem previsto, cai no real — assim nada fica fora da soma', () => {
    expect(plannedOf(tx({ amount: 530 }))).toBe(530);
  });
  it('previsto zero ou inválido também cai no real', () => {
    expect(plannedOf(tx({ amount: 530, plannedAmount: 0 }))).toBe(530);
    expect(plannedOf(tx({ amount: 530, plannedAmount: NaN }))).toBe(530);
  });
});

describe('computeVariance', () => {
  it('mostra quanto passou do previsto, em valor e em %', () => {
    const v = computeVariance([tx({ amount: 530, plannedAmount: 500 })]);
    expect(v.planned).toBe(500);
    expect(v.actual).toBe(530);
    expect(v.diff).toBe(30);
    expect(v.percent).toBe(6);
  });

  it('gastou menos que o previsto dá diferença negativa', () => {
    expect(computeVariance([tx({ amount: 400, plannedAmount: 500 })]).diff).toBe(-100);
  });

  it('ignora não concluídos', () => {
    const v = computeVariance([tx({ amount: 999, plannedAmount: 999, status: 'pending' })]);
    expect(v.actual).toBe(0);
  });

  it('sem previsão nenhuma, percentual é null em vez de zero enganoso', () => {
    expect(computeVariance([]).percent).toBeNull();
  });
});

describe('periodTotals', () => {
  const txs = [
    tx({ id: '1', type: 'income', amount: 8000, date: '2026-07-05' }),
    tx({ id: '2', type: 'expense', amount: 2000, date: '2026-07-10', categoryId: 'moradia' }),
    tx({ id: '3', type: 'expense', amount: 500, date: '2026-07-20', categoryId: 'moradia' }),
    tx({ id: '4', type: 'expense', amount: 999, date: '2026-08-01' }),           // fora
    tx({ id: '5', type: 'transfer', amount: 999, date: '2026-07-11' }),          // não conta
    tx({ id: '6', type: 'income', amount: 999, date: '2026-07-12', crossEntityGroupId: 'g' }), // interno
  ];

  it('soma o período e agrupa despesa por categoria', () => {
    const r = periodTotals(txs, new Date(2026, 6, 1), new Date(2026, 6, 31));
    expect(r.receita).toBe(8000);
    expect(r.despesa).toBe(2500);
    expect(r.resultado).toBe(5500);
    expect(r.porCategoria.moradia).toBe(2500);
  });

  it('inclui os lançamentos do último dia do período', () => {
    const r = periodTotals([tx({ type: 'income', amount: 100, date: '2026-07-31' })],
      new Date(2026, 6, 1), new Date(2026, 6, 31));
    expect(r.receita).toBe(100);
  });
});

describe('verticalAnalysis', () => {
  it('valor como percentual da receita', () => {
    expect(verticalAnalysis(2500, 10000)).toBe(25);
  });
  it('sem receita devolve null, não Infinity', () => {
    expect(verticalAnalysis(2500, 0)).toBeNull();
  });
});

describe('horizontalAnalysis', () => {
  it('crescimento de um período para o outro', () => {
    expect(horizontalAnalysis(1000, 1200)).toBe(20);
  });
  it('queda vem negativa', () => {
    expect(horizontalAnalysis(1000, 800)).toBe(-20);
  });
  it('partindo de zero devolve null — crescer de zero não tem percentual', () => {
    expect(horizontalAnalysis(0, 500)).toBeNull();
  });
  it('base negativa usa o módulo, para o sinal significar direção', () => {
    expect(horizontalAnalysis(-1000, -500)).toBe(50);
  });
});
