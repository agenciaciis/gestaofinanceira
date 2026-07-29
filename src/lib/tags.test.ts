import { describe, it, expect } from 'vitest';
import { normalizeTag, parseTags, readTags, mergeTags, matchesAllTags } from './tags';

describe('normalizeTag', () => {
  it('tira espaços das pontas, colapsa internos e baixa a caixa', () => {
    expect(normalizeTag('  Reforma   2026 ')).toBe('reforma 2026');
  });
  it('vazio devolve null', () => {
    expect(normalizeTag('   ')).toBeNull();
    expect(normalizeTag(undefined)).toBeNull();
  });
  it('corta etiqueta absurdamente longa', () => {
    expect(normalizeTag('x'.repeat(200))!.length).toBe(40);
  });
});

describe('parseTags', () => {
  it('aceita vírgula e ponto e vírgula', () => {
    expect(parseTags('reforma, casa; obra')).toEqual(['reforma', 'casa', 'obra']);
  });
  it('não repete a mesma etiqueta escrita diferente', () => {
    expect(parseTags('Casa, casa,  CASA ')).toEqual(['casa']);
  });
  it('entrada vazia devolve lista vazia', () => {
    expect(parseTags('')).toEqual([]);
    expect(parseTags(',,;')).toEqual([]);
  });
});

describe('readTags', () => {
  it('lê, limpa e ordena', () => {
    expect(readTags({ items: ['Obra', 'casa', ' obra '] })).toEqual(['casa', 'obra']);
  });
  it('documento ausente ou corrompido devolve vazio', () => {
    expect(readTags(undefined)).toEqual([]);
    expect(readTags({ items: 'nao e lista' })).toEqual([]);
    expect(readTags({ items: [null, 42, {}] })).toEqual([]);
  });
});

describe('mergeTags', () => {
  it('acrescenta sem duplicar e mantém ordem alfabética', () => {
    expect(mergeTags(['casa'], ['obra', 'Casa'])).toEqual(['casa', 'obra']);
  });
  it('ordena respeitando acento do português', () => {
    expect(mergeTags([], ['ácido', 'abacate'])).toEqual(['abacate', 'ácido']);
  });
});

describe('matchesAllTags', () => {
  it('sem filtro, tudo passa', () => {
    expect(matchesAllTags(undefined, [])).toBe(true);
  });
  it('exige TODAS as etiquetas pedidas', () => {
    expect(matchesAllTags(['casa', 'obra'], ['casa'])).toBe(true);
    expect(matchesAllTags(['casa', 'obra'], ['casa', 'obra'])).toBe(true);
    expect(matchesAllTags(['casa'], ['casa', 'obra'])).toBe(false);
  });
  it('compara normalizado', () => {
    expect(matchesAllTags(['Casa '], ['casa'])).toBe(true);
  });
  it('lançamento sem etiqueta não passa em filtro com etiqueta', () => {
    expect(matchesAllTags(undefined, ['casa'])).toBe(false);
  });
});
