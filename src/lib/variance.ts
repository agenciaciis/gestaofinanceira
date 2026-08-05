/**
 * Previsto × Real, e comparação entre períodos com AV/AH.
 *
 * Estrutura trazida da planilha antiga do usuário:
 *  - cada lançamento pode ter um valor PREVISTO e o valor REAL pago
 *  - AV (análise vertical): cada linha como % da receita do próprio período
 *  - AH (análise horizontal): variação de um período para o outro
 */
import { Transaction } from '../types';
import { parseLocalDate, round2, isCardExpense } from './finance';

/** Valor previsto do lançamento; sem previsão, o próprio real. */
export function plannedOf(t: Transaction): number {
  const p = Number(t.plannedAmount);
  return Number.isFinite(p) && p > 0 ? p : (Number(t.amount) || 0);
}

export interface Variance {
  planned: number;
  actual: number;
  /** Real − previsto. Positivo = passou do previsto. */
  diff: number;
  /** Diferença em % do previsto. `null` quando não havia previsão. */
  percent: number | null;
}

/** Compara previsto e real de um conjunto de lançamentos. */
export function computeVariance(transactions: Transaction[]): Variance {
  let planned = 0, actual = 0;
  for (const t of transactions) {
    if (t.status !== 'completed') continue;
    planned = round2(planned + plannedOf(t));
    actual = round2(actual + (Number(t.amount) || 0));
  }
  const diff = round2(actual - planned);
  return {
    planned, actual, diff,
    percent: planned > 0 ? round2((diff / planned) * 100) : null,
  };
}

export interface PeriodTotals {
  receita: number;
  despesa: number;
  resultado: number;
  porCategoria: Record<string, number>;
}

/** Totais realizados entre duas datas (inclusive), ignorando transferências. */
export function periodTotals(
  transactions: Transaction[],
  start: Date,
  end: Date
): PeriodTotals {
  const ini = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const fim = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);

  let receita = 0, despesa = 0;
  const porCategoria: Record<string, number> = {};

  for (const t of transactions) {
    if (t.status !== 'completed') continue;
    if (t.type === 'transfer') continue;
    if (t.crossEntityGroupId) continue;  // dinheiro andando entre PF e PJ
    if (isCardExpense(t)) continue;      // compra no cartão é paga na fatura, fora do caixa

    const d = parseLocalDate(t.date);
    if (Number.isNaN(d.getTime()) || d < ini || d >= fim) continue;

    const valor = Number(t.amount) || 0;
    if (t.type === 'income') receita = round2(receita + valor);
    else {
      despesa = round2(despesa + valor);
      porCategoria[t.categoryId] = round2((porCategoria[t.categoryId] || 0) + valor);
    }
  }

  return { receita, despesa, resultado: round2(receita - despesa), porCategoria };
}

/**
 * Análise vertical: o valor como % da receita do período.
 * `null` sem receita — dividir por zero daria Infinity na tela.
 */
export function verticalAnalysis(value: number, receita: number): number | null {
  if (!(receita > 0)) return null;
  return round2((value / receita) * 100);
}

/**
 * Análise horizontal: variação de A para B, em %.
 * `null` quando A é zero: crescer a partir de zero é infinito, e mostrar
 * "+∞%" ou "+100%" seria inventar informação.
 */
export function horizontalAnalysis(a: number, b: number): number | null {
  if (a === 0) return null;
  return round2(((b - a) / Math.abs(a)) * 100);
}
