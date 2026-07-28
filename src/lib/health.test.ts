import { describe, it, expect } from 'vitest';
import { computeHealthScore, HealthInput } from './health';

const base: HealthInput = {
  monthlyIncome: 10000,
  monthlyExpense: 6000,
  monthlyDebtPayment: 0,
  totalDebt: 0,
  balance: 36000,
  overdueAmount: 0,
};

describe('computeHealthScore', () => {
  it('situação ideal chega perto de 100', () => {
    const r = computeHealthScore(base);
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.hasEnoughData).toBe(true);
  });

  it('sem renda registrada, não inventa nota', () => {
    const r = computeHealthScore({ ...base, monthlyIncome: 0 });
    expect(r.hasEnoughData).toBe(false);
  });

  it('comprometimento alto da renda derruba a nota', () => {
    const leve = computeHealthScore({ ...base, monthlyDebtPayment: 500, totalDebt: 5000 });
    const pesado = computeHealthScore({ ...base, monthlyDebtPayment: 5000, totalDebt: 5000 });
    expect(pesado.score).toBeLessThan(leve.score);
    const parte = pesado.parts.find(p => p.key === 'comprometimento')!;
    expect(parte.points).toBe(0); // 50% da renda = pior faixa
  });

  it('reserva conta meses de despesa cobertos pelo saldo', () => {
    const seisMeses = computeHealthScore({ ...base, balance: 36000 }); // 6 x 6000
    const zerado = computeHealthScore({ ...base, balance: 0 });
    const pReserva = seisMeses.parts.find(p => p.key === 'reserva')!;
    expect(pReserva.points).toBe(pReserva.max);
    expect(zerado.parts.find(p => p.key === 'reserva')!.points).toBe(0);
  });

  it('dívida acima de uma renda anual zera essa parte', () => {
    const r = computeHealthScore({ ...base, totalDebt: 120000, monthlyDebtPayment: 1000 });
    expect(r.parts.find(p => p.key === 'endividamento')!.points).toBe(0);
  });

  it('conta vencida derruba a pontualidade', () => {
    const emDia = computeHealthScore(base);
    const atrasado = computeHealthScore({ ...base, overdueAmount: 5000 });
    expect(atrasado.parts.find(p => p.key === 'pontualidade')!.points).toBe(0);
    expect(atrasado.score).toBeLessThan(emDia.score);
  });

  it('a nota é sempre a soma das partes e fica entre 0 e 100', () => {
    const casos: HealthInput[] = [
      base,
      { ...base, monthlyDebtPayment: 9000, totalDebt: 500000, balance: -5000, overdueAmount: 20000 },
      { ...base, balance: 999999, totalDebt: 0 },
    ];
    for (const c of casos) {
      const r = computeHealthScore(c);
      const soma = r.parts.reduce((a, p) => a + p.points, 0);
      expect(r.score).toBe(Math.round(soma));
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it('saldo negativo não vira reserva positiva', () => {
    const r = computeHealthScore({ ...base, balance: -10000 });
    expect(r.parts.find(p => p.key === 'reserva')!.points).toBe(0);
  });

  it('classifica em faixas legíveis', () => {
    expect(computeHealthScore(base).label).toBe('Excelente');
    expect(
      computeHealthScore({ ...base, monthlyDebtPayment: 9000, totalDebt: 500000, balance: 0, overdueAmount: 9000 }).label
    ).toBe('Crítico');
  });
});
