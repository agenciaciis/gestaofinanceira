/**
 * Parsing PURO de extratos: valores monetários, datas e OFX.
 * Sem dependência de Firebase/React — testável isoladamente.
 */
import { formatLocalDate } from './finance';

export interface ParsedRow {
  date: string; // 'YYYY-MM-DD' ('' se não reconhecida)
  description: string;
  amount: number; // com sinal (negativo = saída)
}

/**
 * Converte um valor monetário em número, lidando com formatos BR ("1.234,56"),
 * US ("1234.56"), negativos ("-50", "(50)") e símbolos (R$).
 * Corrige o bug clássico de multiplicar por 100 ao tratar "1234.56" como milhar.
 */
export function parseAmountBR(raw: unknown): number {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;
  const negative = /^-/.test(s) || /-$/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return NaN;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let decSep: ',' | '.' | '' = '';

  if (lastComma !== -1 && lastDot !== -1) {
    decSep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma !== -1) {
    decSep = ',';
  } else if (lastDot !== -1) {
    const dots = s.split('.').length - 1;
    if (dots > 1) {
      decSep = ''; // vários pontos => todos separadores de milhar
    } else {
      const after = s.length - lastDot - 1;
      decSep = after === 3 ? '' : '.'; // "1.234" => milhar; "12.5"/"12.50" => decimal
    }
  }

  let normalized: string;
  if (decSep === ',') normalized = s.replace(/\./g, '').replace(',', '.');
  else if (decSep === '.') normalized = s.replace(/,/g, '');
  else normalized = s.replace(/[.,]/g, '');

  const n = parseFloat(normalized);
  if (Number.isNaN(n)) return NaN;
  return negative ? -Math.abs(n) : n;
}

/**
 * Reconhece datas em formatos comuns e devolve 'YYYY-MM-DD'.
 * Prioriza o formato brasileiro DD/MM/AAAA. Retorna '' se não reconhecer.
 */
export function parseFlexibleDate(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';

  // ISO 'YYYY-MM-DD' (com ou sem hora)
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // OFX compacto 'YYYYMMDD'
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (m && s.length >= 8 && /^\d+$/.test(s.slice(0, 8))) {
    return `${m[1]}-${m[2]}-${m[3]}`;
  }

  // DD/MM/AAAA (ou com - ou .)
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    const dn = Number(d), mn = Number(mo);
    if (mn >= 1 && mn <= 12 && dn >= 1 && dn <= 31) {
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return '';
  }

  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return formatLocalDate(dt);
  return '';
}

/**
 * Extrai transações de um arquivo OFX/QFX (padrão bancário).
 * Lê os blocos <STMTTRN> e seus campos DTPOSTED / TRNAMT / MEMO|NAME.
 */
export function parseOFX(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  if (!text) return rows;
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const b of blocks) {
    const get = (tag: string) => {
      const mm = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(b);
      return mm ? mm[1].trim() : '';
    };
    const dt = get('DTPOSTED');
    const amt = get('TRNAMT');
    const memo = get('MEMO') || get('NAME') || get('PAYEE');
    if (!dt && !amt) continue;
    rows.push({
      date: parseFlexibleDate(dt),
      description: memo || 'Lançamento importado',
      amount: parseAmountBR(amt),
    });
  }
  return rows;
}
