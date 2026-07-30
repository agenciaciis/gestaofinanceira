/**
 * Metas de gasto por categoria (a aba "Metas").
 *
 * A conta vivia dentro de Dashboard, Relatórios e Notificações — três cópias da
 * mesma regra, sem teste. Aqui é uma só.
 */
import { Transaction } from '../types';
import { parseLocalDate, round2 } from './finance';

/** { categoriaId: limite mensal }. Também guarda 'monthly_balance_goal'. */
export type BudgetMap = Record<string, number>;

export interface BudgetLine {
  categoryId: string;
  limit: number;
  spent: number;
  remaining: number;
  /** 0 em diante; passa de 100 quando estoura. */
  percent: number;
  exceeded: boolean;
}

/**
 * Compara limite e realizado do mês, por categoria com limite definido.
 * `percent` NÃO é travado em 100: estourar 40% precisa aparecer como 140%,
 * senão a barra cheia esconde o tamanho do problema.
 */
export function budgetProgress(
  budgets: BudgetMap,
  transactions: Transaction[],
  reference: Date = new Date(),
  type: 'income' | 'expense' = 'expense'
): BudgetLine[] {
  const inicio = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const fim = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);

  const gastoPorCategoria: Record<string, number> = {};
  for (const t of transactions) {
    if (t.type !== type || t.status !== 'completed') continue;
    const d = parseLocalDate(t.date);
    if (Number.isNaN(d.getTime()) || d < inicio || d >= fim) continue;
    gastoPorCategoria[t.categoryId] = round2((gastoPorCategoria[t.categoryId] || 0) + (Number(t.amount) || 0));
  }

  const out: BudgetLine[] = [];
  for (const [categoryId, raw] of Object.entries(budgets)) {
    if (categoryId === 'monthly_balance_goal') continue;   // não é categoria
    const limit = Number(raw) || 0;
    if (limit <= 0) continue;
    const spent = gastoPorCategoria[categoryId] || 0;
    out.push({
      categoryId,
      limit,
      spent,
      remaining: round2(limit - spent),
      percent: round2((spent / limit) * 100),
      exceeded: spent > limit,
    });
  }
  return out.sort((a, b) => b.percent - a.percent);
}

/** Só as categorias estouradas — é o que vira alerta. */
export function exceededBudgets(lines: BudgetLine[]): BudgetLine[] {
  return lines.filter(l => l.exceeded);
}

/** Meta de sobra do mês: quanto falta para bater. `null` se não há meta. */
export function balanceGoalGap(budgets: BudgetMap, resultadoDoMes: number): number | null {
  const meta = Number(budgets['monthly_balance_goal']) || 0;
  if (meta <= 0) return null;
  return round2(meta - resultadoDoMes);
}
