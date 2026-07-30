/**
 * Simulação de 4 meses de uso real, passando por TODOS os motores.
 *
 * Teste unitário garante que cada função está certa isolada. Isto garante que
 * elas concordam entre si sobre o MESMO conjunto de dados — que é onde mora o
 * erro de integração: dois cálculos somando a mesma coisa e chegando a
 * números diferentes.
 *
 * Não toca em Firestore: gera os dados aqui, então roda em qualquer máquina.
 */
import { describe, it, expect } from 'vitest';
import { BankAccount, CreditCard, Debt, Goal, Transaction } from '../types';
import { computeBalances, computeCardInvoice, computeCardUsage, round2, formatLocalDate } from './finance';
import { collectDebts, payoffSchedule, rankByCost } from './debts';
import { computeSpendable, averageMonthlyExpense, averageMonthlyIncome, detectDuplicateLoanCommitments, loanAlreadyPaidThisMonth } from './spendable';
import { computeHealthScore } from './health';
import { consolidate } from './crossEntity';
import { computeDRE, breakEven, CategoryKindMap } from './dre';
import { computeGoalProgress, monthlyNeeded, timeProgress, paceVerdict } from './goals';
import { periodTotals, computeVariance } from './variance';

// ---------------------------------------------------------------- cenário
const PF = { id: 'pf', name: 'Lucas', type: 'PF' as const, ownerUid: 'u1' };
const PJ = { id: 'pj', name: 'Agência CIIS', type: 'PJ' as const, ownerUid: 'u1' };

/** Hoje da simulação: 15/07/2026. Meses cheios: abril, maio, junho. */
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
  deadline: '2026-12-31', entityId: 'pf', createdAt: '2026-04-01',
};

let seq = 0;
const t = (over: Partial<Transaction>): Transaction => ({
  id: `t${++seq}`, description: 'lanç', amount: 0, type: 'expense', date: '2026-07-10',
  categoryId: 'outros', status: 'completed', entityId: 'pj', ...over,
});

/** Constrói abril→julho de uso: faturamento, custos, pró-labore, cartão, caixinha. */
function gerarQuatroMeses(): Transaction[] {
  const txs: Transaction[] = [];
  const meses = [3, 4, 5, 6]; // abril, maio, junho, julho

  for (const m of meses) {
    const dia = (d: number) => formatLocalDate(new Date(2026, m, d));

    // PJ: faturamento de dois clientes
    txs.push(t({ type: 'income', amount: 9000, date: dia(5), categoryId: 'venda', entityId: 'pj', accountId: 'pj-cc' }));
    txs.push(t({ type: 'income', amount: 3500, date: dia(20), categoryId: 'venda', entityId: 'pj', accountId: 'pj-cc' }));

    // PJ: custo variável (terceiros) e despesa fixa (escritório, software)
    txs.push(t({ amount: 2200, date: dia(8), categoryId: 'servicos', entityId: 'pj', accountId: 'pj-cc' }));
    txs.push(t({ amount: 1800, date: dia(6), categoryId: 'moradia', entityId: 'pj', accountId: 'pj-cc' }));
    txs.push(t({ amount: 320, date: dia(7), categoryId: 'servicos', entityId: 'pj', cardId: 'card-pj' }));

    // Pró-labore: sai da PJ, entra na PF — duas pontas vinculadas
    const grupo = `pro-${m}`;
    txs.push(t({ amount: 4000, date: dia(10), categoryId: 'transferencia', entityId: 'pj',
      accountId: 'pj-cc', crossEntityGroupId: grupo, crossEntityKind: 'prolabore', counterpartEntityId: 'pf' }));
    txs.push(t({ type: 'income', amount: 4000, date: dia(10), categoryId: 'transferencia', entityId: 'pf',
      accountId: 'pf-cc', crossEntityGroupId: grupo, crossEntityKind: 'prolabore', counterpartEntityId: 'pj' }));

    // PF: vida
    txs.push(t({ amount: 1500, date: dia(11), categoryId: 'moradia', entityId: 'pf', accountId: 'pf-cc' }));
    txs.push(t({ amount: 900, date: dia(15), categoryId: 'alimentacao', entityId: 'pf', accountId: 'pf-cc' }));
    txs.push(t({ amount: 400, date: dia(18), categoryId: 'transporte', entityId: 'pf', accountId: 'pf-cc' }));

    // PF: depósito na caixinha (transferência conta -> reserva)
    txs.push(t({ type: 'transfer', amount: 500, date: dia(12), categoryId: 'transferencia', entityId: 'pf',
      accountId: 'pf-cc', toAccountId: 'pf-res', goalId: 'ferias', goalDirection: 'in' }));

    // PJ: parcela do empréstimo, prevista 900 e paga 900
    txs.push(t({ amount: 900, date: dia(10), categoryId: 'servicos', entityId: 'pj',
      accountId: 'pj-cc', plannedAmount: 900, description: 'Parcela Empréstimo Itaú' }));
  }

  // Compra parcelada no cartão em julho: 3x de 600, primeira paga
  const grupo = 'parc-1';
  for (let i = 1; i <= 3; i++) {
    txs.push(t({
      description: `Notebook (${i}/3)`, amount: 600, date: formatLocalDate(new Date(2026, 6 + (i - 1), 8)),
      categoryId: 'servicos', entityId: 'pj', cardId: 'card-pj',
      status: i === 1 ? 'completed' : 'pending',
      installmentGroupId: grupo, installmentNumber: i, totalInstallments: 3,
    }));
  }

  // Contas em aberto de julho: uma a receber e uma a pagar, mais uma vencida
  txs.push(t({ type: 'income', amount: 2500, date: '2026-07-28', status: 'pending', entityId: 'pj', accountId: 'pj-cc', categoryId: 'venda' }));
  txs.push(t({ amount: 700, date: '2026-07-25', status: 'pending', entityId: 'pj', accountId: 'pj-cc', categoryId: 'moradia' }));
  txs.push(t({ amount: 250, date: '2026-07-02', status: 'pending', entityId: 'pf', accountId: 'pf-cc', categoryId: 'saude' }));

  // Cancelado: não pode aparecer em NENHUM cálculo
  txs.push(t({ amount: 99999, date: '2026-07-09', status: 'cancelled', entityId: 'pj', accountId: 'pj-cc' }));

  return txs;
}

const TXS = gerarQuatroMeses();
const KINDS: CategoryKindMap = { servicos: 'variable', moradia: 'fixed', alimentacao: 'fixed', transporte: 'fixed', saude: 'fixed' };

// ---------------------------------------------------------------- os testes
describe('simulação de 4 meses — saldos', () => {
  const saldos = computeBalances(contas, TXS);

  it('nenhum saldo virou NaN nem Infinity', () => {
    for (const [id, v] of Object.entries(saldos)) {
      expect(Number.isFinite(v), `conta ${id}`).toBe(true);
    }
  });

  it('a reserva recebeu exatamente os 4 depósitos da caixinha', () => {
    expect(saldos['pf-res']).toBe(2000);
  });

  it('saldo bate com a conta feita à mão, lançamento por lançamento', () => {
    let esperado = 0;
    for (const c of contas) esperado += c.initialBalance;
    for (const tx of TXS) {
      if (tx.status !== 'completed') continue;
      if (tx.type === 'transfer') continue;  // move entre contas, não muda o total
      if (!tx.accountId) continue;           // cartão não mexe em conta
      esperado += tx.type === 'income' ? tx.amount : -tx.amount;
    }
    const total = round2(Object.values(saldos).reduce((a, v) => a + v, 0));
    expect(total).toBe(round2(esperado));
  });

  it('o cancelado de R$ 99.999 não entrou em lugar nenhum', () => {
    const total = Object.values(saldos).reduce((a, v) => a + v, 0);
    expect(Math.abs(total)).toBeLessThan(90000);
  });
});

describe('simulação de 4 meses — dívidas', () => {
  const views = collectDebts(TXS, emprestimos, cartoes, {}, HOJE);

  it('enxerga as três fontes: parcelamento, empréstimo e fatura', () => {
    const fontes = new Set(views.map(v => v.source));
    expect(fontes.has('installments')).toBe(true);
    expect(fontes.has('loan')).toBe(true);
    expect(fontes.has('card')).toBe(true);
  });

  it('parcelamento conta só as 2 parcelas em aberto, não as 3', () => {
    const p = views.find(v => v.source === 'installments');
    expect(p?.balance).toBe(1200);
    expect(p?.installmentsLeft).toBe(2);
  });

  it('o plano de quitação termina e não devolve número quebrado', () => {
    const r = payoffSchedule(views, 0, 'avalanche', HOJE);
    expect(Number.isFinite(r.totalInterest)).toBe(true);
    expect(Number.isFinite(r.totalPaid)).toBe(true);
    expect(r.months).toBeGreaterThan(0);
    expect(r.months).toBeLessThan(600);
  });

  it('pagar mais por mês nunca piora o prazo', () => {
    const sem = payoffSchedule(views, 0, 'avalanche', HOJE);
    const com = payoffSchedule(views, 500, 'avalanche', HOJE);
    expect(com.months).toBeLessThanOrEqual(sem.months);
    expect(com.totalInterest).toBeLessThanOrEqual(sem.totalInterest);
  });

  it('o ranking põe a dívida de maior custo em reais na frente', () => {
    const r = rankByCost(views);
    const comTaxa = r.filter(x => !x.unknownRate);
    for (let i = 1; i < comTaxa.length; i++) {
      expect(comTaxa[i - 1].monthlyCost!).toBeGreaterThanOrEqual(comTaxa[i].monthlyCost!);
    }
  });

  it('parcela já PAGA não é acusada de duplicidade — não há dupla contagem', () => {
    // A simulação lança "Parcela Empréstimo Itaú" como paga. Como o aviso só
    // existe para pendências (que é onde a soma dobraria), aqui não acusa.
    const dup = detectDuplicateLoanCommitments(
      emprestimos.map(d => ({ id: d.id, name: d.name, monthlyPayment: d.monthlyPayment })),
      TXS, HOJE
    );
    expect(dup).toHaveLength(0);
  });

  it('e a parcela paga também NÃO é reservada de novo no posso gastar', () => {
    // Era o bug que esta simulação encontrou: o dinheiro já saiu do saldo, e o
    // sistema reservava os mesmos R$ 900 outra vez.
    expect(loanAlreadyPaidThisMonth(
      { id: 'emp', name: 'Empréstimo Itaú', monthlyPayment: 900 }, TXS, HOJE
    )).toBe(true);
  });
});

describe('simulação de 4 meses — cartão', () => {
  it('a fatura aberta não inclui compra de ciclo encerrado', () => {
    const fatura = computeCardInvoice('card-pj', 5, TXS, HOJE);
    // Ciclo aberto em 15/07 = 05/07 a 05/08: só o software (320) e a 1ª parcela (600)
    expect(fatura).toBe(920);
  });

  it('o limite utilizado inclui parcela futura, mas não o passado pago', () => {
    const uso = computeCardUsage('card-pj', 5, TXS, HOJE);
    expect(uso).toBe(920 + 1200);  // fatura aberta + 2 parcelas futuras
    expect(uso).toBeLessThan(cartoes[0].limit);
  });
});

describe('simulação de 4 meses — posso gastar', () => {
  const s = computeSpendable({
    accounts: contas, transactions: TXS, cards: cartoes,
    loans: emprestimos.map(d => ({ id: d.id, name: d.name, monthlyPayment: d.monthlyPayment })),
    reserve: 3000, reference: HOJE,
  });

  it('a soma das partes fecha com o disponível', () => {
    const soma = s.balance - s.billsDueThisMonth - s.cardInvoices - s.loanPayments - s.expectedVariable - s.reserve;
    expect(s.spendable).toBe(round2(soma));
  });

  it('nenhuma parte virou NaN', () => {
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === 'number') expect(Number.isFinite(v), k).toBe(true);
    }
  });

  it('despesa no cartão não é cobrada duas vezes', () => {
    // O software e a parcela do cartão estão na fatura; não podem estar
    // também em contas a pagar.
    expect(s.cardInvoices).toBeGreaterThan(0);
    const pendentesDeCartao = TXS.filter(x => x.cardId && x.status === 'pending');
    expect(pendentesDeCartao.length).toBeGreaterThan(0);  // existem
    // e ainda assim não inflaram as contas a pagar de julho
    expect(s.billsDueThisMonth).toBe(950);  // 700 (PJ) + 250 (PF vencida)
  });
});

describe('simulação de 4 meses — PF x PJ', () => {
  const g = consolidate(TXS, [PF, PJ], HOJE);

  it('pró-labore aparece em cada entidade mas se anula no grupo', () => {
    expect(g.byEntity.pj.expense).toBeGreaterThan(0);
    expect(g.byEntity.pf.income).toBe(4000);       // a pessoa recebeu
    expect(g.internalFlow).toBe(4000);             // circulou entre elas
    // no consolidado, a receita do grupo é só o que veio de cliente
    expect(g.consolidated.income).toBe(12500);
  });

  it('o resultado do grupo é receita menos despesa, sem o interno', () => {
    expect(g.consolidated.net).toBe(round2(g.consolidated.income - g.consolidated.expense));
  });
});

describe('simulação de 4 meses — DRE e ponto de equilíbrio', () => {
  const d = computeDRE(TXS, KINDS, HOJE);

  it('a cascata fecha: cada linha deriva da anterior', () => {
    expect(d.margemContribuicao).toBe(round2(d.receita - d.custoVariavel));
    expect(d.lucroOperacional).toBe(round2(d.margemContribuicao - d.despesaFixa));
    expect(d.resultado).toBe(round2(d.lucroOperacional - d.investimentos));
  });

  it('toda categoria da simulação está classificada', () => {
    expect(d.semClassificacao).toEqual([]);
  });

  it('o ponto de equilíbrio é coerente com a margem', () => {
    const pe = breakEven(d.despesaFixa, d.margemPercent);
    expect(pe).not.toBeNull();
    // faturar o ponto de equilíbrio zera o lucro operacional
    expect(round2(pe! * (d.margemPercent / 100))).toBeCloseTo(d.despesaFixa, 0);
  });

  it('o DRE e o comparador de períodos contam a MESMA receita', () => {
    const p = periodTotals(TXS, new Date(2026, 6, 1), new Date(2026, 6, 31));
    expect(p.receita).toBe(d.receita);
  });
});

describe('simulação de 4 meses — caixinha', () => {
  const p = computeGoalProgress(caixinha, TXS);

  it('guardou os 4 depósitos de 500', () => {
    expect(p.saved).toBe(2000);
    expect(p.remaining).toBe(4000);
  });

  it('o guardado bate com o saldo da conta reserva', () => {
    const saldos = computeBalances(contas, TXS);
    expect(p.saved).toBe(saldos['pf-res']);
  });

  it('exige um ritmo mensal coerente com o que falta', () => {
    const porMes = monthlyNeeded(p.remaining, caixinha.deadline, HOJE)!;
    // jul..dez = 6 meses => 4000/6
    expect(porMes).toBe(round2(4000 / 6));
  });

  it('compara dinheiro com tempo e dá um veredito', () => {
    const tempo = timeProgress(caixinha, HOJE)!;
    expect(tempo.percent).toBeGreaterThan(0);
    expect(tempo.percent).toBeLessThan(100);
    expect(['adiantado', 'em-dia', 'atrasado']).toContain(paceVerdict(caixinha, p.saved, HOJE));
  });
});

describe('simulação de 4 meses — saúde financeira', () => {
  const saldos = computeBalances(contas, TXS);
  const saldo = round2(Object.values(saldos).reduce((a, v) => a + v, 0));
  const views = collectDebts(TXS, emprestimos, cartoes, {}, HOJE);

  const h = computeHealthScore({
    monthlyIncome: averageMonthlyIncome(TXS, HOJE, 3),
    monthlyExpense: averageMonthlyExpense(TXS, HOJE, 3),
    monthlyDebtPayment: views.reduce((a, v) => a + v.monthlyPayment, 0),
    totalDebt: round2(views.reduce((a, v) => a + v.balance, 0)),
    balance: saldo,
    overdueAmount: 250,
  });

  it('com 3 meses de histórico, tem dados para pontuar', () => {
    expect(h.hasEnoughData).toBe(true);
  });

  it('a nota é a soma das partes e cabe em 0..100', () => {
    const soma = h.parts.reduce((a, p) => a + p.points, 0);
    expect(h.score).toBe(Math.round(soma));
    expect(h.score).toBeGreaterThanOrEqual(0);
    expect(h.score).toBeLessThanOrEqual(100);
  });

  it('toda parte tem explicação, para a nota ser acionável', () => {
    for (const p of h.parts) expect(p.detail.length).toBeGreaterThan(5);
  });
});

describe('simulação de 4 meses — previsto x real', () => {
  it('parcela lançada com previsto igual ao real não gera desvio', () => {
    const parcelas = TXS.filter(x => x.plannedAmount != null);
    expect(parcelas.length).toBe(4);
    const v = computeVariance(parcelas);
    expect(v.diff).toBe(0);
    expect(v.percent).toBe(0);
  });
});
