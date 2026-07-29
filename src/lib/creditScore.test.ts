import { describe, it, expect } from 'vitest';
import { scoreBand, daysSinceUpdate, scoreTrend, isStale, SCORE_MAX } from './creditScore';

describe('scoreBand', () => {
  it('classifica nas faixas do Serasa', () => {
    expect(scoreBand(150).key).toBe('muito-baixo');
    expect(scoreBand(400).key).toBe('baixo');
    expect(scoreBand(650).key).toBe('bom');
    expect(scoreBand(900).key).toBe('excelente');
  });

  it('respeita as bordas exatas das faixas', () => {
    expect(scoreBand(300).key).toBe('muito-baixo');
    expect(scoreBand(301).key).toBe('baixo');
    expect(scoreBand(500).key).toBe('baixo');
    expect(scoreBand(501).key).toBe('bom');
    expect(scoreBand(700).key).toBe('bom');
    expect(scoreBand(701).key).toBe('excelente');
  });

  it('trava nos limites em vez de aceitar valor impossível', () => {
    expect(scoreBand(-50).key).toBe('muito-baixo');
    expect(scoreBand(99999).key).toBe('excelente');
  });

  it('cada faixa tem rótulo e cor', () => {
    for (const s of [100, 400, 600, 900]) {
      const b = scoreBand(s);
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('o teto do score é 1000', () => {
    expect(SCORE_MAX).toBe(1000);
  });
});

describe('daysSinceUpdate', () => {
  it('conta os dias desde a última atualização', () => {
    expect(daysSinceUpdate('2026-07-01', new Date(2026, 6, 15))).toBe(14);
  });

  it('mesmo dia é zero', () => {
    expect(daysSinceUpdate('2026-07-15', new Date(2026, 6, 15))).toBe(0);
  });

  it('data ausente ou inválida devolve null, não NaN', () => {
    expect(daysSinceUpdate(undefined, new Date(2026, 6, 15))).toBeNull();
    expect(daysSinceUpdate('data-ruim', new Date(2026, 6, 15))).toBeNull();
  });
});

describe('isStale', () => {
  it('mais de 45 dias sem atualizar já conta como desatualizado', () => {
    expect(isStale('2026-05-01', new Date(2026, 6, 15))).toBe(true);
    expect(isStale('2026-07-01', new Date(2026, 6, 15))).toBe(false);
  });

  it('sem nenhum registro é considerado desatualizado', () => {
    expect(isStale(undefined, new Date(2026, 6, 15))).toBe(true);
  });
});

describe('scoreTrend', () => {
  const hist = [
    { score: 620, date: '2026-07-01' },
    { score: 580, date: '2026-06-01' },
    { score: 600, date: '2026-05-01' },
  ];

  it('compara o mais recente com o anterior, independente da ordem da lista', () => {
    const t = scoreTrend(hist);
    expect(t.current).toBe(620);
    expect(t.previous).toBe(580);
    expect(t.delta).toBe(40);
    expect(t.direction).toBe('up');
  });

  it('reconhece queda', () => {
    const t = scoreTrend([{ score: 500, date: '2026-07-01' }, { score: 700, date: '2026-06-01' }]);
    expect(t.delta).toBe(-200);
    expect(t.direction).toBe('down');
  });

  it('um único registro não inventa tendência', () => {
    const t = scoreTrend([{ score: 700, date: '2026-07-01' }]);
    expect(t.current).toBe(700);
    expect(t.previous).toBeNull();
    expect(t.direction).toBe('flat');
  });

  it('lista vazia não quebra', () => {
    const t = scoreTrend([]);
    expect(t.current).toBeNull();
    expect(t.direction).toBe('flat');
  });
});
