import { describe, it, expect } from 'vitest';
import { addPeriod, planRecurringRenewals } from './recurring';
import { Transaction } from '../types';

const rec = (date: string, groupId = 'g1', period: any = 'monthly'): Transaction =>
  ({
    id: 'id-' + date,
    description: 'Aluguel',
    amount: 1500,
    type: 'expense',
    date,
    categoryId: 'moradia',
    status: 'pending',
    entityId: 'e1',
    isRecurring: true,
    recurringPeriod: period,
    recurringGroupId: groupId,
  }) as Transaction;

describe('addPeriod', () => {
  it('mensal/semanal/anual', () => {
    expect(addPeriod(new Date(2026, 0, 15), 'monthly').getMonth()).toBe(1);
    expect(addPeriod(new Date(2026, 0, 1), 'weekly').getDate()).toBe(8);
    expect(addPeriod(new Date(2026, 0, 1), 'yearly').getFullYear()).toBe(2027);
  });
});

describe('planRecurringRenewals', () => {
  it('gera ocorrências futuras até o horizonte quando a série está acabando', () => {
    const today = new Date(2026, 5, 1); // junho/2026
    // Série só vai até julho/2026 (1 mês à frente). Horizonte 12 meses => precisa estender.
    const txs = [rec('2026-06-10'), rec('2026-07-10')];
    const plan = planRecurringRenewals(txs, today, 12);
    expect(plan).toHaveLength(1);
    // próxima após a mais recente (julho) deve ser agosto
    expect(plan[0].dates[0]).toBe('2026-08-10');
    // cobre ~11-12 meses à frente (último <= horizonte)
    expect(plan[0].dates[plan[0].dates.length - 1] >= '2027-04-01').toBe(true);
    expect(plan[0].dates[plan[0].dates.length - 1] <= '2027-06-01').toBe(true);
  });

  it('não renova grupo encerrado (todas as ocorrências no passado)', () => {
    const today = new Date(2026, 5, 1);
    const txs = [rec('2026-01-10'), rec('2026-02-10')]; // tudo no passado
    expect(planRecurringRenewals(txs, today, 12)).toHaveLength(0);
  });

  it('não gera nada se já coberto até o horizonte', () => {
    const today = new Date(2026, 5, 1);
    const txs = [rec('2026-06-10'), rec('2027-08-10')]; // já além de 12 meses
    expect(planRecurringRenewals(txs, today, 12)).toHaveLength(0);
  });

  it('não duplica datas existentes', () => {
    const today = new Date(2026, 5, 1);
    const txs = [rec('2026-06-10'), rec('2026-07-10'), rec('2026-08-10')];
    const plan = planRecurringRenewals(txs, today, 12);
    const all = plan[0].dates;
    expect(all).not.toContain('2026-07-10');
    expect(all).not.toContain('2026-08-10');
    expect(new Set(all).size).toBe(all.length);
  });
});
