import { describe, it, expect } from 'vitest';
import { parseFinanceMessage, extractAmount } from './whatsappParse';

describe('extractAmount', () => {
  it('pega valores em vários formatos', () => {
    expect(extractAmount('gastei 50 no posto')).toBe(50);
    expect(extractAmount('paguei R$ 99,90 na farmácia')).toBe(99.9);
    expect(extractAmount('recebi 1.234,56 do cliente')).toBe(1234.56);
    expect(extractAmount('comprei algo por 12.50')).toBe(12.5);
  });
  it('sem número => NaN', () => {
    expect(Number.isNaN(extractAmount('oi tudo bem'))).toBe(true);
  });
});

describe('parseFinanceMessage - despesas', () => {
  it('gastei X no posto => expense transporte', () => {
    const r = parseFinanceMessage('gastei 50 no posto de gasolina');
    expect(r).toMatchObject({ kind: 'transaction', type: 'expense', amount: 50, categoryId: 'transporte' });
  });
  it('paguei X na farmácia => saude', () => {
    const r = parseFinanceMessage('paguei 99,90 na farmácia');
    expect(r).toMatchObject({ kind: 'transaction', type: 'expense', amount: 99.9, categoryId: 'saude' });
  });
  it('comprei no mercado => alimentacao', () => {
    const r = parseFinanceMessage('comprei 230 no mercado');
    expect(r).toMatchObject({ type: 'expense', amount: 230, categoryId: 'alimentacao' });
  });
});

describe('parseFinanceMessage - receitas', () => {
  it('recebi X do cliente => income', () => {
    const r = parseFinanceMessage('recebi 2000 do cliente joão');
    expect(r).toMatchObject({ kind: 'transaction', type: 'income', amount: 2000 });
  });
  it('vendi => income venda', () => {
    const r = parseFinanceMessage('vendi um serviço por 500');
    expect(r).toMatchObject({ type: 'income', amount: 500, categoryId: 'venda' });
  });
});

describe('parseFinanceMessage - comando antigo lançar', () => {
  it('lançar 30 uber', () => {
    const r = parseFinanceMessage('lançar 30 uber');
    expect(r).toMatchObject({ kind: 'transaction', amount: 30 });
  });
});

describe('parseFinanceMessage - comandos e correções', () => {
  it('saldo / extrato / ajuda / dívidas', () => {
    expect(parseFinanceMessage('saldo')).toEqual({ kind: 'command', command: 'saldo' });
    expect(parseFinanceMessage('extrato')).toEqual({ kind: 'command', command: 'extrato' });
    expect(parseFinanceMessage('ajuda')).toEqual({ kind: 'command', command: 'ajuda' });
    expect(parseFinanceMessage('dívidas')).toEqual({ kind: 'command', command: 'dividas' });
  });
  it('apagar último', () => {
    expect(parseFinanceMessage('apagar o último lançamento')).toEqual({ kind: 'delete_last' });
    expect(parseFinanceMessage('cancelar')).toEqual({ kind: 'delete_last' });
  });
  it('corrigir último para X', () => {
    expect(parseFinanceMessage('corrigir último para 80')).toMatchObject({ kind: 'edit_last', amount: 80 });
  });
  it('mensagem sem intenção financeira => null', () => {
    expect(parseFinanceMessage('bom dia, tudo certo?')).toBeNull();
  });
});
