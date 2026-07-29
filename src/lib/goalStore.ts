/**
 * Onde as caixinhas moram.
 *
 * As DEFINIÇÕES das caixinhas ficam num único documento
 * `entities/{id}/config/goals`, no formato `{ items: Goal[] }`.
 *
 * Por que não uma subcoleção própria: `config` já tem regra de acesso
 * publicada no Firebase, e uma subcoleção nova exigiria publicar regra —
 * passo manual que travava a funcionalidade inteira. Como caixinhas são
 * poucas por natureza (um punhado de objetivos por pessoa), uma lista num
 * documento é desenho adequado, não contorno: cabe com folga no teto de 1 MiB
 * e é sempre lida por inteiro de qualquer forma.
 *
 * Os DEPÓSITOS continuam sendo lançamentos normais em `transactions`, marcados
 * com `goalId` — o progresso segue derivado deles, nunca digitado.
 */
import { Goal } from '../types';

/** Caminho do documento das caixinhas de uma entidade. */
export function goalsDocPath(entityId: string): string {
  return `entities/${entityId}/config/goals`;
}

/**
 * Lê e sanitiza a lista guardada no documento. Entrada corrompida é descartada
 * em vez de virar linha quebrada na tela.
 */
export function readGoals(data: unknown, entityId: string): Goal[] {
  const raw = (data as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(raw)) return [];

  const out: Goal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const g = item as Partial<Goal>;
    if (!g.id || typeof g.id !== 'string') continue;
    const target = Number(g.targetAmount);
    out.push({
      id: g.id,
      name: typeof g.name === 'string' ? g.name : 'Sem nome',
      targetAmount: Number.isFinite(target) ? target : 0,
      deadline: typeof g.deadline === 'string' ? g.deadline : undefined,
      description: typeof g.description === 'string' ? g.description : undefined,
      color: typeof g.color === 'string' ? g.color : undefined,
      entityId: typeof g.entityId === 'string' && g.entityId ? g.entityId : entityId,
      createdAt: g.createdAt ?? null,
      archived: g.archived === true,
    });
  }
  return out;
}

/** Insere ou substitui pelo id, preservando a ordem. Não muta a entrada. */
export function upsertGoal(items: Goal[], goal: Goal): Goal[] {
  const i = items.findIndex(g => g.id === goal.id);
  if (i < 0) return [...items, goal];
  const copy = [...items];
  copy[i] = goal;
  return copy;
}

/** Remove pelo id. Não muta a entrada. */
export function removeGoal(items: Goal[], id: string): Goal[] {
  return items.filter(g => g.id !== id);
}
