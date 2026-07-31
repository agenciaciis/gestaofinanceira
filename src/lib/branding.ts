/**
 * Papel timbrado da empresa para os orçamentos.
 *
 * A imagem é guardada como data URL no próprio Firestore
 * (entities/{id}/config/branding), NÃO no Firebase Storage: o Storage exigiria
 * publicar regras novas, e o objetivo é que isso funcione no dia do deploy sem
 * depender de mais nenhum passo manual.
 *
 * Por isso o tamanho importa: documento do Firestore tem teto de 1 MiB. A
 * imagem é reduzida e recomprimida no navegador antes de salvar.
 */

/** Teto de segurança do data URL salvo (Firestore permite ~1 MiB por documento). */
export const MAX_LETTERHEAD_BYTES = 700_000;

/** Dados da empresa que saem no topo/rodapé do PDF (editáveis pelo usuário). */
export interface CompanyInfo {
  name: string;
  owner: string;
  cnpj: string;
  phone: string;
  email: string;
  site: string;
  address: string;
}

/** Padrão inicial (o usuário edita e salva em config/branding). */
export const DEFAULT_COMPANY: CompanyInfo = {
  name: 'Agência Ciis',
  owner: 'Lucas Vieira Alves Ferreira',
  cnpj: '44.744.867/0001-27',
  phone: '(14) 99642-2067',
  email: 'contato@agenciaciis.com.br',
  site: 'www.agenciaciis.com.br',
  address: '',
};

/**
 * Comprime a LOGO preservando transparência (PNG). Diferente do timbrado, aqui
 * não forçamos fundo branco nem A4 inteiro — é só a marca, pequena.
 */
export async function compressLogo(file: File): Promise<string> {
  const original: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Arquivo não é uma imagem válida.'));
    el.src = original;
  });

  for (const maxW of [480, 360, 260, 180]) {
    const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Navegador não suportou o processamento da imagem.');
    ctx.clearRect(0, 0, w, h); // preserva transparência do PNG
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL('image/png');
    if (dataUrlBytes(out) <= MAX_LETTERHEAD_BYTES) return out;
  }
  throw new Error('Logo muito pesada. Envie um PNG menor.');
}

/** Aceita PNG (para preservar transparência da logo) dentro do teto do Firestore. */
export function validateLogo(dataUrl: string | null | undefined): LetterheadValidation {
  if (!dataUrl) return { ok: false, reason: 'Nenhuma imagem selecionada.' };
  if (!/^data:image\/png;base64,/i.test(dataUrl)) return { ok: false, reason: 'Envie a logo em PNG.' };
  if (dataUrlBytes(dataUrl) > MAX_LETTERHEAD_BYTES) return { ok: false, reason: 'Logo muito pesada.' };
  return { ok: true };
}

/** Largura máxima em pixels — A4 a ~150dpi resolve bem para fundo de PDF. */
export const MAX_LETTERHEAD_WIDTH = 1240;

export interface LetterheadValidation {
  ok: boolean;
  reason?: string;
}

/** Tamanho aproximado, em bytes, do conteúdo de um data URL base64. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const base64 = dataUrl.slice(comma + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** Aceita apenas imagem, e apenas dentro do teto que o Firestore comporta. */
export function validateLetterhead(dataUrl: string | null | undefined): LetterheadValidation {
  if (!dataUrl) return { ok: false, reason: 'Nenhuma imagem selecionada.' };
  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) {
    return { ok: false, reason: 'Envie uma imagem PNG, JPG ou WEBP.' };
  }
  const bytes = dataUrlBytes(dataUrl);
  if (bytes > MAX_LETTERHEAD_BYTES) {
    return {
      ok: false,
      reason: `Imagem muito pesada (${Math.round(bytes / 1024)} KB). O limite é ${Math.round(MAX_LETTERHEAD_BYTES / 1024)} KB.`,
    };
  }
  return { ok: true };
}

/**
 * Dimensões finais respeitando a largura máxima, mantendo a proporção.
 * Separado do canvas para poder ser testado sem navegador.
 */
export function fitDimensions(
  width: number,
  height: number,
  maxWidth = MAX_LETTERHEAD_WIDTH
): { width: number; height: number } {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  if (w <= maxWidth) return { width: w, height: h };
  const ratio = maxWidth / w;
  return { width: maxWidth, height: Math.max(1, Math.round(h * ratio)) };
}

/**
 * Lê o arquivo, reduz e recomprime até caber no teto do Firestore.
 * Baixa a qualidade progressivamente em vez de simplesmente recusar o arquivo.
 */
export async function compressLetterhead(file: File): Promise<string> {
  const original: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Arquivo não é uma imagem válida.'));
    el.src = original;
  });

  const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Navegador não suportou o processamento da imagem.');

  // Fundo branco: papel timbrado com transparência viraria preto no PDF.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  for (const quality of [0.92, 0.85, 0.75, 0.65, 0.55, 0.45]) {
    const out = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlBytes(out) <= MAX_LETTERHEAD_BYTES) return out;
  }
  throw new Error('Não consegui deixar a imagem leve o bastante. Envie uma versão menor.');
}
