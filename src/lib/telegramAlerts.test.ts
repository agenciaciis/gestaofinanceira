import { describe, it, expect } from 'vitest';
import { BankAccount, Transaction } from '../types';
import { selectEntityAlerts, buildWeeklySummary, filterUnsent, AlertContext } from './telegramAlerts';

const HOJE = new Date(2026, 6, 15); // 15/07/2026

const contas: BankAccount[] = [
  { id: 'cc', bankName: 'Nubank', type: 'corrente', initialBalance: 1000, currentBalance: 0, entityId: 'pf' },
];

let seq = 0;
const t = (over: Partial<Transaction>): Transaction => ({
  id: `t${++seq}`, description: 'x', amount: 0, type: 'expense', date: '2026-07-15',
  categoryId: 'outros', status: 'pending', entityId: 'pf', ...over,
});

const ctx = (over: Partial<AlertContext>): AlertContext => ({
  entityName: 'Lucas', entityType: 'PF', accounts: contas, transactions: [],
  budgets: {}, today: HOJE, ...over,
});

describe('telegramAlerts — conta a vencer', () => {
  it('avisa despesa pendente vencendo em até 2 dias', () => {
    const txs = [t({ description: 'Luz', amount: 200, date: '2026-07-17' })]; // +2 dias
    const a = selectEntityAlerts(ctx({ transactions: txs }));
    const due = a.filter(x => x.kind === 'due');
    expect(due).toHaveLength(1);
    expect(due[0].text).toContain('Luz');
    expect(due[0].text).toContain('vence em 2 dias');
    expect(due[0].key).toBe('due:t1');
  });

  it('NÃO avisa o que vence longe (5 dias)', () => {
    const txs = [t({ date: '2026-07-20' })];
    expect(selectEntityAlerts(ctx({ transactions: txs })).filter(x => x.kind === 'due')).toHaveLength(0);
  });

  it('avisa vencida com "venceu há X dias"', () => {
    const txs = [t({ description: 'Boleto', amount: 90, date: '2026-07-13' })]; // -2 dias
    const due = selectEntityAlerts(ctx({ transactions: txs })).filter(x => x.kind === 'due');
    expect(due[0].text).toContain('venceu há 2 dias');
  });

  it('"vence hoje" e "vence amanhã" saem certos', () => {
    const hoje = selectEntityAlerts(ctx({ transactions: [t({ date: '2026-07-15' })] }));
    expect(hoje[0].text).toContain('vence hoje');
    const amanha = selectEntityAlerts(ctx({ transactions: [t({ date: '2026-07-16' })] }));
    expect(amanha[0].text).toContain('vence amanhã');
  });

  it('ignora despesa concluída e receita', () => {
    const txs = [
      t({ date: '2026-07-15', status: 'completed' }),
      t({ date: '2026-07-15', type: 'income' }),
    ];
    expect(selectEntityAlerts(ctx({ transactions: txs })).filter(x => x.kind === 'due')).toHaveLength(0);
  });
});

describe('telegramAlerts — saldo no vermelho', () => {
  it('dispara quando o saldo fica negativo', () => {
    // saldo inicial 1000 - despesa concluída 1500 = -500
    const txs = [t({ amount: 1500, status: 'completed', accountId: 'cc', date: '2026-07-10' })];
    const red = selectEntityAlerts(ctx({ transactions: txs })).filter(x => x.kind === 'red');
    expect(red).toHaveLength(1);
    expect(red[0].text).toContain('vermelho');
    expect(red[0].key).toBe('red:cc:2026-07-15'); // chave por dia (1x/dia)
  });

  it('não dispara com saldo positivo', () => {
    expect(selectEntityAlerts(ctx({})).filter(x => x.kind === 'red')).toHaveLength(0);
  });

  it('respeita o piso configurado (alerta abaixo de 500)', () => {
    const txs = [t({ amount: 700, status: 'completed', accountId: 'cc', date: '2026-07-10' })]; // saldo 300
    const red = selectEntityAlerts(ctx({ transactions: txs, balanceFloor: 500 })).filter(x => x.kind === 'red');
    expect(red).toHaveLength(1);
  });
});

describe('telegramAlerts — orçamento estourado', () => {
  const gastoAlimentacao = (valor: number) =>
    [t({ amount: valor, type: 'expense', status: 'completed', categoryId: 'alimentacao', date: '2026-07-05', accountId: 'cc' })];

  it('faixa 80% dispara entre 80 e 100', () => {
    const a = selectEntityAlerts(ctx({ transactions: gastoAlimentacao(850), budgets: { alimentacao: 1000 } }));
    const b = a.filter(x => x.kind === 'budget');
    expect(b).toHaveLength(1);
    expect(b[0].key).toBe('budget:alimentacao:202607:80');
    expect(b[0].text).toContain('85%');
  });

  it('faixa 100% dispara quando estoura', () => {
    const a = selectEntityAlerts(ctx({ transactions: gastoAlimentacao(1200), budgets: { alimentacao: 1000 } }));
    const b = a.filter(x => x.kind === 'budget');
    expect(b[0].key).toBe('budget:alimentacao:202607:100');
    expect(b[0].text).toContain('ESTOUROU');
  });

  it('abaixo de 80% não dispara', () => {
    const a = selectEntityAlerts(ctx({ transactions: gastoAlimentacao(500), budgets: { alimentacao: 1000 } }));
    expect(a.filter(x => x.kind === 'budget')).toHaveLength(0);
  });
});

describe('telegramAlerts — resumo semanal', () => {
  it('soma entrou/saiu da semana e o que vence à frente', () => {
    const txs = [
      t({ amount: 3000, type: 'income', status: 'completed', accountId: 'cc', date: '2026-07-12' }),
      t({ amount: 500, type: 'expense', status: 'completed', accountId: 'cc', date: '2026-07-13' }),
      t({ amount: 200, type: 'expense', status: 'pending', date: '2026-07-18' }), // vence em 3 dias
      t({ amount: 999, type: 'expense', status: 'completed', accountId: 'cc', date: '2026-06-01' }), // fora da semana
    ];
    const s = buildWeeklySummary(ctx({ transactions: txs }));
    expect(s.kind).toBe('summary');
    expect(s.text).toContain('Entrou:');
    expect(s.text).toContain('3.000');
    expect(s.text).toContain('Vence nos próximos 7 dias');
    expect(s.text).toContain('200');
  });
});

describe('telegramAlerts — anti-spam', () => {
  it('filterUnsent remove o que já foi enviado', () => {
    const txs = [t({ description: 'Luz', amount: 200, date: '2026-07-16' })];
    const alertas = selectEntityAlerts(ctx({ transactions: txs }));
    expect(alertas.length).toBeGreaterThan(0);
    const filtrado = filterUnsent(alertas, ['due:t' + seq]);
    expect(filtrado.some(a => a.key === 'due:t' + seq)).toBe(false);
  });

  it('tags [PF]/[PJ] aparecem no texto', () => {
    const pj = selectEntityAlerts(ctx({ entityType: 'PJ', transactions: [t({ date: '2026-07-15' })] }));
    expect(pj[0].text.startsWith('[PJ]')).toBe(true);
  });
});
