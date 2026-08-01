/**
 * Motor de conversão: orçamento aprovado → Ordem de Serviço → receita a receber.
 *
 * Função PURA (sem Firestore/rede): recebe o orçamento e devolve os lançamentos
 * de receita PENDENTE a criar, já vinculados ao cliente. Único, parcelado ou
 * recorrente. Cada lançamento carrega `sourceQuoteId` para idempotência
 * (reconverter não duplica) e para o histórico do cliente.
 */
import { Quote, Transaction } from '../types';
import { splitInstallments, parseLocalDate, formatLocalDate, round2 } from './finance';

export interface OrderEntity {
  id: string;
  ownerUid?: string;
  collaboratorsEmails?: string[];
}

/** Lançamento pronto para gravar (sem `id`), com os campos que o Firestore espera. */
export type RevenueDraft = Omit<Transaction, 'id'> & {
  ownerUid?: string;
  collaboratorsEmails?: string[];
};

// Soma meses sem "vazar" para o mês seguinte (dia 31 → último dia do mês alvo),
// igual ao date-fns usado no caminho manual de lançamentos.
function addMonths(base: Date, months: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(base.getDate(), ultimoDia));
  return d;
}

// Avança a data conforme a frequência da recorrência.
function stepDate(base: Date, freq: 'monthly' | 'weekly' | 'yearly' | undefined, i: number): Date {
  if (freq === 'weekly') { const d = new Date(base); d.setDate(base.getDate() + i * 7); return d; }
  if (freq === 'yearly') return addMonths(base, i * 12);
  return addMonths(base, i);
}

function mapPaymentType(method?: string): Transaction['paymentType'] | undefined {
  const m = (method || '').toLowerCase();
  if (m.includes('pix')) return 'pix';
  if (m.includes('boleto')) return 'boleto';
  if (m.includes('cart')) return 'credito';
  if (m.includes('transf')) return 'transferencia';
  return undefined;
}

/**
 * Receitas (pendentes) geradas por um orçamento convertido.
 * Vazio se o total não é positivo.
 */
export function quoteToRevenueTransactions(quote: Quote, entity: OrderEntity): RevenueDraft[] {
  const total = round2(Math.max(0, Number(quote.total) || 0));
  if (total <= 0) return [];

  const parsed = parseLocalDate(quote.date);
  const start = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  const common = {
    type: 'income' as const,
    status: 'pending' as const,
    categoryId: 'venda',
    entityId: entity.id,
    ownerUid: entity.ownerUid,
    collaboratorsEmails: entity.collaboratorsEmails || [],
    clientId: quote.clientId || '',
    clientName: quote.clientName || '',
    sourceQuoteId: quote.id,
    paymentType: mapPaymentType(quote.paymentMethod),
  };

  // Recorrente.
  if (quote.recurrenceConfig?.enabled) {
    const freq = quote.recurrenceConfig.frequency;
    const count = Math.max(0, Math.floor(Number(quote.recurrenceConfig.count) || 0));
    const rotulo = freq === 'weekly' ? 'semana' : freq === 'yearly' ? 'ano' : 'mês';

    // Prazo DEFINIDO (count > 0): gera exatamente N cobranças, uma por período.
    // São lançamentos comuns (sem isRecurring) — não se renovam sozinhos, batendo
    // com o "durante N períodos" impresso na proposta.
    if (count > 0) {
      const groupId = `rec-${quote.id}`;
      return Array.from({ length: count }, (_, i) => ({
        ...common,
        description: `${quote.clientName} — ${quote.quoteNumber} (${rotulo} ${i + 1}/${count})`,
        amount: total,
        date: formatLocalDate(stepDate(start, freq, i)),
        installmentGroupId: groupId,
        installmentNumber: i + 1,
        totalInstallments: count,
      }));
    }

    // Prazo INDETERMINADO (count = 0): um lançamento recorrente que o motor renova.
    return [{
      ...common,
      description: `${quote.clientName} — ${quote.quoteNumber} (recorrente)`,
      amount: total,
      date: formatLocalDate(start),
      isRecurring: true,
      recurringPeriod: freq,
      recurringGroupId: `rec-${quote.id}`,
    }];
  }

  const n = Math.max(1, Math.floor(Number(quote.installments) || 1));

  // Pagamento único.
  if (n <= 1) {
    return [{
      ...common,
      description: `${quote.clientName} — ${quote.quoteNumber}`,
      amount: total,
      date: formatLocalDate(start),
    }];
  }

  // Parcelado: N lançamentos mensais que fecham exatamente o total.
  const parcelas = splitInstallments(total, n);
  const groupId = `parc-${quote.id}`;
  return parcelas.map((valor, i) => ({
    ...common,
    description: `${quote.clientName} — ${quote.quoteNumber} (${i + 1}/${n})`,
    amount: valor,
    date: formatLocalDate(addMonths(start, i)),
    installmentNumber: i + 1,
    totalInstallments: n,
    installmentGroupId: groupId,
  }));
}

/** Já existe receita gerada por este orçamento? (idempotência da conversão) */
export function alreadyConverted(quoteId: string, transactions: Pick<Transaction, 'sourceQuoteId'>[]): boolean {
  return transactions.some(t => t.sourceQuoteId === quoteId);
}

/** Orçamentos convertidos de um cliente = as OS ativas dele. */
export function activeOrdersForClient(quotes: Quote[], clientId: string): Quote[] {
  return quotes.filter(q => q.clientId === clientId && q.status === 'converted');
}
