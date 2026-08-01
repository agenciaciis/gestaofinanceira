/**
 * Backup e restauração do sistema.
 *
 * Exporta/reimporta TODOS os dados das entidades do usuário num arquivo JSON.
 * As funções aqui são puras (sem Firebase) para poderem ser testadas: a leitura
 * e a escrita no Firestore ficam na tela de Ajustes, que injeta os callbacks de
 * (de)serialização de Timestamp.
 */

export const BACKUP_VERSION = 1;

/** Subcoleções de cada entidade que entram no backup (na ordem de restauração). */
export const BACKUP_SUBCOLLECTIONS = [
  'bank_accounts',
  'credit_cards',
  'transactions',
  'debts',
  'debt_meta',
  'clients',
  'suppliers',
  'services',
  'products',
  'plans',
  'quotes',
  'credit_scores',
  'config',
] as const;

export type BackupSubcollection = typeof BACKUP_SUBCOLLECTIONS[number];

export interface BackupEntity {
  id: string;
  data: Record<string, any>;
  collections: Record<string, { id: string; data: Record<string, any> }[]>;
}

export interface Backup {
  version: number;
  exportedAt: string; // ISO
  app: string;
  entities: BackupEntity[];
}

/** Marcador serializável para Timestamps do Firestore dentro do JSON. */
const TS_KEY = '__ts_ms__';

/**
 * Substitui recursivamente Timestamps por um marcador { __ts_ms__: <millis> }.
 * `isTs` e `toMillis` são injetados para manter este módulo livre do Firebase.
 */
export function encodeTimestamps(
  value: any,
  isTs: (v: any) => boolean,
  toMillis: (v: any) => number
): any {
  if (value == null) return value;
  if (isTs(value)) return { [TS_KEY]: toMillis(value) };
  if (Array.isArray(value)) return value.map(v => encodeTimestamps(v, isTs, toMillis));
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) out[k] = encodeTimestamps(value[k], isTs, toMillis);
    return out;
  }
  return value;
}

/** Reconstrói Timestamps a partir dos marcadores. `makeTs(ms)` cria o Timestamp. */
export function decodeTimestamps(value: any, makeTs: (ms: number) => any): any {
  if (value == null) return value;
  if (typeof value === 'object' && !Array.isArray(value) && typeof value[TS_KEY] === 'number') {
    return makeTs(value[TS_KEY]);
  }
  if (Array.isArray(value)) return value.map(v => decodeTimestamps(v, makeTs));
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) out[k] = decodeTimestamps(value[k], makeTs);
    return out;
  }
  return value;
}

/** Valida a forma de um objeto lido de arquivo antes de restaurar. */
export function validateBackup(obj: any): { ok: boolean; reason?: string } {
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'Arquivo inválido.' };
  if (typeof obj.version !== 'number') return { ok: false, reason: 'Arquivo sem versão de backup.' };
  if (obj.version > BACKUP_VERSION) return { ok: false, reason: 'Backup de uma versão mais nova do que este app.' };
  if (!Array.isArray(obj.entities)) return { ok: false, reason: 'Backup sem lista de entidades.' };
  for (const e of obj.entities) {
    if (!e || typeof e.id !== 'string' || typeof e.collections !== 'object') {
      return { ok: false, reason: 'Estrutura de entidade inválida no backup.' };
    }
  }
  return { ok: true };
}

/** Conta entidades e documentos de um backup (para mostrar ao usuário). */
export function countBackupItems(backup: Backup): { entities: number; documents: number } {
  let documents = 0;
  for (const e of backup.entities) {
    for (const col of Object.keys(e.collections || {})) {
      documents += (e.collections[col] || []).length;
    }
  }
  return { entities: backup.entities.length, documents };
}

/** Nome do arquivo de backup a partir de uma data ISO (yyyy-mm-dd). */
export function backupFilename(iso: string): string {
  const dia = (iso || '').slice(0, 10) || 'backup';
  return `finanflow-backup-${dia}.json`;
}
