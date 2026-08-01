import { describe, it, expect } from 'vitest';
import { Quote } from '../types';
import { quoteToRevenueTransactions, alreadyConverted, activeOrdersForClient, OrderEntity } from './orders';
import { round2 } from './finance';

const entity: OrderEntity = { id: 'pj', ownerUid: 'u1', collaboratorsEmails: [] };

const quote = (over: Partial<Quote>): Quote => ({
  id: 'q1', quoteNumber: 'ORC-202607-0001', clientId: 'cli1', clientName: 'Cliente X',
  date: '2026-07-10', validUntil: '2026-07-17', items: [], subtotal: 0, discountTotal: 0,
  total: 0, paymentMethod: 'PIX', installments: 1, status: 'approved', entityId: 'pj',
  createdAt: null, ...over,
});

describe('orders — pagamento único', () => {
  const txs = quoteToRevenueTransactions(quote({ total: 3000 }), entity);
  it('gera 1 lançamento de receita pendente vinculado ao cliente', () => {
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe('income');
    expect(txs[0].status).toBe('pending');
    expect(txs[0].amount).toBe(3000);
    expect(txs[0].clientId).toBe('cli1');
    expect(txs[0].sourceQuoteId).toBe('q1');
    expect(txs[0].date).toBe('2026-07-10');
    expect(txs[0].categoryId).toBe('venda');
  });
});

describe('orders — parcelado', () => {
  const txs = quoteToRevenueTransactions(quote({ total: 1000, installments: 3 }), entity);
  it('gera N parcelas mensais que fecham o total', () => {
    expect(txs).toHaveLength(3);
    const soma = round2(txs.reduce((a, t) => a + t.amount, 0));
    expect(soma).toBe(1000);
    expect(txs.map(t => t.installmentNumber)).toEqual([1, 2, 3]);
    expect(new Set(txs.map(t => t.installmentGroupId)).size).toBe(1);
  });
  it('as datas avançam um mês por parcela', () => {
    expect(txs[0].date).toBe('2026-07-10');
    expect(txs[1].date).toBe('2026-08-10');
    expect(txs[2].date).toBe('2026-09-10');
  });
  it('todas pendentes e vinculadas ao orçamento', () => {
    for (const t of txs) {
      expect(t.status).toBe('pending');
      expect(t.sourceQuoteId).toBe('q1');
    }
  });
});

describe('orders — recorrente', () => {
  const txs = quoteToRevenueTransactions(
    quote({ total: 1500, recurrenceConfig: { enabled: true, frequency: 'monthly', startDate: '2026-07-10' } }),
    entity,
  );
  it('sem prazo (count 0/ausente) gera 1 lançamento recorrente que o motor renova', () => {
    expect(txs).toHaveLength(1);
    expect(txs[0].isRecurring).toBe(true);
    expect(txs[0].recurringPeriod).toBe('monthly');
    expect(txs[0].recurringGroupId).toBe('rec-q1');
    expect(txs[0].amount).toBe(1500);
    expect(txs[0].status).toBe('pending');
  });

  it('com prazo definido (count = 3) gera exatamente 3 cobranças e NÃO renova sozinho', () => {
    const finitas = quoteToRevenueTransactions(
      quote({ total: 1200, recurrenceConfig: { enabled: true, frequency: 'monthly', startDate: '2026-07-10', count: 3 } }),
      entity,
    );
    expect(finitas).toHaveLength(3);
    // Nenhuma é recorrente (não se auto-renova) — o motor de recorrência as ignora.
    expect(finitas.every(t => !t.isRecurring)).toBe(true);
    expect(finitas.every(t => t.amount === 1200)).toBe(true);
    expect(finitas.map(t => t.date)).toEqual(['2026-07-10', '2026-08-10', '2026-09-10']);
    expect(finitas.every(t => t.status === 'pending' && t.type === 'income')).toBe(true);
  });

  it('recorrência semanal com prazo avança 7 dias por cobrança', () => {
    const semanais = quoteToRevenueTransactions(
      quote({ total: 100, recurrenceConfig: { enabled: true, frequency: 'weekly', startDate: '2026-07-10', count: 2 } }),
      entity,
    );
    expect(semanais.map(t => t.date)).toEqual(['2026-07-10', '2026-07-17']);
  });
});

describe('orders — addMonths não vaza para o mês seguinte', () => {
  it('parcela iniciada em 31/01 cai no último dia de fevereiro, não em março', () => {
    const txs = quoteToRevenueTransactions(
      quote({ total: 300, installments: 2, date: '2026-01-31' }),
      entity,
    );
    // 2026 não é bissexto → fevereiro tem 28 dias.
    expect(txs[0].date).toBe('2026-01-31');
    expect(txs[1].date).toBe('2026-02-28');
  });
});

describe('orders — bordas e idempotência', () => {
  it('total <= 0 não gera nada', () => {
    expect(quoteToRevenueTransactions(quote({ total: 0 }), entity)).toHaveLength(0);
    expect(quoteToRevenueTransactions(quote({ total: -50 }), entity)).toHaveLength(0);
  });
  it('nenhum valor vira NaN', () => {
    const txs = quoteToRevenueTransactions(quote({ total: 999.99, installments: 7 }), entity);
    for (const t of txs) expect(Number.isFinite(t.amount)).toBe(true);
  });
  it('alreadyConverted detecta receita já gerada', () => {
    const existentes = [{ sourceQuoteId: 'q1' }, { sourceQuoteId: 'q9' }];
    expect(alreadyConverted('q1', existentes)).toBe(true);
    expect(alreadyConverted('q2', existentes)).toBe(false);
  });
  it('activeOrdersForClient traz só os convertidos do cliente', () => {
    const qs = [
      quote({ id: 'a', clientId: 'cli1', status: 'converted' }),
      quote({ id: 'b', clientId: 'cli1', status: 'approved' }),
      quote({ id: 'c', clientId: 'cli2', status: 'converted' }),
    ];
    const os = activeOrdersForClient(qs, 'cli1');
    expect(os.map(q => q.id)).toEqual(['a']);
  });
});
