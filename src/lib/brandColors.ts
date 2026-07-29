/**
 * Cores de marca para cartões e contas.
 *
 * O ponto delicado aqui não é guardar a cor — é o texto POR CIMA dela. Um
 * cartão amarelo (Banco do Brasil) com texto branco fica ilegível. Por isso o
 * primeiro-plano é CALCULADO pela luminância relativa (fórmula WCAG), nunca
 * fixado em branco.
 *
 * As cores da paleta são aproximações das marcas, escolhidas para reconhecimento
 * visual — não são valores oficiais de identidade. O seletor de cor livre existe
 * justamente para o usuário ajustar o tom que quiser.
 */

export interface BankPreset {
  id: string;
  name: string;
  color: string;
}

export const BANK_PRESETS: BankPreset[] = [
  { id: 'nubank', name: 'Nubank', color: '#820ad1' },
  { id: 'inter', name: 'Inter', color: '#ff7a00' },
  { id: 'itau', name: 'Itaú', color: '#ec7000' },
  { id: 'bradesco', name: 'Bradesco', color: '#cc092f' },
  { id: 'santander', name: 'Santander', color: '#ec0000' },
  { id: 'bb', name: 'Banco do Brasil', color: '#ffef38' },
  { id: 'caixa', name: 'Caixa', color: '#0070af' },
  { id: 'c6', name: 'C6 Bank', color: '#242424' },
  { id: 'btg', name: 'BTG Pactual', color: '#001e62' },
  { id: 'safra', name: 'Safra', color: '#00285e' },
  { id: 'sicoob', name: 'Sicoob', color: '#00ae9d' },
  { id: 'sicredi', name: 'Sicredi', color: '#3fa110' },
  { id: 'picpay', name: 'PicPay', color: '#21c25e' },
  { id: 'mercadopago', name: 'Mercado Pago', color: '#00aeef' },
  { id: 'pagbank', name: 'PagBank', color: '#00a868' },
  { id: 'xp', name: 'XP', color: '#101010' },
  { id: 'neon', name: 'Neon', color: '#00a3e0' },
  { id: 'will', name: 'Will Bank', color: '#ffe900' },
  { id: 'original', name: 'Original', color: '#00a868' },
  { id: 'pan', name: 'Banco Pan', color: '#00a9e0' },
];

/** Visual padrão de quem ainda não escolheu cor (o cartão escuro de sempre). */
export const DEFAULT_CARD_FROM = '#111827';
export const DEFAULT_CARD_TO = '#0b1220';

/** Normaliza para '#rrggbb' minúsculo. Devolve `null` se não for cor válida. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const [r, g, b] = raw.split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  return null;
}

function toRgb(hex: string): [number, number, number] {
  const norm = normalizeHex(hex) ?? '#000000';
  return [
    parseInt(norm.slice(1, 3), 16),
    parseInt(norm.slice(3, 5), 16),
    parseInt(norm.slice(5, 7), 16),
  ];
}

/** Luminância relativa (WCAG 2.x): 0 = preto, 1 = branco. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste WCAG entre duas cores (1:1 a 21:1). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT_FG = '#ffffff';
const DARK_FG = '#0f172a';

/**
 * Cor de texto legível sobre `background`: branco ou quase-preto, o que der
 * mais contraste. É isso que impede o texto branco de sumir no cartão amarelo.
 */
export function readableForeground(background: string): string {
  const bg = normalizeHex(background);
  if (!bg) return LIGHT_FG;
  return contrastRatio(LIGHT_FG, bg) >= contrastRatio(DARK_FG, bg) ? LIGHT_FG : DARK_FG;
}

/**
 * Versão discreta do texto principal (rótulos, legendas), na MESMA família de
 * claro/escuro — para a hierarquia não inverter no meio do cartão.
 */
export function mutedForeground(background: string): string {
  return readableForeground(background) === LIGHT_FG
    ? 'rgba(255, 255, 255, 0.72)'
    : 'rgba(15, 23, 42, 0.68)';
}

/** Escurece um hex por um fator (0 a 1), sem estourar abaixo de zero. */
function darken(hex: string, factor: number): string {
  const [r, g, b] = toRgb(hex);
  const f = Math.min(1, Math.max(0, factor));
  const to = (v: number) => Math.max(0, Math.round(v * (1 - f))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Par de cores do gradiente do cartão. Manter um degradê (e não cor chapada)
 * é o que preserva a sensação de cartão físico.
 */
export function cardGradient(color: string | null | undefined): { from: string; to: string } {
  const base = normalizeHex(color ?? undefined);
  if (!base) return { from: DEFAULT_CARD_FROM, to: DEFAULT_CARD_TO };
  return { from: base, to: darken(base, 0.38) };
}
