/**
 * Verificação "a fundo" do Relatório: monta um mês realista (receita, despesa de
 * conta, COMPRA NO CARTÃO e uma conta atrasada de outro mês) e confere que todos
 * os motores do relatório batem entre si e com a tela de Lançamentos —
 * principalmente que a compra no cartão NÃO entra no caixa (é paga na fatura).
 */
import { describe, it, expect } from 'vitest';
import { Transaction } from '../types';
import { computeDRE, breakEven } from './dre';
import { periodTotals, verticalAnalysis } from './variance';
import { budgetProgress } from './budgets';
import { totalBalance, isCardExpense } from './finance';

const REF = new Date(2026, 7, 15); // 15/ago/2026

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    description: 'x',
    amount: 0,
    type: 'expense',
    date: '2026-08-10',
    categoryId: 'outros',
    status: 'completed',
    entityId: 'e1',
    ...p,
  } as Transaction;
}

// Cenário de agosto/2026:
const txs: Transaction[] = [
  tx({ type: 'income', amount: 6000, date: '2026-08-05', categoryId: 'venda', accountId: 'a1' }),      // recebido
  tx({ type: 'expense', amount: 1650, date: '2026-08-10', categoryId: 'moradia', accountId: 'a1' }),   // despesa de conta (paga)
  tx({ type: 'expense', amount: 2142.20, date: '2026-08-08', categoryId: 'servicos', cardId: 'c1' }),  // COMPRA NO CARTÃO (fora do caixa)
  tx({ type: 'income', amount: 600, date: '2026-07-20', status: 'pending', accountId: 'a1' }),          // venda ATRASADA de julho
];

describe('Relatório — a compra de cartão fica fora do caixa', () => {
  it('DRE: receita 6000, despesa só a de conta (1650), cartão não entra; resultado 4350', () => {
    const dre = computeDRE(txs, {}, REF);
    expect(dre.receita).toBe(6000);
    expect(dre.despesaFixa + dre.custoVariavel).toBe(1650); // cartão (2142,20) NÃO entrou
    expect(dre.resultado).toBe(4350);
    expect(dre.margemPercent).toBe(100); // sem custo variável classificado
  });

  it('Ponto de equilíbrio = despesa fixa ÷ margem% (com margem 100%, = despesa fixa)', () => {
    const dre = computeDRE(txs, {}, REF);
    expect(breakEven(dre.despesaFixa, dre.margemPercent)).toBe(1650);
  });

  it('Análise vertical/horizontal (periodTotals): despesa 1650, resultado 4350', () => {
    const pt = periodTotals(txs, new Date(2026, 7, 1), new Date(2026, 7, 31));
    expect(pt.receita).toBe(6000);
    expect(pt.despesa).toBe(1650); // cartão fora
    expect(pt.resultado).toBe(4350);
    // Análise vertical: a despesa representa 27,5% da receita (1650/6000).
    expect(verticalAnalysis(pt.despesa, pt.receita)).toBe(27.5);
    expect(verticalAnalysis(pt.receita, pt.receita)).toBe(100);
  });

  it('Orçamento (budgetProgress): gasto de moradia = 1650; cartão não conta no orçado×realizado', () => {
    const linhas = budgetProgress({ moradia: 2000, servicos: 500 }, txs, REF);
    const moradia = linhas.find(l => l.categoryId === 'moradia');
    const servicos = linhas.find(l => l.categoryId === 'servicos');
    expect(moradia?.spent).toBe(1650);
    expect(servicos?.spent).toBe(0); // a compra de cartão em 'servicos' NÃO entra
  });

  it('Sanidade: se a compra fosse de CONTA (não cartão), a despesa subiria para 3792,20', () => {
    const semCartao = txs.map(t => t.cardId ? { ...t, cardId: undefined, accountId: 'a1' } : t);
    const dre = computeDRE(semCartao, {}, REF);
    expect(dre.despesaFixa + dre.custoVariavel).toBe(3792.20); // confirma que a exclusão é o que muda
  });

  it('isCardExpense reconhece só a compra no cartão', () => {
    expect(txs.filter(isCardExpense)).toHaveLength(1);
  });

  it('Saldo das contas ignora cartão (compra no cartão não mexe no banco)', () => {
    const contas = [{ id: 'a1', bankName: 'Banco', initialBalance: 0, entityId: 'e1' } as any];
    // Só a receita 6000 e a despesa 1650 são de conta e concluídas → saldo 4350.
    expect(totalBalance(contas, txs)).toBe(4350);
  });
});
