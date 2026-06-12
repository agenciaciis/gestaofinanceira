import { describe, it, expect } from 'vitest';
import { parseAmountBR, parseFlexibleDate, parseOFX } from './statementParsers';

describe('parseAmountBR', () => {
  it('formato US com ponto decimal NÃO vira x100', () => {
    expect(parseAmountBR('1234.56')).toBe(1234.56);
    expect(parseAmountBR('12.50')).toBe(12.5);
  });
  it('formato BR com vírgula decimal', () => {
    expect(parseAmountBR('1.234,56')).toBe(1234.56);
    expect(parseAmountBR('1234,56')).toBe(1234.56);
    expect(parseAmountBR('1.234.567,89')).toBe(1234567.89);
  });
  it('negativos e símbolos', () => {
    expect(parseAmountBR('-50,00')).toBe(-50);
    expect(parseAmountBR('(50,00)')).toBe(-50);
    expect(parseAmountBR('R$ 1.000,00')).toBe(1000);
    expect(parseAmountBR('-99.90')).toBe(-99.9);
  });
  it('milhar com ponto sem decimal', () => {
    expect(parseAmountBR('1.234')).toBe(1234);
  });
  it('inválido vira NaN', () => {
    expect(Number.isNaN(parseAmountBR(''))).toBe(true);
    expect(Number.isNaN(parseAmountBR('abc'))).toBe(true);
  });
});

describe('parseFlexibleDate', () => {
  it('DD/MM/AAAA brasileiro', () => {
    expect(parseFlexibleDate('03/04/2025')).toBe('2025-04-03');
    expect(parseFlexibleDate('3/4/25')).toBe('2025-04-03');
    expect(parseFlexibleDate('15-12-2026')).toBe('2026-12-15');
  });
  it('ISO e OFX compacto', () => {
    expect(parseFlexibleDate('2026-06-11')).toBe('2026-06-11');
    expect(parseFlexibleDate('20260611')).toBe('2026-06-11');
    expect(parseFlexibleDate('20260611120000')).toBe('2026-06-11');
  });
  it('dia/mês inválido => vazio', () => {
    expect(parseFlexibleDate('45/13/2025')).toBe('');
    expect(parseFlexibleDate('')).toBe('');
  });
});

describe('parseOFX', () => {
  it('extrai transações de blocos STMTTRN', () => {
    const ofx = `
      <OFX><BANKMSGSRSV1><STMTTRNRS><BANKTRANLIST>
      <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260610120000<TRNAMT>-150.00<MEMO>Mercado</STMTTRN>
      <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260612<TRNAMT>2000.00<NAME>Salario</STMTTRN>
      </BANKTRANLIST></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const rows = parseOFX(ofx);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ date: '2026-06-10', description: 'Mercado', amount: -150 });
    expect(rows[1]).toEqual({ date: '2026-06-12', description: 'Salario', amount: 2000 });
  });
  it('texto vazio => sem linhas', () => {
    expect(parseOFX('')).toHaveLength(0);
  });
});
