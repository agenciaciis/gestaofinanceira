/**
 * Fachada de IA do cliente.
 *
 * Nada aqui fala com a OpenAI diretamente: a chave mora no servidor. Este
 * módulo só envia os dados para /api/ai/* com o token do usuário logado.
 */
import { auth } from '../firebase';
import { parseAmountBR, parseFlexibleDate, ParsedRow } from '../lib/statementParsers';

/** Chama um endpoint de IA autenticado. Lança em erro de rede/servidor. */
async function callAi<T>(path: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Você precisa estar logado para usar a IA.');
  const token = await user.getIdToken();

  const response = await fetch(`/api/ai/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail?.error || 'Falha ao consultar a IA.');
  }
  return response.json() as Promise<T>;
}

/**
 * Sugere a categoria de várias descrições de uma vez.
 * Nunca lança: em erro, devolve 'outros' para todas — a importação continua.
 */
export const suggestCategories = async (
  descriptions: string[],
  type: 'income' | 'expense'
): Promise<string[]> => {
  try {
    const { categoryIds } = await callAi<{ categoryIds: string[] }>('suggest-categories', {
      descriptions,
      type,
    });
    return descriptions.map((_, i) => categoryIds[i] || 'outros');
  } catch (error) {
    console.error('Erro ao sugerir categorias:', error);
    return descriptions.map(() => 'outros');
  }
};

/**
 * Sugere a categoria de UMA descrição (usado no formulário de lançamento).
 * Devolve `null` quando não consegue sugerir, para o formulário não mexer no
 * que o usuário já escolheu.
 */
export const suggestCategory = async (
  description: string,
  type: 'income' | 'expense'
): Promise<string | null> => {
  if (!description.trim()) return null;
  try {
    const { categoryIds } = await callAi<{ categoryIds: string[] }>('suggest-categories', {
      descriptions: [description],
      type,
    });
    return categoryIds[0] || null;
  } catch (error) {
    console.error('Erro ao sugerir categoria:', error);
    return null;
  }
};

export interface FinancialAdviceInput {
  balance: number;
  debts: { name: string; amount: number; interest: number | null }[];
  recentTransactions: { desc: string; amount: number; type: string }[];
}

/** Análise da saúde financeira com foco em quitar dívidas. */
export const getFinancialAdvice = async (input: FinancialAdviceInput): Promise<string> => {
  const { advice } = await callAi<{ advice: string }>('financial-advice', input);
  return advice;
};

/**
 * Extrai as transações de um extrato/fatura em PDF usando a IA, enviando o
 * arquivo ao servidor. Retorna linhas já normalizadas (data 'YYYY-MM-DD',
 * valor com sinal).
 */
export const extractStatementFromPdf = async (
  base64: string,
  mimeType: string
): Promise<ParsedRow[]> => {
  const { rows } = await callAi<{ rows: { date: string; description: string; amount: number }[] }>(
    'parse-statement',
    { base64, mimeType }
  );

  return (rows || [])
    .map((r) => ({
      date: parseFlexibleDate(r.date),
      description: String(r.description || 'Lançamento importado'),
      amount: typeof r.amount === 'number' ? r.amount : parseAmountBR(r.amount),
    }))
    .filter((r) => r.date && Number.isFinite(r.amount));
};
