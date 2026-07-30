import { describe, it, expect } from 'vitest';
import { itemGross, quoteTotals, quoteInstallments, quotePipeline, partyTotals, serviceMargin } from './quotes';
import { Transaction } from '../types';

const item = (q: number, p: number, d = 0) => ({ quantity: q, unitPrice: p, discount: d });

describe('itemGross', () => {
  it('multiplica quantidade por preço', () => {
    expect(itemGross(item(3, 250))).toBe(750);
  });
  it('valor inválido vira zero em vez de NaN no PDF do cliente', () => {
    expect(itemGross({ quantity: NaN, unitPrice: 100 })).toBe(0);
    expect(itemGross({ quantity: 2, unitPrice: undefined as any })).toBe(0);
  });
  it('quantidade negativa não gera crédito acidental', () => {
    expect(itemGross(item(-5, 100))).toBe(0);
  });
});

describe('quoteTotals', () => {
  it('soma itens e aplica o desconto UMA vez', () => {
    const r = quoteTotals([item(2, 500, 100), item(1, 300)]);
    expect(r.subtotal).toBe(1300);
    expect(r.discountTotal).toBe(100);
    expect(r.total).toBe(1200);
  });
  it('desconto maior que o subtotal zera, não inverte o sinal', () => {
    const r = quoteTotals([item(1, 100, 500)]);
    expect(r.total).toBe(0);
  });
  it('orçamento vazio é tudo zero', () => {
    expect(quoteTotals([])).toEqual({ subtotal: 0, discountTotal: 0, total: 0 });
  });
});

describe('quoteInstallments', () => {
  it('as parcelas somam exatamente o total', () => {
    const p = quoteInstallments(1000, 3);
    expect(p).toHaveLength(3);
    expect(p.reduce((a, v) => a + v, 0)).toBe(1000);
  });
  it('uma parcela é o total', () => {
    expect(quoteInstallments(750, 1)).toEqual([750]);
  });
});

describe('quotePipeline', () => {
  const qs = [
    { status: 'draft' as const, total: 1000 },
    { status: 'sent' as const, total: 2000 },
    { status: 'approved' as const, total: 5000 },
    { status: 'converted' as const, total: 3000 },
    { status: 'rejected' as const, total: 4000 },
  ];

  it('separa o que está em jogo do que foi ganho e perdido', () => {
    const r = quotePipeline(qs);
    expect(r.emAberto).toBe(3000);
    expect(r.ganho).toBe(8000);
    expect(r.perdido).toBe(4000);
  });

  it('taxa de aprovação usa só os decididos, ignorando rascunho e enviado', () => {
    expect(quotePipeline(qs).taxaAprovacao).toBe(round(2 / 3 * 100));
  });

  it('sem nenhum decidido, a taxa é null em vez de zero enganoso', () => {
    expect(quotePipeline([{ status: 'draft' as const, total: 100 }]).taxaAprovacao).toBeNull();
  });
});
function round(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }

describe('partyTotals', () => {
  const tx = (over: Partial<Transaction>): Transaction => ({
    id: 'x', description: 'x', amount: 0, type: 'income', date: '2026-07-10',
    categoryId: 'venda', status: 'completed', entityId: 'e', ...over,
  });

  it('separa realizado de previsto — juntar faria parecer dinheiro que não entrou', () => {
    const txs = [
      tx({ id: '1', amount: 5000, clientId: 'c1' }),
      tx({ id: '2', amount: 2000, clientId: 'c1', status: 'pending' }),
      tx({ id: '3', amount: 800, clientId: 'c1', type: 'expense' }),
      tx({ id: '4', amount: 300, clientId: 'c1', type: 'expense', status: 'pending' }),
      tx({ id: '5', amount: 9999, clientId: 'outro' }),
      tx({ id: '6', amount: 9999, clientId: 'c1', status: 'cancelled' }),
    ];
    expect(partyTotals(txs, 'c1')).toEqual({ recebido: 5000, aReceber: 2000, pago: 800, aPagar: 300 });
  });

  it('respeita o período quando informado', () => {
    const txs = [
      tx({ id: '1', amount: 100, clientId: 'c1', date: '2026-07-10' }),
      tx({ id: '2', amount: 900, clientId: 'c1', date: '2026-08-10' }),
    ];
    const r = partyTotals(txs, 'c1', new Date(2026, 6, 1), new Date(2026, 6, 31));
    expect(r.recebido).toBe(100);
  });
});

describe('serviceMargin', () => {
  it('margem em valor, em % e por hora', () => {
    const r = serviceMargin(2000, 800, 20);
    expect(r.margem).toBe(1200);
    expect(r.margemPercent).toBe(60);
    expect(r.valorHora).toBe(100);
  });
  it('sem custo informado, a margem é o preço inteiro', () => {
    expect(serviceMargin(1000).margemPercent).toBe(100);
  });
  it('preço zero não divide por zero', () => {
    expect(serviceMargin(0, 500).margemPercent).toBe(0);
  });
  it('sem horas, não inventa valor por hora', () => {
    expect(serviceMargin(1000, 400).valorHora).toBeNull();
  });
  it('custo acima do preço mostra margem negativa — é prejuízo e precisa aparecer', () => {
    const r = serviceMargin(1000, 1500);
    expect(r.margem).toBe(-500);
    expect(r.margemPercent).toBe(-50);
  });
});
