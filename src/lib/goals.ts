/**
 * Metas / caixinhas — juntar dinheiro para um objetivo (praia, carro, reserva).
 *
 * Mesmo princípio das dívidas: o quanto já foi guardado é DERIVADO dos
 * lançamentos marcados com a meta, nunca digitado. Assim o número não
 * desatualiza e não existe a chance de o saldo da caixinha discordar do
 * extrato.
 *
 * Sinal do movimento: quando o lançamento traz `goalDirection`, ela manda.
 * Isso é necessário porque guardar e resgatar são os DOIS 'transfer' — o tipo
 * do lançamento não distingue, e sem a direção o resgate somaria no progresso.
 * Sem `goalDirection`, cai na inferência antiga: despesa/transferência entra
 * (+), receita sai (−).
 */
import { Goal, Transaction } from '../types';
import { parseLocalDate, round2 } from './finance';

export interface GoalProgress {
  saved: number;
  remaining: number;
  /** 0 a 100, travado no teto. */
  percent: number;
  complete: boolean;
}

export function computeGoalProgress(goal: Goal, transactions: Transaction[]): GoalProgress {
  let saved = 0;
  for (const t of transactions) {
    if (t.goalId !== goal.id) continue;
    if (t.status !== 'completed') continue;
    const amount = Number(t.amount) || 0;
    const entra = t.goalDirection
      ? t.goalDirection === 'in'
      : t.type !== 'income';
    saved = round2(saved + (entra ? amount : -amount));
  }

  const target = Number(goal.targetAmount) || 0;
  const remaining = round2(Math.max(0, target - saved));
  const percent = target > 0 ? Math.min(100, Math.max(0, (saved / target) * 100)) : 0;

  return { saved, remaining, percent, complete: target > 0 && saved >= target };
}

/** Meses cheios entre a referência e o prazo, contando o mês corrente. */
function monthsUntil(deadline: string, reference: Date): number {
  const end = parseLocalDate(deadline);
  if (Number.isNaN(end.getTime())) return 0;
  const months =
    (end.getFullYear() - reference.getFullYear()) * 12 + (end.getMonth() - reference.getMonth()) + 1;
  return Math.max(0, months);
}

/**
 * Quanto guardar por mês para bater o prazo.
 * `null` quando não há prazo — sem data não dá para cobrar ritmo.
 */
export function monthlyNeeded(
  remaining: number,
  deadline: string | null | undefined,
  reference: Date = new Date()
): number | null {
  if (!deadline) return null;
  const falta = Math.max(0, Number(remaining) || 0);
  if (falta === 0) return 0;
  const months = monthsUntil(deadline, reference);
  if (months <= 0) return round2(falta); // prazo estourado: é tudo agora
  return round2(falta / months);
}

export interface GoalForecast {
  /** Ritmo real: média mensal do que foi guardado nos meses completos anteriores. */
  monthlyPace: number;
  /** Meses até bater a meta nesse ritmo. `null` se o ritmo é zero. */
  monthsToFinish: number | null;
  finishDate: Date | null;
}

/**
 * Projeção pelo ritmo REAL dos últimos meses completos, não pelo que a pessoa
 * prometeu guardar. É a diferença entre plano e realidade.
 */
export function goalForecast(
  goal: Goal,
  transactions: Transaction[],
  reference: Date = new Date(),
  lookbackMonths = 3
): GoalForecast {
  const firstOfCurrent = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const start = new Date(reference.getFullYear(), reference.getMonth() - lookbackMonths, 1);

  let total = 0;
  const monthsWithData = new Set<string>();
  for (const t of transactions) {
    if (t.goalId !== goal.id || t.status !== 'completed') continue;
    const d = parseLocalDate(t.date);
    if (Number.isNaN(d.getTime()) || d < start || d >= firstOfCurrent) continue;
    const valor = Number(t.amount) || 0;
    const entra = t.goalDirection ? t.goalDirection === 'in' : t.type !== 'income';
    total += entra ? valor : -valor;
    monthsWithData.add(`${d.getFullYear()}-${d.getMonth()}`);
  }

  const monthlyPace = monthsWithData.size > 0 ? round2(total / monthsWithData.size) : 0;
  const { remaining } = computeGoalProgress(goal, transactions);

  if (remaining <= 0) {
    return { monthlyPace, monthsToFinish: 0, finishDate: reference };
  }
  if (monthlyPace <= 0) {
    return { monthlyPace, monthsToFinish: null, finishDate: null };
  }

  const monthsToFinish = Math.ceil(remaining / monthlyPace);
  const finishDate = new Date(reference.getFullYear(), reference.getMonth() + monthsToFinish, 1);
  return { monthlyPace, monthsToFinish, finishDate };
}

export type GoalStatusKey = 'concluida' | 'atrasada' | 'em-andamento';

export function goalStatus(goal: Goal, saved: number, reference: Date = new Date()): GoalStatusKey {
  const target = Number(goal.targetAmount) || 0;
  if (target > 0 && saved >= target) return 'concluida';
  if (goal.deadline) {
    const end = parseLocalDate(goal.deadline);
    const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
    if (!Number.isNaN(end.getTime()) && end < today) return 'atrasada';
  }
  return 'em-andamento';
}
