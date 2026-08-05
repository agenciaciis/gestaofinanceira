/**
 * DRE gerencial: margem de contribuição e ponto de equilíbrio.
 *
 * Estrutura trazida da planilha antiga do usuário, que era melhor que o sistema
 * nisso:
 *
 *   Receitas
 *   ( − ) Custos variáveis        -> gastos que acompanham a venda
 *   ( = ) Margem de contribuição  -> o que sobra para pagar a estrutura
 *   ( − ) Despesas fixas          -> existem mesmo vendendo zero
 *   ( = ) Lucro operacional
 *   ( − ) Investimentos
 *   ( = ) Resultado
 *
 * A margem é o que permite responder a pergunta mais importante de uma
 * agência: quanto preciso faturar para não ter prejuízo.
 */
import { Transaction } from '../types';
import { parseLocalDate, round2, isCardExpense } from './finance';

export type CategoryKind = 'variable' | 'fixed' | 'investment';

/** Como cada categoria de DESPESA se comporta. Receita não entra aqui. */
export type CategoryKindMap = Record<string, CategoryKind>;

export interface DRE {
  receita: number;
  custoVariavel: number;
  margemContribuicao: number;
  /** Margem em % da receita. 0 quando não houve receita. */
  margemPercent: number;
  despesaFixa: number;
  lucroOperacional: number;
  investimentos: number;
  resultado: number;
  /** Categorias de despesa sem classificação — contadas como fixas. */
  semClassificacao: string[];
}

/**
 * Monta o DRE do mês de referência, sobre o que foi REALIZADO.
 *
 * Despesa de categoria não classificada entra como FIXA de propósito: tratar
 * desconhecido como variável inflaria a margem e faria o ponto de equilíbrio
 * parecer mais fácil do que é. Errar para o lado conservador.
 */
export function computeDRE(
  transactions: Transaction[],
  kinds: CategoryKindMap,
  reference: Date = new Date()
): DRE {
  const inicio = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const fim = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);

  let receita = 0, custoVariavel = 0, despesaFixa = 0, investimentos = 0;
  const semClassificacao = new Set<string>();

  for (const t of transactions) {
    if (t.status !== 'completed') continue;
    if (t.type === 'transfer') continue;
    // Dinheiro andando entre PF e PJ não é receita nem despesa do grupo.
    if (t.crossEntityGroupId) continue;
    // Compra no cartão é paga na fatura — fica de fora do caixa (consistente
    // com Lançamentos, Dashboard e o resto do Relatório).
    if (isCardExpense(t)) continue;

    const d = parseLocalDate(t.date);
    if (Number.isNaN(d.getTime()) || d < inicio || d >= fim) continue;

    const valor = Number(t.amount) || 0;
    if (t.type === 'income') {
      receita = round2(receita + valor);
      continue;
    }

    const kind = kinds[t.categoryId];
    if (!kind) semClassificacao.add(t.categoryId);

    if (kind === 'variable') custoVariavel = round2(custoVariavel + valor);
    else if (kind === 'investment') investimentos = round2(investimentos + valor);
    else despesaFixa = round2(despesaFixa + valor);
  }

  const margemContribuicao = round2(receita - custoVariavel);
  const margemPercent = receita > 0 ? round2((margemContribuicao / receita) * 100) : 0;
  const lucroOperacional = round2(margemContribuicao - despesaFixa);

  return {
    receita, custoVariavel, margemContribuicao, margemPercent,
    despesaFixa, lucroOperacional, investimentos,
    resultado: round2(lucroOperacional - investimentos),
    semClassificacao: [...semClassificacao],
  };
}

/**
 * Faturamento necessário para o lucro operacional ser zero.
 * `null` quando a margem é zero ou negativa: aí não existe faturamento que
 * resolva — cada venda piora o resultado, e o problema é preço ou custo.
 */
export function breakEven(despesaFixa: number, margemPercent: number): number | null {
  const fixa = Math.max(0, Number(despesaFixa) || 0);
  const margem = Number(margemPercent) || 0;
  if (fixa === 0) return 0;
  if (margem <= 0) return null;
  return round2(fixa / (margem / 100));
}
