/**
 * Categorias personalizadas — criadas pelo usuário, além das fixas em
 * `constants.CATEGORIES`. São COMPARTILHADAS entre entidades: guardamos num doc
 * de config por entidade (`entities/{id}/config/categories`) e, na leitura,
 * unimos o que houver em todas as entidades do usuário. Assim uma categoria
 * criada em qualquer entidade aparece em todas — igual às fixas.
 *
 * Módulo PURO e testável: nada de Firebase aqui. Quem lê/grava passa os dados.
 */
import { CATEGORIES } from '../constants';

export interface CustomCategory {
  id: string;
  name: string;
  color?: string;
}

/** Caminho do doc de config das categorias de uma entidade. */
export function categoriesDocPath(entityId: string): string {
  return `entities/${entityId}/config/categories`;
}

/** Normaliza um nome em id estável: sem acento, minúsculo, com prefixo `cat-`. */
export function slugifyCategory(name: string): string {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base ? `cat-${base}` : '';
}

/** Lê a lista de categorias de um doc de config, tolerante a formato faltando. */
export function readCustomCategories(data: unknown): CustomCategory[] {
  const items = (data as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items)) return [];
  const out: CustomCategory[] = [];
  for (const raw of items) {
    const c = raw as Partial<CustomCategory>;
    if (!c || typeof c.id !== 'string' || typeof c.name !== 'string') continue;
    out.push({ id: c.id, name: c.name, color: typeof c.color === 'string' ? c.color : undefined });
  }
  return out;
}

/** Adiciona/atualiza uma categoria por id, mantendo a ordem (novas no fim). */
export function upsertCustomCategory(list: CustomCategory[], cat: CustomCategory): CustomCategory[] {
  const i = list.findIndex(c => c.id === cat.id);
  if (i === -1) return [...list, cat];
  const copy = [...list];
  copy[i] = { ...copy[i], ...cat };
  return copy;
}

/** Une várias listas (das entidades) removendo repetidos por id. */
export function mergeCustomCategories(...lists: CustomCategory[][]): CustomCategory[] {
  const byId = new Map<string, CustomCategory>();
  for (const list of lists) for (const c of list) if (!byId.has(c.id)) byId.set(c.id, c);
  return [...byId.values()];
}

/** Categorias fixas + personalizadas, no formato usado pelos seletores. */
export function allCategories(custom: CustomCategory[]): { id: string; name: string; color?: string }[] {
  const fixas = CATEGORIES.map(c => ({ id: c.id, name: c.name, color: c.color }));
  const extras = custom.filter(c => !CATEGORIES.some(f => f.id === c.id));
  return [...fixas, ...extras];
}

/** Nome de exibição de uma categoria, resolvendo fixas e personalizadas. */
export function categoryLabel(id: string | undefined, custom: CustomCategory[] = []): string {
  if (!id) return 'Outros';
  const fixa = CATEGORIES.find(c => c.id === id);
  if (fixa) return fixa.name;
  const extra = custom.find(c => c.id === id);
  if (extra) return extra.name;
  return 'Outros';
}
