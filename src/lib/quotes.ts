/**
 * Matemática do orçamento e do que ele vira depois.
 *
 * Estava dentro do componente, então não tinha teste — e é dinheiro que vai
 * para o cliente num PDF assinado. Aqui fica isolado e coberto.
 */
import { Quote, QuoteItem, Transaction } from '../types';
import { parseLocalDate, round2, splitInstallments } from './finance';

export interface QuoteTotals {
  subtotal: number;
  discountTotal: number;
  total: number;
}

/** Valor bruto de um item: quantidade × preço unitário. */
export function itemGross(item: Pick<QuoteItem, 'quantity' | 'unitPrice'>): number {
  const q = Number(item.quantity);
  const p = Number(item.unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
  return round2(Math.max(0, q) * Math.max(0, p));
}

/**
 * Soma o orçamento. O desconto é somado UMA vez, no total geral — `item.total`
 * é bruto de propósito, senão o desconto entraria duas vezes.
 * O total nunca fica negativo: desconto maior que o subtotal zera, não inverte.
 */
export function quoteTotals(items: Pick<QuoteItem, 'quantity' | 'unitPrice' | 'discount'>[]): QuoteTotals {
  let subtotal = 0;
  let discountTotal = 0;
  for (const item of items) {
    subtotal = round2(subtotal + itemGross(item));
    const d = Number(item.discount);
    if (Number.isFinite(d) && d > 0) discountTotal = round2(discountTotal + d);
  }
  const total = round2(Math.max(0, subtotal - discountTotal));
  return { subtotal, discountTotal, total };
}

/** Valor de cada parcela do orçamento, fechando exatamente o total. */
export function quoteInstallments(total: number, installments: number): number[] {
  return splitInstallments(Math.max(0, Number(total) || 0), Math.max(1, Number(installments) || 1));
}

export interface QuotePipeline {
  /** Quantos e quanto por situação. */
  porStatus: Record<string, { quantidade: number; valor: number }>;
  /** Valor ainda em jogo: rascunho + enviado. */
  emAberto: number;
  /** Valor ganho: aprovado + convertido. */
  ganho: number;
  perdido: number;
  /** Aprovados ÷ (aprovados + recusados), em %. `null` sem nenhum decidido. */
  taxaAprovacao: number | null;
}

/** Funil dos orçamentos: onde está o dinheiro que você propôs. */
export function quotePipeline(quotes: Pick<Quote, 'status' | 'total'>[]): QuotePipeline {
  const porStatus: QuotePipeline['porStatus'] = {};
  for (const q of quotes) {
    const key = q.status || 'draft';
    const valor = Number(q.total) || 0;
    if (!porStatus[key]) porStatus[key] = { quantidade: 0, valor: 0 };
    porStatus[key].quantidade += 1;
    porStatus[key].valor = round2(porStatus[key].valor + valor);
  }
  const v = (k: string) => porStatus[k]?.valor || 0;
  const n = (k: string) => porStatus[k]?.quantidade || 0;

  const ganho = round2(v('approved') + v('converted'));
  const decididos = n('approved') + n('converted') + n('rejected');

  return {
    porStatus,
    emAberto: round2(v('draft') + v('sent')),
    ganho,
    perdido: v('rejected'),
    taxaAprovacao: decididos > 0 ? round2(((n('approved') + n('converted')) / decididos) * 100) : null,
  };
}

export interface PartyTotals {
  recebido: number;
  aReceber: number;
  pago: number;
  aPagar: number;
}

/**
 * Quanto passou por um cliente ou fornecedor. Separa o realizado do previsto:
 * juntar os dois faria parecer que já entrou dinheiro que ainda não entrou.
 */
export function partyTotals(
  transactions: Transaction[],
  clientId: string,
  start?: Date,
  end?: Date
): PartyTotals {
  const out: PartyTotals = { recebido: 0, aReceber: 0, pago: 0, aPagar: 0 };
  for (const t of transactions) {
    if (t.clientId !== clientId) continue;
    if (t.status === 'cancelled') continue;
    if (start && end) {
      const d = parseLocalDate(t.date);
      if (Number.isNaN(d.getTime()) || d < start || d > end) continue;
    }
    const valor = Number(t.amount) || 0;
    if (t.type === 'income') {
      if (t.status === 'completed') out.recebido = round2(out.recebido + valor);
      else out.aReceber = round2(out.aReceber + valor);
    } else if (t.type === 'expense') {
      if (t.status === 'completed') out.pago = round2(out.pago + valor);
      else out.aPagar = round2(out.aPagar + valor);
    }
  }
  return out;
}

export interface ServiceMargin {
  margem: number;
  margemPercent: number;
  valorHora: number | null;
}

/** Margem de um serviço e o valor por hora — diz se vale a pena vender. */
export function serviceMargin(
  basePrice: number,
  costPrice?: number | null,
  estimatedHours?: number | null
): ServiceMargin {
  const preco = Math.max(0, Number(basePrice) || 0);
  const custo = Math.max(0, Number(costPrice) || 0);
  const horas = Number(estimatedHours) || 0;
  const margem = round2(preco - custo);
  return {
    margem,
    margemPercent: preco > 0 ? round2((margem / preco) * 100) : 0,
    valorHora: horas > 0 ? round2(preco / horas) : null,
  };
}
