import { describe, it, expect } from 'vitest';
import { upsertGoal, removeGoal, readGoals } from './goalStore';
import { Goal } from '../types';

const g = (id: string, over: Partial<Goal> = {}): Goal => ({
  id, name: `Meta ${id}`, targetAmount: 1000, entityId: 'pf', createdAt: null, ...over,
});

describe('readGoals', () => {
  it('lê a lista do documento', () => {
    expect(readGoals({ items: [g('a'), g('b')] }, 'pf')).toHaveLength(2);
  });

  it('documento ausente ou sem lista devolve vazio, não quebra', () => {
    expect(readGoals(undefined, 'pf')).toEqual([]);
    expect(readGoals({}, 'pf')).toEqual([]);
    expect(readGoals({ items: 'não é lista' }, 'pf')).toEqual([]);
  });

  it('descarta entrada corrompida em vez de propagar lixo para a tela', () => {
    const items = [g('ok'), { id: '', name: 'sem id' }, { name: 'sem id nenhum' }, null];
    expect(readGoals({ items }, 'pf').map(x => x.id)).toEqual(['ok']);
  });

  it('garante o entityId, mesmo se o documento vier sem ele', () => {
    const r = readGoals({ items: [{ id: 'x', name: 'X', targetAmount: 500 }] }, 'pj');
    expect(r[0].entityId).toBe('pj');
  });

  it('normaliza valor de meta inválido para zero em vez de NaN', () => {
    const r = readGoals({ items: [{ id: 'x', name: 'X', targetAmount: 'abc' }] }, 'pf');
    expect(r[0].targetAmount).toBe(0);
  });
});

describe('upsertGoal', () => {
  it('acrescenta quando o id é novo', () => {
    const r = upsertGoal([g('a')], g('b'));
    expect(r.map(x => x.id)).toEqual(['a', 'b']);
  });

  it('substitui quando o id já existe, preservando a posição', () => {
    const r = upsertGoal([g('a'), g('b'), g('c')], g('b', { name: 'Trocada' }));
    expect(r.map(x => x.id)).toEqual(['a', 'b', 'c']);
    expect(r[1].name).toBe('Trocada');
  });

  it('não muta a lista original', () => {
    const orig = [g('a')];
    upsertGoal(orig, g('b'));
    expect(orig).toHaveLength(1);
  });
});

describe('removeGoal', () => {
  it('remove pelo id', () => {
    expect(removeGoal([g('a'), g('b')], 'a').map(x => x.id)).toEqual(['b']);
  });

  it('id inexistente devolve a lista igual', () => {
    expect(removeGoal([g('a')], 'zzz')).toHaveLength(1);
  });

  it('não muta a lista original', () => {
    const orig = [g('a'), g('b')];
    removeGoal(orig, 'a');
    expect(orig).toHaveLength(2);
  });
});
