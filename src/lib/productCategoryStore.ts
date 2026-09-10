/**
 * Categorias de PRODUTOS — cadastro próprio (não texto livre). Compartilhadas
 * entre as entidades e guardadas num doc de config
 * (`entities/{id}/config/product_categories`, lista `items`) — reaproveita a
 * regra de acesso já publicada, sem coleção nova.
 */
export interface ProductCategory {
  id: string;
  name: string;
  color?: string;
  order?: number;
}

export function productCategoriesDocPath(entityId: string): string {
  return `entities/${entityId}/config/product_categories`;
}

/** id estável a partir do nome (sem acento, minúsculo, com prefixo). */
export function slugifyProductCategory(name: string): string {
  const base = String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base ? `pc-${base}` : '';
}

export function readProductCategories(data: unknown): ProductCategory[] {
  const items = (data as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items)) return [];
  const out: ProductCategory[] = [];
  for (const raw of items) {
    const c = raw as Partial<ProductCategory>;
    if (!c || typeof c.id !== 'string' || typeof c.name !== 'string') continue;
    out.push({ id: c.id, name: c.name, color: typeof c.color === 'string' ? c.color : undefined, order: typeof c.order === 'number' ? c.order : undefined });
  }
  return out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}

export function upsertProductCategory(list: ProductCategory[], cat: ProductCategory): ProductCategory[] {
  const i = list.findIndex(c => c.id === cat.id);
  if (i === -1) return [...list, cat];
  const copy = [...list]; copy[i] = { ...copy[i], ...cat }; return copy;
}

export function removeProductCategory(list: ProductCategory[], id: string): ProductCategory[] {
  return list.filter(c => c.id !== id);
}

export function mergeProductCategories(...lists: ProductCategory[][]): ProductCategory[] {
  const byId = new Map<string, ProductCategory>();
  for (const list of lists) for (const c of list) if (!byId.has(c.id)) byId.set(c.id, c);
  return [...byId.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}
