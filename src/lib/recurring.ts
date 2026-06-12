/**
 * Lógica PURA de renovação de lançamentos recorrentes (aluguel, mensalidades...).
 * Sem dependência de Firebase: recebe as transações e devolve quais NOVAS
 * ocorrências precisam ser criadas para manter um horizonte futuro coberto.
 *
 * Regra de "encerrar": se o usuário apaga todas as ocorrências futuras, a mais
 * recente do grupo fica no passado — então o grupo é considerado encerrado e
 * NÃO é renovado. Enquanto houver ocorrência futura, o horizonte é mantido.
 */
import { Transaction } from '../types';
import { parseLocalDate, formatLocalDate } from './finance';

export type RecurringPeriod = 'monthly' | 'weekly' | 'yearly';

/** Próxima data a partir de `date` somando um período. */
export function addPeriod(date: Date, period: RecurringPeriod): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (period === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else if (period === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d;
}

export interface RenewalPlanItem {
  template: Transaction;
  dates: string[]; // novas datas 'YYYY-MM-DD' a criar para o grupo
}

/**
 * Planeja a renovação dos grupos recorrentes para manter ~`horizonMonths`
 * meses de ocorrências futuras. Retorna, por grupo ativo, o template (a
 * ocorrência mais recente) e as novas datas a serem criadas.
 *
 * @param today data de referência (injetável para testes)
 * @param horizonMonths quantos meses à frente manter cobertos
 * @param maxPerGroup trava de segurança contra geração descontrolada
 */
export function planRecurringRenewals(
  transactions: Transaction[],
  today: Date = new Date(),
  horizonMonths = 12,
  maxPerGroup = 24
): RenewalPlanItem[] {
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const horizonEnd = new Date(today0.getFullYear(), today0.getMonth() + horizonMonths, today0.getDate());

  // Agrupa por recurringGroupId.
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.isRecurring || !t.recurringGroupId) continue;
    const arr = groups.get(t.recurringGroupId) || [];
    arr.push(t);
    groups.set(t.recurringGroupId, arr);
  }

  const plan: RenewalPlanItem[] = [];

  for (const [, items] of groups) {
    // Ordena por data crescente; a última é o template/ponta da série.
    items.sort((a, b) => parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime());
    const latest = items[items.length - 1];
    const latestDate = parseLocalDate(latest.date);
    const period = (latest.recurringPeriod || 'monthly') as RecurringPeriod;

    // Grupo encerrado: nenhuma ocorrência futura (a mais recente está no passado).
    if (latestDate.getTime() < today0.getTime()) continue;

    // Já coberto até o horizonte?
    if (latestDate.getTime() >= horizonEnd.getTime()) continue;

    const existing = new Set(items.map(i => i.date));
    const dates: string[] = [];
    let cursor = addPeriod(latestDate, period);
    while (cursor.getTime() <= horizonEnd.getTime() && dates.length < maxPerGroup) {
      const ds = formatLocalDate(cursor);
      if (!existing.has(ds)) dates.push(ds);
      cursor = addPeriod(cursor, period);
    }

    if (dates.length > 0) plan.push({ template: latest, dates });
  }

  return plan;
}
