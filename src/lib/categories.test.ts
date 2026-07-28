import { describe, it, expect } from 'vitest';
import { matchCategoryId, categoryNames } from './categories';

describe('matchCategoryId', () => {
  it('casa o nome exato da categoria', () => {
    expect(matchCategoryId('Alimentação')).toBe('alimentacao');
    expect(matchCategoryId('Salário')).toBe('salario');
  });

  it('ignora caixa e espaços em volta', () => {
    expect(matchCategoryId('  aLiMeNtAçÃo  ')).toBe('alimentacao');
  });

  it('casa mesmo sem acento — a IA às vezes responde sem', () => {
    expect(matchCategoryId('alimentacao')).toBe('alimentacao');
    expect(matchCategoryId('Saude')).toBe('saude');
    expect(matchCategoryId('Transferencia')).toBe('transferencia');
  });

  it('cai em "outros" quando não reconhece', () => {
    expect(matchCategoryId('Criptomoedas')).toBe('outros');
    expect(matchCategoryId('')).toBe('outros');
    expect(matchCategoryId(undefined)).toBe('outros');
  });

  it('não confunde texto que apenas contém o nome', () => {
    expect(matchCategoryId('A categoria sugerida é Alimentação')).toBe('outros');
  });

  it('categoryNames devolve os nomes para montar o prompt', () => {
    expect(categoryNames()).toContain('Alimentação');
    expect(categoryNames().length).toBeGreaterThan(5);
  });
});
