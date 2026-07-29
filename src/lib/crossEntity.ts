/**
 * Separação e consolidação PF × PJ.
 *
 * O problema que este módulo resolve: quando dinheiro sai da empresa e entra
 * na pessoa física (pró-labore, distribuição de lucros), o sistema antigo
 * registrava dois lançamentos soltos — uma despesa na PJ e uma receita na PF.
 * No consolidado isso aparecia como se a pessoa tivesse *ganho* dinheiro novo
 * e a empresa tivesse *gasto*. Não é. É o mesmo dinheiro mudando de bolso.
 *
 * Aqui as duas pontas compartilham um `crossEntityGroupId` e se ANULAM no
 * consolidado, continuando visíveis na visão de cada entidade — que é como o
 * contador e o dono precisam ver, respectivamente.
 */
import { CrossEntityKind, Entity, EntityType, Transaction } from '../types';
import { parseLocalDate, round2 } from './finance';

export interface EntityTotals {
  income: number;
  expense: number;
  net: number;
}

export interface ConsolidatedResult {
  /** Totais por entidade — o pró-labore APARECE aqui (é real para cada uma). */
  byEntity: Record<string, EntityTotals>;
  /** Totais somados por natureza jurídica. */
  byType: Record<EntityType, EntityTotals>;
  /** Total do grupo, já SEM o movimento interno. */
  consolidated: EntityTotals;
  /** Quanto circulou entre as entidades no período. */
  internalFlow: number;
  /** Despesa pessoal paga por uma PJ — o que o contador vai querer discutir. */
  personalExpensePaidByCompany: number;
}

/** `true` se o lançamento é uma das pontas de um movimento entre entidades. */
export function isInternalTransfer(t: Pick<Transaction, 'crossEntityGroupId'>): boolean {
  return !!t.crossEntityGroupId;
}

export interface CrossEntityPairInput {
  groupId: string;
  fromEntityId: string;
  toEntityId: string;
  amount: number;
  date: string;
  kind: CrossEntityKind;
  description: string;
  fromAccountId?: string | null;
  toAccountId?: string | null;
}

export interface CrossEntityPair {
  groupId: string;
  from: Partial<Transaction> & { entityId: string; type: 'expense' };
  to: Partial<Transaction> & { entityId: string; type: 'income' };
}

/**
 * Monta as duas pontas de um movimento entre entidades.
 * Não grava nada — devolve os objetos para quem for persistir em lote, para
 * que as duas pontas nasçam juntas ou nenhuma nasça.
 */
export function buildCrossEntityPair(input: CrossEntityPairInput): CrossEntityPair {
  const amount = round2(Number(input.amount) || 0);
  if (!(amount > 0)) throw new Error('Informe um valor maior que zero.');
  if (!input.fromEntityId || !input.toEntityId) throw new Error('Escolha a origem e o destino.');
  if (input.fromEntityId === input.toEntityId) {
    throw new Error('Origem e destino precisam ser entidades diferentes.');
  }

  const shared = {
    amount,
    date: input.date,
    status: 'completed' as const,
    categoryId: 'transferencia',
    crossEntityGroupId: input.groupId,
    crossEntityKind: input.kind,
  };

  return {
    groupId: input.groupId,
    from: {
      ...shared,
      description: input.description,
      type: 'expense',
      entityId: input.fromEntityId,
      counterpartEntityId: input.toEntityId,
      accountId: input.fromAccountId ?? null,
    },
    to: {
      ...shared,
      description: input.description,
      type: 'income',
      entityId: input.toEntityId,
      counterpartEntityId: input.fromEntityId,
      accountId: input.toAccountId ?? null,
    },
  };
}

const emptyTotals = (): EntityTotals => ({ income: 0, expense: 0, net: 0 });

/**
 * Consolida o mês de referência entre todas as entidades.
 * Considera apenas lançamentos CONCLUÍDOS do mês — é foto do realizado.
 */
export function consolidate(
  transactions: Transaction[],
  entities: Entity[],
  reference: Date = new Date()
): ConsolidatedResult {
  const monthStart = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const monthEnd = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);
  const typeById = new Map(entities.map(e => [e.id, e.type]));

  const byEntity: Record<string, EntityTotals> = {};
  for (const e of entities) byEntity[e.id] = emptyTotals();
  const byType: Record<EntityType, EntityTotals> = { PF: emptyTotals(), PJ: emptyTotals() };
  const consolidated = emptyTotals();
  let internalFlow = 0;
  let personalExpensePaidByCompany = 0;

  for (const t of transactions) {
    if (t.status !== 'completed') continue;
    // Transferência entre contas da mesma entidade não é receita nem despesa.
    if (t.type === 'transfer') continue;

    const d = parseLocalDate(t.date);
    if (Number.isNaN(d.getTime())) continue;
    if (d < monthStart || d >= monthEnd) continue;

    const amount = Number(t.amount) || 0;
    const entityType = typeById.get(t.entityId);

    if (!byEntity[t.entityId]) byEntity[t.entityId] = emptyTotals();
    const bucket = byEntity[t.entityId];

    if (t.type === 'income') {
      bucket.income = round2(bucket.income + amount);
    } else {
      bucket.expense = round2(bucket.expense + amount);
      if (entityType === 'PJ' && t.personalExpense) {
        personalExpensePaidByCompany = round2(personalExpensePaidByCompany + amount);
      }
    }

    if (entityType) {
      const typeBucket = byType[entityType];
      if (t.type === 'income') typeBucket.income = round2(typeBucket.income + amount);
      else typeBucket.expense = round2(typeBucket.expense + amount);
    }

    // No consolidado, o movimento interno se anula: conta só o fluxo dele.
    if (isInternalTransfer(t)) {
      // Só uma das pontas alimenta o total, para não dobrar o valor.
      if (t.type === 'expense') internalFlow = round2(internalFlow + amount);
      continue;
    }

    if (t.type === 'income') consolidated.income = round2(consolidated.income + amount);
    else consolidated.expense = round2(consolidated.expense + amount);
  }

  for (const totals of [...Object.values(byEntity), byType.PF, byType.PJ, consolidated]) {
    totals.net = round2(totals.income - totals.expense);
  }

  return { byEntity, byType, consolidated, internalFlow, personalExpensePaidByCompany };
}
