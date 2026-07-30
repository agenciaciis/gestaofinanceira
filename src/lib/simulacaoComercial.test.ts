/**
 * Simulação do fluxo COMERCIAL ponta a ponta (1 ano), cruzando com o financeiro:
 * orçamento → conversão (OS) → receita a receber → aparece em partyTotals e,
 * quando recebida, no saldo. Garante que "o comercial conversa com o financeiro".
 */
import { describe, it, expect } from 'vitest';
import { BankAccount, Quote, Transaction } from '../types';
import { quoteToRevenueTransactions, alreadyConverted, activeOrdersForClient, OrderEntity } from './orders';
import { partyTotals } from './quotes';
import { computeBalances, round2 } from './finance';

const entity: OrderEntity = { id: 'pj', ownerUid: 'u1', collaboratorsEmails: [] };

const contas: BankAccount[] = [
  { id: 'pj-cc', bankName: 'Inter PJ', type: 'corrente', initialBalance: 5000, currentBalance: 0, entityId: 'pj' },
];

let seq = 0;
const quote = (over: Partial<Quote>): Quote => ({
  id: `q${++seq}`, quoteNumber: `ORC-2026-${String(seq).padStart(4, '0')}`,
  clientId: 'c1', clientName: 'Cliente', date: '2026-01-10', validUntil: '2026-01-20',
  items: [], subtotal: 0, discountTotal: 0, total: 0, paymentMethod: 'PIX', installments: 1,
  status: 'approved', entityId: 'pj', createdAt: null, ...over,
});

/** 12 meses de orçamentos convertidos, misturando os três tipos de cobrança. */
function gerarAno() {
  const quotes: Quote[] = [
    // Site à vista para o cliente A
    quote({ clientId: 'A', clientName: 'Padaria do Zé', total: 4500, installments: 1, date: '2026-02-05', status: 'converted' }),
    // Identidade visual parcelada 3x para o cliente B
    quote({ clientId: 'B', clientName: 'Studio Bella', total: 3000, installments: 3, date: '2026-03-08', status: 'converted' }),
    // Social media recorrente mensal para o cliente A
    quote({ clientId: 'A', clientName: 'Padaria do Zé', total: 1200, installments: 1, date: '2026-01-15', status: 'converted',
      recurrenceConfig: { enabled: true, frequency: 'monthly', startDate: '2026-01-15' } }),
    // Tráfego pago recorrente para o cliente C
    quote({ clientId: 'C', clientName: 'Ótica Vision', total: 900, installments: 1, date: '2026-04-01', status: 'converted',
      recurrenceConfig: { enabled: true, frequency: 'monthly', startDate: '2026-04-01' } }),
    // Orçamento ainda em aberto (não converte, não gera receita)
    quote({ clientId: 'B', clientName: 'Studio Bella', total: 8000, installments: 1, date: '2026-05-10', status: 'sent' }),
  ];

  // Converte os aprovados/convertidos (o motor só é chamado para os que viram OS).
  let idc = 0;
  const transactions: Transaction[] = [];
  for (const q of quotes.filter(x => x.status === 'converted')) {
    for (const draft of quoteToRevenueTransactions(q, entity)) {
      transactions.push({ id: `tx${++idc}`, ...draft } as Transaction);
    }
  }
  return { quotes, transactions };
}

const { quotes, transactions } = gerarAno();

describe('comercial 1 ano — conversão gera receita coerente', () => {
  it('cada OS convertida vira receita a receber (nada perdido, nada duplicado)', () => {
    // 3 tipos: à vista (1), parcelado 3x (3), 2 recorrentes (1 cada) = 6 lançamentos
    expect(transactions).toHaveLength(1 + 3 + 1 + 1);
    for (const t of transactions) {
      expect(t.type).toBe('income');
      expect(t.status).toBe('pending');
      expect(Number.isFinite(t.amount)).toBe(true);
      expect(t.sourceQuoteId).toBeTruthy();
      expect(t.clientId).toBeTruthy();
    }
  });

  it('parcelamento fecha o total exatamente', () => {
    const parc = transactions.filter(t => t.installmentGroupId);
    expect(parc).toHaveLength(3);
    expect(round2(parc.reduce((a, t) => a + t.amount, 0))).toBe(3000);
  });

  it('recorrentes ficam marcados para o recurring.ts renovar', () => {
    const rec = transactions.filter(t => t.isRecurring);
    expect(rec).toHaveLength(2);
    for (const r of rec) expect(r.recurringPeriod).toBe('monthly');
  });
});

describe('comercial 1 ano — conversa com o financeiro', () => {
  it('partyTotals mostra o a receber por cliente', () => {
    // Cliente A: site 4500 + social 1200 = 5700 a receber
    expect(partyTotals(transactions, 'A').aReceber).toBe(5700);
    // Cliente B convertido: só a identidade parcelada (o de 8000 está 'sent', não converteu)
    expect(partyTotals(transactions, 'B').aReceber).toBe(3000);
    expect(partyTotals(transactions, 'C').aReceber).toBe(900);
  });

  it('receita pendente NÃO entra no saldo até ser recebida', () => {
    const saldoAntes = round2(Object.values(computeBalances(contas, transactions)).reduce((a, v) => a + v, 0));
    expect(saldoAntes).toBe(5000); // só o saldo inicial; pendentes não contam

    // Recebe a 1ª parcela da identidade (marca completed + conta)
    const recebida = transactions.map(t =>
      t.installmentGroupId && t.installmentNumber === 1
        ? { ...t, status: 'completed' as const, accountId: 'pj-cc' }
        : t);
    const saldoDepois = round2(Object.values(computeBalances(contas, recebida)).reduce((a, v) => a + v, 0));
    expect(saldoDepois).toBe(round2(5000 + 1000)); // 3000/3 = 1000 entrou
    expect(partyTotals(recebida, 'B').recebido).toBe(1000);
    expect(partyTotals(recebida, 'B').aReceber).toBe(2000);
  });

  it('activeOrdersForClient lista as OS do cliente e alreadyConverted protege reconversão', () => {
    expect(activeOrdersForClient(quotes, 'A').length).toBe(2);
    expect(alreadyConverted(activeOrdersForClient(quotes, 'A')[0].id, transactions)).toBe(true);
    expect(alreadyConverted('inexistente', transactions)).toBe(false);
  });
});
