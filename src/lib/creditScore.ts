/**
 * Score de crédito (Serasa, SPC, Boa Vista) informado pelo usuário.
 *
 * É um dado EXTERNO: não é calculado aqui e não entra no score de saúde
 * financeira do sistema. São medidas diferentes — o nosso mede o seu
 * comportamento (comprometimento, reserva, dívida, pontualidade), este mede
 * como o mercado te enxerga. Misturar os dois esconderia os dois.
 */
import { parseLocalDate } from './finance';

export const SCORE_MAX = 1000;

/** Depois de quantos dias o score deixa de ser confiável e pede atualização. */
export const STALE_AFTER_DAYS = 45;

export type ScoreBandKey = 'muito-baixo' | 'baixo' | 'bom' | 'excelente';

export interface ScoreBand {
  key: ScoreBandKey;
  label: string;
  color: string;
  hint: string;
}

const BANDS: { max: number; band: ScoreBand }[] = [
  {
    max: 300,
    band: {
      key: 'muito-baixo', label: 'Muito baixo', color: '#e11d48',
      hint: 'Crédito quase sempre negado. Regularizar pendências é o que mais move esse número.',
    },
  },
  {
    max: 500,
    band: {
      key: 'baixo', label: 'Baixo', color: '#f59e0b',
      hint: 'Crédito difícil e caro. Pagar em dia por alguns meses seguidos já melhora.',
    },
  },
  {
    max: 700,
    band: {
      key: 'bom', label: 'Bom', color: '#3b82f6',
      hint: 'Boa parte do crédito liberada. Manter contas em dia sustenta a subida.',
    },
  },
  {
    max: Infinity,
    band: {
      key: 'excelente', label: 'Excelente', color: '#10b981',
      hint: 'Melhores condições e juros mais baixos disponíveis para você.',
    },
  },
];

/** Faixa do score, com rótulo, cor e o que fazer a respeito. */
export function scoreBand(score: number): ScoreBand {
  const value = Math.min(SCORE_MAX, Math.max(0, Number(score) || 0));
  return (BANDS.find(b => value <= b.max) ?? BANDS[BANDS.length - 1]).band;
}

/** Dias desde a última atualização. `null` se não há data válida. */
export function daysSinceUpdate(
  date: string | null | undefined,
  reference: Date = new Date()
): number | null {
  if (!date) return null;
  const d = parseLocalDate(date);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const MS = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.round((today.getTime() - d.getTime()) / MS));
}

/** `true` quando o score está velho demais para significar alguma coisa. */
export function isStale(date: string | null | undefined, reference: Date = new Date()): boolean {
  const days = daysSinceUpdate(date, reference);
  return days === null || days > STALE_AFTER_DAYS;
}

export interface ScoreEntry {
  score: number;
  date: string;
}

export interface ScoreTrend {
  current: number | null;
  previous: number | null;
  delta: number;
  direction: 'up' | 'down' | 'flat';
}

/**
 * Compara o registro mais recente com o anterior. Ordena por data aqui dentro:
 * não confia na ordem em que a lista chegou.
 */
export function scoreTrend(history: ScoreEntry[]): ScoreTrend {
  const sorted = [...history]
    .filter(e => e && Number.isFinite(Number(e.score)))
    .sort((a, b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime());

  if (sorted.length === 0) return { current: null, previous: null, delta: 0, direction: 'flat' };

  const current = Number(sorted[0].score);
  if (sorted.length === 1) return { current, previous: null, delta: 0, direction: 'flat' };

  const previous = Number(sorted[1].score);
  const delta = current - previous;
  return {
    current,
    previous,
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  };
}
