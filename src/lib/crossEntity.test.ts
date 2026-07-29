import { describe, it, expect } from 'vitest';
import { consolidate, isInternalTransfer, buildCrossEntityPair } from './crossEntity';
import { Entity, Transaction } from '../types';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x', description: 'x', amount: 0, type: 'expense', date: '2026-07-10',
  categoryId: 'outros', status: 'completed', entityId: 'pj', ...over,
});

const PF: Entity = { id: 'pf', name: 'Lucas', type: 'PF', ownerUid: 'u1' };
const PJ: Entity = { id: 'pj', name: 'Agência CIIS', type: 'PJ', ownerUid: 'u1' };
const REF = new Date(2026, 6, 15);

describe('isInternalTransfer', () => {
  it('reconhece as duas pontas de um pró-labore', () => {
    expect(isInternalTransfer(tx({ crossEntityGroupId: 'g1' }))).toBe(true);
    expect(isInternalTransfer(tx({}))).toBe(false);
  });
});

describe('buildCrossEntityPair', () => {
  it('gera saída na origem e entrada no destino com o mesmo grupo e valor', () => {
    const { from, to, groupId } = buildCrossEntityPair({
      groupId: 'g-fixo',
      fromEntityId: 'pj',
      toEntityId: 'pf',
      amount: 5000,
      date: '2026-07-05',
      kind: 'prolabore',
      description: 'Pró-labore julho',
    });

    expect(groupId).toBe('g-fixo');
    expect(from.type).toBe('expense');
    expect(from.entityId).toBe('pj');
    expect(from.counterpartEntityId).toBe('pf');
    expect(to.type).toBe('income');
    expect(to.entityId).toBe('pf');
    expect(to.counterpartEntityId).toBe('pj');
    expect(from.amount).toBe(5000);
    expect(to.amount).toBe(5000);
    expect(from.crossEntityGroupId).toBe(to.crossEntityGroupId);
    expect(from.crossEntityKind).toBe('prolabore');
  });

  it('rejeita valor inválido ou mesma entidade dos dois lados', () => {
    const inválido = { groupId: 'g', fromEntityId: 'pj', toEntityId: 'pj', amount: 100, date: '2026-07-05', kind: 'prolabore' as const, description: 'x' };
    expect(() => buildCrossEntityPair(inválido)).toThrow();
    expect(() => buildCrossEntityPair({ ...inválido, toEntityId: 'pf', amount: 0 })).toThrow();
  });
});

describe('consolidate', () => {
  it('separa receita e despesa por entidade', () => {
    const txs = [
      tx({ id: '1', entityId: 'pj', type: 'income', amount: 20000, date: '2026-07-02' }),
      tx({ id: '2', entityId: 'pj', type: 'expense', amount: 8000, date: '2026-07-03' }),
      tx({ id: '3', entityId: 'pf', type: 'expense', amount: 3000, date: '2026-07-04' }),
    ];
    const r = consolidate(txs, [PF, PJ], REF);
    expect(r.byEntity.pj.income).toBe(20000);
    expect(r.byEntity.pj.expense).toBe(8000);
    expect(r.byEntity.pf.expense).toBe(3000);
  });

  it('pró-labore NÃO é receita nem despesa no consolidado — é movimento interno', () => {
    const txs = [
      tx({ id: '1', entityId: 'pj', type: 'income', amount: 20000, date: '2026-07-02' }),
      tx({ id: '2', entityId: 'pj', type: 'expense', amount: 5000, date: '2026-07-05', crossEntityGroupId: 'g1', crossEntityKind: 'prolabore', counterpartEntityId: 'pf' }),
      tx({ id: '3', entityId: 'pf', type: 'income', amount: 5000, date: '2026-07-05', crossEntityGroupId: 'g1', crossEntityKind: 'prolabore', counterpartEntityId: 'pj' }),
    ];
    const r = consolidate(txs, [PF, PJ], REF);

    // Visão de cada empresa continua enxergando o movimento...
    expect(r.byEntity.pj.expense).toBe(5000);
    expect(r.byEntity.pf.income).toBe(5000);

    // ...mas o consolidado não infla: entrou 20.000 no grupo, saiu 0.
    expect(r.consolidated.income).toBe(20000);
    expect(r.consolidated.expense).toBe(0);
    expect(r.internalFlow).toBe(5000);
  });

  it('soma o que a PJ pagou de despesa pessoal', () => {
    const txs = [
      tx({ id: '1', entityId: 'pj', type: 'expense', amount: 900, date: '2026-07-06', personalExpense: true }),
      tx({ id: '2', entityId: 'pj', type: 'expense', amount: 100, date: '2026-07-07' }),
      tx({ id: '3', entityId: 'pf', type: 'expense', amount: 500, date: '2026-07-08', personalExpense: true }),
    ];
    const r = consolidate(txs, [PF, PJ], REF);
    // Só conta na PJ: gasto pessoal na PF é só... gasto.
    expect(r.personalExpensePaidByCompany).toBe(900);
  });

  it('agrupa por tipo de entidade, para o total PF e o total PJ', () => {
    const txs = [
      tx({ id: '1', entityId: 'pj', type: 'income', amount: 20000, date: '2026-07-02' }),
      tx({ id: '2', entityId: 'pf', type: 'income', amount: 1000, date: '2026-07-02' }),
    ];
    const r = consolidate(txs, [PF, PJ], REF);
    expect(r.byType.PJ.income).toBe(20000);
    expect(r.byType.PF.income).toBe(1000);
  });

  it('ignora cancelados, pendentes e outros meses', () => {
    const txs = [
      tx({ id: '1', entityId: 'pj', type: 'income', amount: 999, date: '2026-07-02', status: 'cancelled' }),
      tx({ id: '2', entityId: 'pj', type: 'income', amount: 999, date: '2026-07-02', status: 'pending' }),
      tx({ id: '3', entityId: 'pj', type: 'income', amount: 999, date: '2026-06-02' }),
    ];
    const r = consolidate(txs, [PF, PJ], REF);
    expect(r.consolidated.income).toBe(0);
  });

  it('transferência entre contas da MESMA entidade não entra em receita/despesa', () => {
    const txs = [tx({ id: '1', entityId: 'pj', type: 'transfer', amount: 4000, date: '2026-07-02' })];
    const r = consolidate(txs, [PF, PJ], REF);
    expect(r.consolidated.income).toBe(0);
    expect(r.consolidated.expense).toBe(0);
  });

  it('lançamento de entidade desconhecida não quebra o cálculo', () => {
    const txs = [tx({ id: '1', entityId: 'fantasma', type: 'income', amount: 700, date: '2026-07-02' })];
    const r = consolidate(txs, [PF, PJ], REF);
    expect(r.consolidated.income).toBe(700);
    expect(r.byType.PF.income).toBe(0);
    expect(r.byType.PJ.income).toBe(0);
  });
});
