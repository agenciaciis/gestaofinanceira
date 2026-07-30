import { describe, it, expect } from 'vitest';
import {
  computeCardUsage,
  round2,
  isRealized,
  isNotCancelled,
  parseLocalDate,
  formatLocalDate,
  splitInstallments,
  computeBalances,
  totalBalance,
  computeCardInvoice,
  currentInvoiceWindow,
  daysUntilDueDay,
} from './finance';
import { BankAccount, Transaction } from '../types';

const acc = (id: string, initialBalance: number): Pick<BankAccount, 'id' | 'initialBalance'> => ({
  id,
  initialBalance,
});

const tx = (t: Partial<Transaction>): Transaction =>
  ({
    id: Math.random().toString(36).slice(2),
    description: 'x',
    amount: 0,
    type: 'expense',
    date: '2026-06-10',
    categoryId: 'outros',
    status: 'completed',
    entityId: 'e1',
    ...t,
  }) as Transaction;

describe('round2', () => {
  it('arredonda para centavos', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(33.333333)).toBe(33.33);
    expect(round2(33.335)).toBe(33.34);
  });
  it('protege contra valores não-finitos', () => {
    expect(round2(NaN)).toBe(0);
    expect(round2(Infinity)).toBe(0);
  });
});

describe('isRealized / isNotCancelled', () => {
  it('isRealized só para completed', () => {
    expect(isRealized({ status: 'completed' })).toBe(true);
    expect(isRealized({ status: 'pending' })).toBe(false);
    expect(isRealized({ status: 'cancelled' })).toBe(false);
  });
  it('isNotCancelled exclui cancelados', () => {
    expect(isNotCancelled({ status: 'completed' })).toBe(true);
    expect(isNotCancelled({ status: 'pending' })).toBe(true);
    expect(isNotCancelled({ status: 'cancelled' })).toBe(false);
  });
});

describe('parseLocalDate', () => {
  it('não volta um dia em fuso negativo', () => {
    const d = parseLocalDate('2026-06-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // junho
    expect(d.getDate()).toBe(1);
  });
  it('round-trip com formatLocalDate', () => {
    expect(formatLocalDate(parseLocalDate('2026-12-31'))).toBe('2026-12-31');
  });
  it('entrada inválida vira Invalid Date', () => {
    expect(Number.isNaN(parseLocalDate('').getTime())).toBe(true);
    expect(Number.isNaN(parseLocalDate(undefined).getTime())).toBe(true);
  });
});

describe('splitInstallments', () => {
  it('soma das parcelas é exatamente o total', () => {
    const p = splitInstallments(1000, 3);
    expect(p).toHaveLength(3);
    expect(round2(p.reduce((a, b) => a + b, 0))).toBe(1000);
    expect(p[2]).toBe(333.34);
  });
  it('valores quebrados fecham o total', () => {
    const p = splitInstallments(100, 7);
    expect(round2(p.reduce((a, b) => a + b, 0))).toBe(100);
  });
  it('n=1 devolve o total inteiro', () => {
    expect(splitInstallments(99.99, 1)).toEqual([99.99]);
  });
  it('n inválido não quebra', () => {
    expect(splitInstallments(50, 0)).toEqual([50]);
  });
});

describe('computeBalances', () => {
  const accounts = [acc('a', 100), acc('b', 0)];

  it('receita e despesa concluídas movem o saldo', () => {
    const b = computeBalances(accounts, [
      tx({ type: 'income', amount: 50, accountId: 'a' }),
      tx({ type: 'expense', amount: 30, accountId: 'a' }),
    ]);
    expect(b.a).toBe(120);
  });

  it('ignora pendentes e cancelados', () => {
    const b = computeBalances(accounts, [
      tx({ type: 'income', amount: 1000, accountId: 'a', status: 'pending' }),
      tx({ type: 'expense', amount: 1000, accountId: 'a', status: 'cancelled' }),
    ]);
    expect(b.a).toBe(100);
  });

  it('transferência debita origem e credita destino', () => {
    const b = computeBalances(accounts, [
      tx({ type: 'transfer', amount: 40, accountId: 'a', toAccountId: 'b' }),
    ]);
    expect(b.a).toBe(60);
    expect(b.b).toBe(40);
  });

  it('lançamento de cartão não afeta saldo de conta', () => {
    const b = computeBalances(accounts, [
      tx({ type: 'expense', amount: 200, cardId: 'c1' }),
    ]);
    expect(b.a).toBe(100);
  });

  it('sem drift de ponto flutuante', () => {
    const b = computeBalances([acc('a', 0)], [
      tx({ type: 'income', amount: 0.1, accountId: 'a' }),
      tx({ type: 'income', amount: 0.2, accountId: 'a' }),
    ]);
    expect(b.a).toBe(0.3);
  });
});

describe('totalBalance', () => {
  it('soma todas as contas', () => {
    const total = totalBalance([acc('a', 100), acc('b', 50)], [
      tx({ type: 'income', amount: 25, accountId: 'b' }),
    ]);
    expect(total).toBe(175);
  });
});

describe('currentInvoiceWindow / computeCardInvoice', () => {
  it('janela de fatura tem ~1 mês', () => {
    const { start, end } = currentInvoiceWindow(10, new Date(2026, 5, 5)); // 5 jun
    // referência (5) <= fechamento (10) => fecha em 10/jun, abre em 10/mai
    expect(formatLocalDate(end)).toBe('2026-06-10');
    expect(formatLocalDate(start)).toBe('2026-05-10');
  });

  it('dias até vencimento atravessa a virada de mês', () => {
    // hoje 29/jan, vencimento dia 2 => 4 dias (até 2/fev), não negativo
    expect(daysUntilDueDay(2, new Date(2026, 0, 29))).toBe(4);
    // vencimento hoje => 0
    expect(daysUntilDueDay(15, new Date(2026, 5, 15))).toBe(0);
    // vencimento daqui a 5 dias no mesmo mês
    expect(daysUntilDueDay(20, new Date(2026, 5, 15))).toBe(5);
  });

  it('soma despesas do cartão no ciclo corrente', () => {
    const ref = new Date(2026, 5, 5);
    const total = computeCardInvoice('c1', 10, [
      tx({ type: 'expense', amount: 100, cardId: 'c1', date: '2026-05-20' }), // dentro
      tx({ type: 'expense', amount: 50, cardId: 'c1', date: '2026-06-09' }), // dentro
      tx({ type: 'expense', amount: 999, cardId: 'c1', date: '2026-04-01' }), // fora (antigo)
      tx({ type: 'expense', amount: 999, cardId: 'c1', date: '2026-05-20', status: 'cancelled' }), // cancelado
    ], ref);
    expect(total).toBe(150);
  });
});


describe('computeCardUsage', () => {
  const tx = (over: any) => ({
    id: 'x', description: 'x', amount: 0, type: 'expense', date: '2026-07-10',
    categoryId: 'c', status: 'completed', entityId: 'e', ...over,
  });
  // Fechamento dia 5 => em 15/07 o ciclo aberto vai de 05/07 a 05/08.
  const REF = new Date(2026, 6, 15);

  it('conta a fatura aberta', () => {
    const txs = [tx({ cardId: 'c1', amount: 300, date: '2026-07-10' })];
    expect(computeCardUsage('c1', 5, txs, REF)).toBe(300);
  });

  it('NÃO conta compra de ciclo já fechado — o limite volta quando a fatura é paga', () => {
    // Este era o bug: somava desde sempre, então o utilizado só crescia.
    const txs = [
      tx({ cardId: 'c1', amount: 5000, date: '2026-03-10' }),
      tx({ cardId: 'c1', amount: 300, date: '2026-07-10' }),
    ];
    expect(computeCardUsage('c1', 5, txs, REF)).toBe(300);
  });

  it('conta parcela FUTURA em aberto, que ainda ocupa limite', () => {
    const txs = [
      tx({ cardId: 'c1', amount: 300, date: '2026-07-10' }),
      tx({ cardId: 'c1', amount: 200, date: '2026-09-10', status: 'pending', installmentGroupId: 'g' }),
    ];
    expect(computeCardUsage('c1', 5, txs, REF)).toBe(500);
  });

  it('ignora cancelado, receita e outro cartão', () => {
    const txs = [
      tx({ cardId: 'c1', amount: 999, date: '2026-07-10', status: 'cancelled' }),
      tx({ cardId: 'c1', amount: 999, date: '2026-07-11', type: 'income' }),
      tx({ cardId: 'outro', amount: 999, date: '2026-07-12' }),
    ];
    expect(computeCardUsage('c1', 5, txs, REF)).toBe(0);
  });

  it('cartão sem movimento devolve zero', () => {
    expect(computeCardUsage('c1', 5, [], REF)).toBe(0);
  });
});
