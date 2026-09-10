/**
 * Estoque: helpers puros de saldo/alerta e o registro de movimentações.
 * As movimentações moram num doc de config (`entities/{id}/config/stock_movements`,
 * lista `items`) — reaproveita a regra de acesso já publicada, sem coleção nova.
 * Mantemos só as últimas N movimentações pra não crescer sem limite.
 */
export type StockReason = 'venda' | 'compra' | 'producao' | 'ajuste' | 'perda' | 'inicial';

export interface StockMovement {
  id: string;
  itemType: 'product' | 'supply';
  itemId: string;
  itemName: string;
  delta: number;          // + entrada, − saída
  balanceAfter: number;   // saldo depois do movimento
  reason: StockReason;
  note?: string;
  at: string;             // ISO
  by?: string;            // e-mail de quem fez
}

export const STOCK_REASONS: { id: StockReason; label: string }[] = [
  { id: 'compra', label: 'Compra / entrada' },
  { id: 'venda', label: 'Venda / saída' },
  { id: 'producao', label: 'Produção (consumo)' },
  { id: 'ajuste', label: 'Ajuste manual' },
  { id: 'perda', label: 'Perda / descarte' },
  { id: 'inicial', label: 'Saldo inicial' },
];

const MAX_MOVEMENTS = 300;

export function stockMovementsDocPath(entityId: string): string {
  return `entities/${entityId}/config/stock_movements`;
}

/** `true` se o item controla estoque e o saldo está no/abaixo do mínimo. */
export function isLowStock(item: { trackStock?: boolean; stock?: number; minStock?: number } | null | undefined): boolean {
  if (!item || !item.trackStock) return false;
  return (Number(item.stock) || 0) <= (Number(item.minStock) || 0);
}

/** Lê a lista de movimentações de um doc de config, tolerante a formato faltando. */
export function readMovements(data: unknown): StockMovement[] {
  const items = (data as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items)) return [];
  return items.filter((m): m is StockMovement =>
    !!m && typeof (m as StockMovement).id === 'string' && typeof (m as StockMovement).itemId === 'string');
}

/** Aplica um novo movimento no topo da lista, cortando no limite. */
export function appendMovement(list: StockMovement[], mov: StockMovement): StockMovement[] {
  return [mov, ...list].slice(0, MAX_MOVEMENTS);
}

/** Novo saldo depois de um delta, nunca negativo. */
export function applyDelta(current: number | undefined, delta: number): number {
  return Math.max(0, (Number(current) || 0) + (Number(delta) || 0));
}
