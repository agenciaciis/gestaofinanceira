import { describe, it, expect } from 'vitest';
import {
  BANK_PRESETS, normalizeHex, relativeLuminance, readableForeground,
  cardGradient, contrastRatio, mutedForeground,
} from './brandColors';

describe('normalizeHex', () => {
  it('aceita com e sem cerquilha', () => {
    expect(normalizeHex('#820AD1')).toBe('#820ad1');
    expect(normalizeHex('820AD1')).toBe('#820ad1');
  });

  it('expande a forma curta de 3 dígitos', () => {
    expect(normalizeHex('#f80')).toBe('#ff8800');
  });

  it('ignora espaços em volta', () => {
    expect(normalizeHex('  #FF7A00  ')).toBe('#ff7a00');
  });

  it('devolve null para lixo, em vez de uma cor errada', () => {
    expect(normalizeHex('roxo')).toBeNull();
    expect(normalizeHex('#12')).toBeNull();
    expect(normalizeHex('#GGGGGG')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });
});

describe('relativeLuminance', () => {
  it('preto é 0 e branco é 1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('amarelo é muito mais claro que roxo', () => {
    expect(relativeLuminance('#ffef38')).toBeGreaterThan(relativeLuminance('#820ad1'));
  });
});

describe('readableForeground', () => {
  it('texto claro sobre o roxo do Nubank', () => {
    expect(readableForeground('#820ad1')).toBe('#ffffff');
  });

  it('texto ESCURO sobre o amarelo do Banco do Brasil — o caso que quebra tudo', () => {
    expect(readableForeground('#ffef38')).toBe('#0f172a');
  });

  it('texto ESCURO sobre o laranja do Inter — branco ali dá só 2,6:1', () => {
    // A marca costuma usar branco sobre laranja, mas isso reprova em contraste.
    // Num app cheio de número, legibilidade ganha do hábito visual.
    expect(contrastRatio('#ffffff', '#ff7a00')).toBeLessThan(3);
    expect(readableForeground('#ff7a00')).toBe('#0f172a');
  });

  it('sempre entrega contraste aceitável (>= 4.5:1) nas cores da paleta', () => {
    for (const preset of BANK_PRESETS) {
      const fg = readableForeground(preset.color);
      expect(contrastRatio(fg, preset.color)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('cor inválida cai no texto claro, sem lançar', () => {
    expect(readableForeground('nao-e-cor')).toBe('#ffffff');
  });
});

describe('mutedForeground', () => {
  it('é a mesma família do texto principal, só mais discreto', () => {
    expect(mutedForeground('#820ad1')).toContain('255');  // branco translúcido
    expect(mutedForeground('#ffef38')).toContain('15');   // escuro translúcido
  });
});

describe('cardGradient', () => {
  it('vai da cor escolhida para um tom mais escuro dela', () => {
    const g = cardGradient('#820ad1');
    expect(g.from).toBe('#820ad1');
    expect(relativeLuminance(g.to)).toBeLessThan(relativeLuminance(g.from));
  });

  it('funciona até no preto, sem estourar para valor negativo', () => {
    const g = cardGradient('#000000');
    expect(normalizeHex(g.to)).toBe('#000000');
  });

  it('sem cor definida devolve o visual escuro padrão', () => {
    const g = cardGradient(null);
    expect(g.from).toBe(g.from.toLowerCase());
    expect(relativeLuminance(g.from)).toBeLessThan(0.1);
  });
});

describe('BANK_PRESETS', () => {
  it('tem os bancos que o usuário citou', () => {
    const nomes = BANK_PRESETS.map(p => p.name.toLowerCase());
    expect(nomes.some(n => n.includes('nubank'))).toBe(true);
    expect(nomes.some(n => n.includes('inter'))).toBe(true);
  });

  it('toda cor da paleta é um hex válido', () => {
    for (const p of BANK_PRESETS) expect(normalizeHex(p.color)).toBe(p.color.toLowerCase());
  });

  it('não tem id repetido', () => {
    const ids = BANK_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
