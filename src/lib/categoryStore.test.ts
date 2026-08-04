import { describe, it, expect } from 'vitest';
import {
  slugifyCategory, readCustomCategories, upsertCustomCategory,
  mergeCustomCategories, allCategories, categoryLabel, CustomCategory,
} from './categoryStore';

describe('slugifyCategory', () => {
  it('normaliza acento, espaço e maiúscula em id estável com prefixo', () => {
    expect(slugifyCategory('Impostos')).toBe('cat-impostos');
    expect(slugifyCategory('Comissão de Vendas')).toBe('cat-comissao-de-vendas');
    expect(slugifyCategory('  Água / Luz  ')).toBe('cat-agua-luz');
  });
  it('nome vazio ou só símbolo devolve string vazia', () => {
    expect(slugifyCategory('   ')).toBe('');
    expect(slugifyCategory('###')).toBe('');
  });
});

describe('readCustomCategories', () => {
  it('lê items válidos e ignora lixo', () => {
    const data = { items: [{ id: 'cat-x', name: 'X' }, { id: 5 }, null, { name: 'sem id' }] };
    expect(readCustomCategories(data)).toEqual([{ id: 'cat-x', name: 'X', color: undefined }]);
  });
  it('doc sem items devolve lista vazia', () => {
    expect(readCustomCategories(undefined)).toEqual([]);
    expect(readCustomCategories({})).toEqual([]);
  });
});

describe('upsert / merge', () => {
  it('upsert adiciona no fim e substitui por id', () => {
    const base: CustomCategory[] = [{ id: 'cat-a', name: 'A' }];
    expect(upsertCustomCategory(base, { id: 'cat-b', name: 'B' })).toHaveLength(2);
    expect(upsertCustomCategory(base, { id: 'cat-a', name: 'A2' })[0].name).toBe('A2');
  });
  it('merge une entidades removendo repetidos por id', () => {
    const r = mergeCustomCategories([{ id: 'cat-a', name: 'A' }], [{ id: 'cat-a', name: 'A' }, { id: 'cat-b', name: 'B' }]);
    expect(r.map(c => c.id).sort()).toEqual(['cat-a', 'cat-b']);
  });
});

describe('allCategories / categoryLabel', () => {
  it('mescla fixas + personalizadas sem duplicar fixas', () => {
    const ids = allCategories([{ id: 'cat-nova', name: 'Nova' }]).map(c => c.id);
    expect(ids).toContain('alimentacao'); // fixa
    expect(ids).toContain('cat-nova');    // personalizada
  });
  it('resolve nome de fixa e de personalizada; desconhecida vira Outros', () => {
    expect(categoryLabel('alimentacao')).toBe('Alimentação');
    expect(categoryLabel('cat-nova', [{ id: 'cat-nova', name: 'Nova' }])).toBe('Nova');
    expect(categoryLabel('inexistente')).toBe('Outros');
    expect(categoryLabel(undefined)).toBe('Outros');
  });
});
