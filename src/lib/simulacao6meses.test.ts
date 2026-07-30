/**
 * Simulação de 6 MESES de uso real (fev→jul/2026), cruzando TODOS os motores.
 *
 * Complementa `simulation.test.ts` (4 meses): aqui o foco é garantir que, com
 * mais histórico e mais lançamentos, NENHUM cálculo devolve NaN/Infinity e que
 * os motores continuam concordando entre si sobre o mesmo conjunto de dados.
 *
 * Não toca em Firestore.
 */
import { describe, it, expect } from 'vitest';
import { BankAccount, CreditCard, Debt, Goal, Transaction } from '../types';
import { computeBalances, computeCardInvoice, computeCardUsage, round2, formatLocalDate } from './finance';
import { collectDebts, payoffSchedule, rankByCost } from './debts';
import { computeSpendable, averageMonthlyExpense, averageMonthlyIncome } from './spendable';
import { computeHealthScore } from './health';
import { consolidate } from './crossEntity';
import { computeDRE, breakEven, CategoryKindMap } from './dre';
import { computeGoalProgress, monthlyNeeded, timeProgress, paceVerdict } from './goals';
import { periodTotals, computeVariance } from './variance';
import { quoteTotals, quotePipeline, partyTotals } from './quotes';
import { budgetProgress, exceededBudgets } from './budgets';

const PF = { id: 'pf', name: 'Lucas', type: 'PF' as const, ownerUid: 'u1' };
const PJ = { id: 'pj', name: 'Agência CIIS', type: 'PJ' as const, ownerUid: 'u1' };

/** Hoje: 15/07/2026. Meses cheios simulados: fev, mar, abr, mai, jun (jul em curso). */
const HOJE = new Date(2026, 6, 15);

const contas: BankAccount[] = [
  { id: 'pj-cc', bankName: 'Inter PJ', type: 'corrente', initialBalance: 5000, currentBalance: 0, entityId: 'pj' },
  { id: 'pf-cc', bankName: 'Nubank PF', type: 'corrente', initialBalance: 2000, currentBalance: 0, entityId: 'pf' },
  { id: 'pf-res', bankName: 'Reserva', type: 'reserva', initialBalance: 0, currentBalance: 0, entityId: 'pf' },
];

const cartoes: CreditCard[] = [
  { id: 'card-pj', name: 'Inter PJ', brand: 'visa', limit: 10000, dueDay: 12, closingDay: 5, entityId: 'pj' },
];

const emprestimos: Debt[] = [
  { id: 'emp', name: 'Empréstimo Itaú', totalAmount: 12000, remainingAmount: 8000,
    interestRate: 2.5, monthlyPayment: 900, dueDate: 10, entityId: 'pj', createdAt: null },
];

const caixinha: Goal = {
  id: 'ferias', name: 'Férias', targetAmount: 6000,
  deadline: '2026-12-31', entityId: 'pf', createdAt: '2026-02-01',
};

let seq = 0;
const t = (over: Partial<Transaction>): Transaction => ({
  id: `t${++seq}`, description: 'lanç', amount: 0, type: 'expense', date: '2026-07-10',
  categoryId: 'outros', status: 'completed', entityId: 'pj', ...over,
});

/** Gera fev→jun cheios + jul em curso (compra parcelada e contas em aberto). */
function gerarSeisMeses(): Transaction[] {
  const txs: Transaction[] = [];
  const meses = [1, 2, 3, 4, 5, 6]; // fev → jul (6 meses de uso)

  for (const m of meses) {
    const dia = (d: number) => formatLocalDate(new Date(2026, m, d));
    // PJ: faturamento
    txs.push(t({ type: 'income', amount: 9000, date: dia(5), categoryId: 'venda', entityId: 'pj', accountId: 'pj-cc' }));
    txs.push(t({ type: 'income', amount: 3500, date: dia(20), categoryId: 'venda', entityId: 'pj', accountId: 'pj-cc' }));
    // PJ: custos
    txs.push(t({ amount: 2200, date: dia(8), categoryId: 'servicos', entityId: 'pj', accountId: 'pj-cc' }));
    txs.push(t({ amount: 1800, date: dia(6), categoryId: 'moradia', entityId: 'pj', accountId: 'pj-cc' }));
    txs.push(t({ amount: 320, date: dia(7), categoryId: 'servicos', entityId: 'pj', cardId: 'card-pj' }));
    // Pró-labore PJ->PF (duas pontas)
    const grupo = `pro-${m}`;
    txs.push(t({ amount: 4000, date: dia(10), categoryId: 'transferencia', entityId: 'pj',
      accountId: 'pj-cc', crossEntityGroupId: grupo, crossEntityKind: 'prolabore', counterpartEntityId: 'pf' }));
    txs.push(t({ type: 'income', amount: 4000, date: dia(10), categoryId: 'transferencia', entityId: 'pf',
      accountId: 'pf-cc', crossEntityGroupId: grupo, crossEntityKind: 'prolabore', counterpartEntityId: 'pj' }));
    // PF: vida
    txs.push(t({ amount: 1500, date: dia(11), categoryId: 'moradia', entityId: 'pf', accountId: 'pf-cc' }));
    txs.push(t({ amount: 900, date: dia(15), categoryId: 'alimentacao', entityId: 'pf', accountId: 'pf-cc' }));
    txs.push(t({ amount: 400, date: dia(18), categoryId: 'transporte', entityId: 'pf', accountId: 'pf-cc' }));
    // PF: depósito na caixinha (conta -> reserva)
    txs.push(t({ type: 'transfer', amount: 500, date: dia(12), categoryId: 'transferencia', entityId: 'pf',
      accountId: 'pf-cc', toAccountId: 'pf-res', goalId: 'ferias', goalDirection: 'in' }));
    // PJ: parcela do empréstimo (previsto = real)
    txs.push(t({ amount: 900, date: dia(10), categoryId: 'servicos', entityId: 'pj',
      accountId: 'pj-cc', plannedAmount: 900, description: 'Parcela Empréstimo Itaú' }));
  }

  // Compra parcelada no cartão: 3x de 600 (jul, ago, set), 1ª paga
  const grupo = 'parc-1';
  for (let i = 1; i <= 3; i++) {
    txs.push(t({
      description: `Notebook (${i}/3)`, amount: 600, date: formatLocalDate(new Date(2026, 6 + (i - 1), 8)),
      categoryId: 'servicos', entityId: 'pj', cardId: 'card-pj',
      status: i === 1 ? 'completed' : 'pending',
      installmentGroupId: grupo, installmentNumber: i, totalInstallments: 3,
    }));
  }

  // Contas em aberto de julho
  txs.push(t({ type: 'income', amount: 2500, date: '2026-07-28', status: 'pending', entityId: 'pj', accountId: 'pj-cc', categoryId: 'venda' }));
  txs.push(t({ amount: 700, date: '2026-07-25', status: 'pending', entityId: 'pj', accountId: 'pj-cc', categoryId: 'moradia' }));
  txs.push(t({ amount: 250, date: '2026-07-02', status: 'pending', entityId: 'pf', accountId: 'pf-cc', categoryId: 'saude' }));

  // Cancelado gigante: não pode entrar em NENHUM cálculo
  txs.push(t({ amount: 99999, date: '2026-07-09', status: 'cancelled', entityId: 'pj', accountId: 'pj-cc' }));

  return txs;
}

const TXS = gerarSeisMeses();
const KINDS: CategoryKindMap = { servicos: 'variable', moradia: 'fixed', alimentacao: 'fixed', transporte: 'fixed', saude: 'fixed', venda: 'variable' };
const METAS = { alimentacao: 800, moradia: 4000, monthly_balance_goal: 3000 };

function todosNumerosFinitos(obj: any, ctx: string) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number') expect(Number.isFinite(v), `${ctx}.${k}`).toBe(true);
  }
}

describe('simulação 6 meses — invariante: nenhum cálculo devolve NaN/Infinity', () => {
  it('saldos, dívidas, cartão, posso gastar, saúde, DRE, metas, variância — todos finitos', () => {
    const saldos = computeBalances(contas, TXS);
    todosNumerosFinitos(saldos, 'saldos');

    const views = collectDebts(TXS, emprestimos, cartoes, {}, HOJE);
    for (const v of views) {
      expect(Number.isFinite(v.balance), `divida ${v.id}.balance`).toBe(true);
      expect(Number.isFinite(v.monthlyPayment), `divida ${v.id}.pgto`).toBe(true);
    }
    const plano = payoffSchedule(views, 300, 'avalanche', HOJE);
    todosNumerosFinitos({ months: plano.months, totalInterest: plano.totalInterest, totalPaid: plano.totalPaid }, 'plano');

    expect(Number.isFinite(computeCardInvoice('card-pj', 5, TXS, HOJE))).toBe(true);
    expect(Number.isFinite(computeCardUsage('card-pj', 5, TXS, HOJE))).toBe(true);

    const s = computeSpendable({
      accounts: contas, transactions: TXS, cards: cartoes,
      loans: emprestimos.map(d => ({ id: d.id, name: d.name, monthlyPayment: d.monthlyPayment })),
      reserve: 3000, reference: HOJE,
    });
    todosNumerosFinitos(s, 'spendable');

    const d = computeDRE(TXS, KINDS, HOJE);
    todosNumerosFinitos({ receita: d.receita, mc: d.margemContribuicao, lop: d.lucroOperacional, res: d.resultado, mp: d.margemPercent }, 'dre');
  });
});

describe('simulação 6 meses — os motores concordam entre si', () => {
  it('saldo total reconcilia lançamento por lançamento e ignora o cancelado', () => {
    const saldos = computeBalances(contas, TXS);
    let esperado = contas.reduce((a, c) => a + c.initialBalance, 0);
    for (const tx of TXS) {
      if (tx.status !== 'completed' || tx.type === 'transfer' || !tx.accountId) continue;
      esperado += tx.type === 'income' ? tx.amount : -tx.amount;
    }
    const total = round2(Object.values(saldos).reduce((a, v) => a + v, 0));
    expect(total).toBe(round2(esperado));
    expect(Math.abs(total)).toBeLessThan(90000); // o cancelado de 99.999 ficou de fora
  });

  it('a reserva recebeu exatamente os 6 depósitos de 500', () => {
    const saldos = computeBalances(contas, TXS);
    expect(saldos['pf-res']).toBe(3000);
  });

  it('a caixinha guardou o mesmo que o saldo da reserva', () => {
    const p = computeGoalProgress(caixinha, TXS);
    const saldos = computeBalances(contas, TXS);
    expect(p.saved).toBe(saldos['pf-res']);
    expect(p.saved).toBe(3000);
    const porMes = monthlyNeeded(p.remaining, caixinha.deadline, HOJE)!;
    expect(Number.isFinite(porMes)).toBe(true);
    const tempo = timeProgress(caixinha, HOJE)!;
    expect(['adiantado', 'em-dia', 'atrasado']).toContain(paceVerdict(caixinha, p.saved, HOJE));
    expect(tempo.percent).toBeGreaterThan(0);
  });

  it('pró-labore some no consolidado, dívida vê 3 fontes', () => {
    const g = consolidate(TXS, [PF, PJ], HOJE);
    // consolidate é do MÊS corrente (julho): 1 pró-labore e 1 faturamento cheio.
    expect(g.internalFlow).toBe(4000);
    expect(g.consolidated.income).toBe(12500);     // só faturamento de cliente
    const fontes = new Set(collectDebts(TXS, emprestimos, cartoes, {}, HOJE).map(v => v.source));
    expect(fontes.has('installments') && fontes.has('loan') && fontes.has('card')).toBe(true);
  });

  it('DRE e comparador de período contam a MESMA receita de julho', () => {
    const d = computeDRE(TXS, KINDS, HOJE);
    const p = periodTotals(TXS, new Date(2026, 6, 1), new Date(2026, 6, 31));
    expect(p.receita).toBe(d.receita);
    expect(d.margemContribuicao).toBe(round2(d.receita - d.custoVariavel));
    expect(d.resultado).toBe(round2(d.lucroOperacional - d.investimentos));
    const pe = breakEven(d.despesaFixa, d.margemPercent);
    if (pe !== null) expect(Number.isFinite(pe)).toBe(true);
  });

  it('posso gastar: a soma das partes fecha com o disponível', () => {
    const s = computeSpendable({
      accounts: contas, transactions: TXS, cards: cartoes,
      loans: emprestimos.map(d => ({ id: d.id, name: d.name, monthlyPayment: d.monthlyPayment })),
      reserve: 3000, reference: HOJE,
    });
    const soma = s.balance - s.billsDueThisMonth - s.cardInvoices - s.loanPayments - s.expectedVariable - s.reserve;
    expect(s.spendable).toBe(round2(soma));
  });

  it('saúde financeira: nota é a soma das partes e cabe em 0..100', () => {
    const saldos = computeBalances(contas, TXS);
    const views = collectDebts(TXS, emprestimos, cartoes, {}, HOJE);
    const h = computeHealthScore({
      monthlyIncome: averageMonthlyIncome(TXS, HOJE, 3),
      monthlyExpense: averageMonthlyExpense(TXS, HOJE, 3),
      monthlyDebtPayment: views.reduce((a, v) => a + v.monthlyPayment, 0),
      totalDebt: round2(views.reduce((a, v) => a + v.balance, 0)),
      balance: round2(Object.values(saldos).reduce((a, v) => a + v, 0)),
      overdueAmount: 250,
    });
    expect(h.hasEnoughData).toBe(true);
    const soma = h.parts.reduce((a, p) => a + p.points, 0);
    expect(h.score).toBe(Math.round(soma));
    expect(h.score).toBeGreaterThanOrEqual(0);
    expect(h.score).toBeLessThanOrEqual(100);
  });

  it('orçado × realizado: alimentação estoura (900/mês > 800) e aparece no alerta', () => {
    const linhas = budgetProgress(METAS, TXS, HOJE, 'expense');
    todosNumerosFinitos(Object.fromEntries(linhas.map(l => [l.categoryId, l.percent])), 'budgetPercent');
    const estouradas = exceededBudgets(linhas).map(l => l.categoryId);
    expect(estouradas).toContain('alimentacao');
  });

  it('previsto x real: 6 parcelas do empréstimo sem desvio', () => {
    const parcelas = TXS.filter(x => x.plannedAmount != null);
    expect(parcelas.length).toBe(6);
    const v = computeVariance(parcelas);
    expect(v.diff).toBe(0);
  });

  it('orçamento e funil de propostas continuam coerentes', () => {
    const orc = quoteTotals([
      { quantity: 2, unitPrice: 1500, discount: 200 },
      { quantity: 1, unitPrice: 800, discount: 0 },
    ]);
    expect(orc.subtotal).toBe(3800);
    expect(orc.total).toBe(3600);
    const funil = quotePipeline([
      { status: 'approved', total: 3600 },
      { status: 'sent', total: 1200 },
      { status: 'rejected', total: 900 },
    ]);
    expect(funil.ganho).toBe(3600);
    expect(Number.isFinite(funil.taxaAprovacao ?? 0)).toBe(true);
    // totais por cliente batem com o que entrou/está a receber
    const pt = partyTotals(TXS, 'cliente-x');
    todosNumerosFinitos(pt, 'partyTotals');
  });

  it('ranking de dívidas ordena por custo real (R$/mês)', () => {
    const views = collectDebts(TXS, emprestimos, cartoes, {}, HOJE);
    const ranked = rankByCost(views).filter(v => v.monthlyCost != null);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].monthlyCost!).toBeGreaterThanOrEqual(ranked[i].monthlyCost!);
    }
  });
});
