/**
 * Etiquetas livres nos lançamentos.
 *
 * Categoria classifica (alimentação, moradia); etiqueta AGRUPA por assunto e
 * cruza categorias — "reforma 2026" pega material, mão de obra e transporte de
 * uma vez. Ideia trazida da planilha antiga do usuário.
 *
 * A lista conhecida por entidade fica em `entities/{id}/config/tags`, que já
 * tem regra publicada.
 */

export function tagsDocPath(entityId: string): string {
  return `entities/${entityId}/config/tags`;
}

/** Normaliza para comparação e gravação: sem espaço nas pontas, minúsculo. */
export function normalizeTag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = String(raw).trim().replace(/\s+/g, ' ').toLowerCase();
  if (!t) return null;
  return t.slice(0, 40);
}

/** Aceita "a, b; c" e devolve etiquetas limpas e sem repetição. */
export function parseTags(input: string | null | undefined): string[] {
  if (!input) return [];
  const out: string[] = [];
  for (const piece of String(input).split(/[,;]/)) {
    const t = normalizeTag(piece);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Lê a lista conhecida do documento, descartando lixo. */
export function readTags(data: unknown): string[] {
  const raw = (data as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const t = normalizeTag(typeof item === 'string' ? item : null);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Junta as novas às conhecidas, sem duplicar, em ordem alfabética. */
export function mergeTags(known: string[], incoming: string[]): string[] {
  const set = new Set(known.map(t => normalizeTag(t)).filter(Boolean) as string[]);
  for (const t of incoming) {
    const n = normalizeTag(t);
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** `true` se o lançamento tem TODAS as etiquetas pedidas (filtro cumulativo). */
export function matchesAllTags(txTags: string[] | undefined, wanted: string[]): boolean {
  if (wanted.length === 0) return true;
  const have = new Set((txTags || []).map(t => normalizeTag(t)).filter(Boolean) as string[]);
  return wanted.every(w => {
    const n = normalizeTag(w);
    return n ? have.has(n) : true;
  });
}
