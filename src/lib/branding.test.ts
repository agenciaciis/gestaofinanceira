import { describe, it, expect } from 'vitest';
import { dataUrlBytes, validateLetterhead, fitDimensions, MAX_LETTERHEAD_BYTES, MAX_LETTERHEAD_WIDTH } from './branding';

const dataUrl = (bytes: number, mime = 'image/jpeg') => {
  const base64Len = Math.ceil(bytes / 3) * 4;
  return `data:${mime};base64,${'A'.repeat(base64Len)}`;
};

describe('dataUrlBytes', () => {
  it('estima o tamanho do conteúdo base64', () => {
    expect(dataUrlBytes('data:image/png;base64,AAAA')).toBe(3);
  });

  it('desconta o padding', () => {
    expect(dataUrlBytes('data:image/png;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('data:image/png;base64,AA==')).toBe(1);
  });

  it('string sem vírgula não quebra', () => {
    expect(dataUrlBytes('lixo')).toBe(0);
  });
});

describe('validateLetterhead', () => {
  it('aceita PNG, JPG e WEBP dentro do limite', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']) {
      expect(validateLetterhead(dataUrl(1000, mime)).ok).toBe(true);
    }
  });

  it('recusa PDF e outros tipos', () => {
    expect(validateLetterhead('data:application/pdf;base64,AAAA').ok).toBe(false);
  });

  it('recusa imagem acima do teto do Firestore, dizendo o tamanho', () => {
    const r = validateLetterhead(dataUrl(MAX_LETTERHEAD_BYTES + 50_000));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/KB/);
  });

  it('aceita exatamente no limite', () => {
    expect(validateLetterhead(dataUrl(MAX_LETTERHEAD_BYTES - 10)).ok).toBe(true);
  });

  it('vazio ou nulo é recusado com motivo', () => {
    expect(validateLetterhead(null).ok).toBe(false);
    expect(validateLetterhead('').reason).toBeTruthy();
  });
});

describe('fitDimensions', () => {
  it('não amplia imagem menor que o limite', () => {
    expect(fitDimensions(800, 1130)).toEqual({ width: 800, height: 1130 });
  });

  it('reduz mantendo a proporção do A4', () => {
    const r = fitDimensions(2480, 3508); // A4 a 300dpi
    expect(r.width).toBe(MAX_LETTERHEAD_WIDTH);
    expect(r.height).toBe(1754); // metade, proporção preservada
  });

  it('nunca devolve dimensão zero ou negativa', () => {
    const r = fitDimensions(0, 0);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});
