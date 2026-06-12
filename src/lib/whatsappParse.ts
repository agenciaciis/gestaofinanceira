/**
 * Interpretação PURA de mensagens de WhatsApp para lançamentos financeiros.
 * Reconhece linguagem natural ("gastei 50 no posto", "recebi 200 do cliente"),
 * comandos (saldo, extrato, ajuda, dívidas) e correções ("apagar último",
 * "corrigir último para 80"). Sem dependência de rede — testável isoladamente.
 */
import { parseAmountBR } from './statementParsers';

export type WhatsAppIntent =
  | { kind: 'transaction'; type: 'income' | 'expense'; amount: number; description: string; categoryId: string }
  | { kind: 'command'; command: 'saldo' | 'extrato' | 'ajuda' | 'dividas' }
  | { kind: 'delete_last' }
  | { kind: 'edit_last'; amount: number }
  | null;

const EXPENSE_WORDS = ['gastei', 'paguei', 'comprei', 'gasto', 'despesa', 'saiu', 'saída', 'saida', 'debitei'];
const INCOME_WORDS = ['recebi', 'recebimento', 'receita', 'entrou', 'ganhei', 'vendi', 'venda', 'caiu'];

const CATEGORY_KEYWORDS: { id: string; words: string[] }[] = [
  { id: 'transporte', words: ['posto', 'gasolina', 'combust', 'uber', '99', 'taxi', 'táxi', 'onibus', 'ônibus', 'passagem', 'estacionamento', 'pedágio', 'pedagio', 'etanol', 'diesel'] },
  { id: 'alimentacao', words: ['mercado', 'supermercado', 'restaurante', 'lanche', 'ifood', 'padaria', 'açougue', 'acougue', 'comida', 'almoço', 'almoco', 'jantar', 'café', 'cafe', 'feira'] },
  { id: 'moradia', words: ['aluguel', 'condominio', 'condomínio', 'luz', 'energia', 'água', 'agua', 'internet', 'gás', ' gas', 'iptu'] },
  { id: 'saude', words: ['farmacia', 'farmácia', 'remedio', 'remédio', 'medico', 'médico', 'consulta', 'exame', 'hospital', 'dentista', 'plano de saude', 'plano de saúde'] },
  { id: 'lazer', words: ['cinema', 'netflix', 'spotify', 'bar', 'show', 'viagem', 'jogo', 'balada'] },
  { id: 'educacao', words: ['curso', 'escola', 'faculdade', 'livro', 'mensalidade', 'aula'] },
  { id: 'servicos', words: ['assinatura', 'software', 'hospedagem', 'dominio', 'domínio', 'serviço', 'servico'] },
  { id: 'salario', words: ['salario', 'salário', 'pagamento mensal'] },
  { id: 'venda', words: ['venda', 'vendi', 'cliente', 'projeto', 'serviço prestado'] },
];

const INCOME_CATEGORY_IDS = ['salario', 'venda'];

function detectCategory(text: string, type: 'income' | 'expense'): string {
  const lower = text.toLowerCase();
  for (const cat of CATEGORY_KEYWORDS) {
    const isIncomeCat = INCOME_CATEGORY_IDS.includes(cat.id);
    // Receita só casa categorias de receita; despesa só casa categorias de despesa.
    if (type === 'income' && !isIncomeCat) continue;
    if (type === 'expense' && isIncomeCat) continue;
    if (cat.words.some(w => lower.includes(w))) return cat.id;
  }
  return type === 'income' ? 'venda' : 'outros';
}

/** Extrai o primeiro valor monetário plausível do texto. */
export function extractAmount(text: string): number {
  // captura tokens como "50", "50,00", "1.234,56", "1234.56", "R$ 99,90"
  const matches = text.match(/r?\$?\s*\d[\d.,]*/gi);
  if (!matches) return NaN;
  for (const m of matches) {
    const n = parseAmountBR(m);
    if (Number.isFinite(n) && Math.abs(n) > 0) return Math.abs(n);
  }
  return NaN;
}

/** Limpa a descrição removendo palavra-chave, valor e conectores. */
function buildDescription(raw: string, amountToken: RegExpMatchArray | null): string {
  let s = ' ' + raw.toLowerCase() + ' ';
  [...EXPENSE_WORDS, ...INCOME_WORDS].forEach(w => {
    s = s.replace(new RegExp(`\\b${w}\\b`, 'gi'), ' ');
  });
  // remove valor
  s = s.replace(/r?\$?\s*\d[\d.,]*/gi, ' ');
  // remove conectores e unidades comuns
  s = s.replace(/\b(reais|real|de|do|da|no|na|em|com|pra|para|por|o|a|um|uma|meu|minha)\b/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // Capitaliza
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function parseFinanceMessage(rawText: string): WhatsAppIntent {
  if (!rawText) return null;
  const text = rawText.trim();
  const lower = text.toLowerCase();

  // Comandos simples
  if (/^(saldo|meu saldo)\b/.test(lower)) return { kind: 'command', command: 'saldo' };
  if (/^(extrato|últimos|ultimos)\b/.test(lower)) return { kind: 'command', command: 'extrato' };
  if (/^(ajuda|help|comandos|menu)\b/.test(lower)) return { kind: 'command', command: 'ajuda' };
  if (/^(d[íi]vidas?)\b/.test(lower)) return { kind: 'command', command: 'dividas' };

  // Correções
  if (/\b(apagar|apague|excluir|exclua|cancelar|cancele|remover|remova|deletar|delete)\b.*\b([uú]ltimo|[uú]ltima)\b/.test(lower)
      || /^(apagar|cancelar|desfazer)\b/.test(lower)) {
    return { kind: 'delete_last' };
  }
  if (/\b(corrigir|corrige|corrija|editar|edite|alterar|altere|mudar|mude|ajustar|ajuste)\b/.test(lower)) {
    const amount = extractAmount(text);
    if (Number.isFinite(amount)) return { kind: 'edit_last', amount };
  }

  // Lançamento por linguagem natural
  const isIncome = INCOME_WORDS.some(w => new RegExp(`\\b${w}\\b`, 'i').test(lower));
  const isExpense = EXPENSE_WORDS.some(w => new RegExp(`\\b${w}\\b`, 'i').test(lower));

  // Também aceita o comando antigo "lançar 50 descrição"
  const lancarMatch = /^(lan[çc]ar)\s+/i.test(lower);

  if (isIncome || isExpense || lancarMatch) {
    const amount = extractAmount(text);
    if (!Number.isFinite(amount)) return null;
    const type: 'income' | 'expense' = isIncome && !isExpense ? 'income' : 'expense';
    const cleanDesc = buildDescription(text.replace(/^lan[çc]ar\s+/i, ''), null);
    const description = cleanDesc || (type === 'income' ? 'Recebimento' : 'Despesa');
    // Categoriza pela descrição limpa (sem o valor), evitando colisão com dígitos.
    const categoryId = detectCategory(cleanDesc, type);
    return { kind: 'transaction', type, amount, description, categoryId };
  }

  return null;
}
