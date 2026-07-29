import { describe, it, expect } from 'vitest';
import { computeDRE, breakEven, CategoryKindMap } from './dre';
import { Transaction } from '../types';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x', description: 'x', amount: 0, type: 'expense', date: '2026-07-10',
  categoryId: 'outros', status: 'completed', entityId: 'e', ...over,
});

const kinds: CategoryKindMap = {
  servicos: 'variable',      // custo que acompanha a venda
  moradia: 'fixed',          // aluguel do escritório
  investimento: 'investment',
};

const REF = new Date(2026, 6, 15);

describe('computeDRE', () => {
  it('monta a cascata: receita, custo variável, margem, fixa, lucro', () => {
    const txs = [
      tx({ id: '1', type: 'income', amount: 10000, categoryId: 'venda' }),
      tx({ id: '2', type: 'expense', amount: 3000, categoryId: 'servicos' }),
      tx({ id: '3', type: 'expense', amount: 2000, categoryId: 'moradia' }),
      tx({ id: '4', type: 'expense', amount: 1000, categoryId: 'investimento' }),
    ];
    const d = computeDRE(txs, kinds, REF);
    expect(d.receita).toBe(10000);
    expect(d.custoVariavel).toBe(3000);
    expect(d.margemContribuicao).toBe(7000);
    expect(d.margemPercent).toBe(70);
    expect(d.despesaFixa).toBe(2000);
    expect(d.lucroOperacional).toBe(5000);
    expect(d.investimentos).toBe(1000);
    expect(d.resultado).toBe(4000);
  });

  it('categoria sem classificação entra como despesa fixa, o lado conservador', () => {
    // Tratar desconhecido como variável inflaria a margem e o ponto de
    // equilíbrio ficaria otimista demais.
    const txs = [
      tx({ id: '1', type: 'income', amount: 1000, categoryId: 'venda' }),
      tx({ id: '2', type: 'expense', amount: 400, categoryId: 'nunca-classifiquei' }),
    ];
    const d = computeDRE(txs, kinds, REF);
    expect(d.despesaFixa).toBe(400);
    expect(d.custoVariavel).toBe(0);
    expect(d.semClassificacao).toEqual(['nunca-classifiquei']);
  });

  it('ignora pendente, cancelado, transferência e outro mês', () => {
    const txs = [
      tx({ id: '1', type: 'income', amount: 999, status: 'pending' }),
      tx({ id: '2', type: 'income', amount: 999, status: 'cancelled' }),
      tx({ id: '3', type: 'transfer', amount: 999 }),
      tx({ id: '4', type: 'income', amount: 999, date: '2026-06-10' }),
    ];
    const d = computeDRE(txs, kinds, REF);
    expect(d.receita).toBe(0);
  });

  it('movimento interno entre PF e PJ não é receita nem despesa', () => {
    const txs = [
      tx({ id: '1', type: 'income', amount: 5000, crossEntityGroupId: 'g1' }),
      tx({ id: '2', type: 'expense', amount: 5000, crossEntityGroupId: 'g1' }),
    ];
    const d = computeDRE(txs, kinds, REF);
    expect(d.receita).toBe(0);
    expect(d.despesaFixa).toBe(0);
  });

  it('sem receita não divide por zero na margem', () => {
    const d = computeDRE([tx({ id: '1', type: 'expense', amount: 500, categoryId: 'moradia' })], kinds, REF);
    expect(d.receita).toBe(0);
    expect(Number.isFinite(d.margemPercent)).toBe(true);
    expect(d.margemPercent).toBe(0);
  });
});

describe('breakEven', () => {
  it('quanto faturar para cobrir a despesa fixa', () => {
    // fixa 7.000 com margem de 70% => 10.000 de faturamento
    expect(breakEven(7000, 70)).toBe(10000);
  });

  it('margem zero ou negativa: não existe ponto de equilíbrio', () => {
    expect(breakEven(5000, 0)).toBeNull();
    expect(breakEven(5000, -12)).toBeNull();
  });

  it('sem despesa fixa, o equilíbrio é zero', () => {
    expect(breakEven(0, 40)).toBe(0);
  });

  it('arredonda para centavos', () => {
    expect(breakEven(1000, 33)).toBe(3030.3);
  });
});
