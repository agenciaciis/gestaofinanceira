import { describe, it, expect } from 'vitest';
import {
  BACKUP_VERSION, BACKUP_SUBCOLLECTIONS,
  encodeTimestamps, decodeTimestamps, validateBackup, countBackupItems, backupFilename,
} from './backup';

// Timestamp falso do Firestore: tem toMillis().
class FakeTs {
  constructor(public ms: number) {}
  toMillis() { return this.ms; }
}
const isTs = (v: any) => v instanceof FakeTs;
const toMs = (v: FakeTs) => v.toMillis();
const makeTs = (ms: number) => new FakeTs(ms);

describe('encode/decodeTimestamps', () => {
  it('serializa e reconstrói Timestamps aninhados', () => {
    const original = {
      nome: 'Conta',
      createdAt: new FakeTs(1000),
      items: [{ date: new FakeTs(2000), valor: 10 }],
      recurrence: { start: new FakeTs(3000), enabled: true },
    };
    const encoded = encodeTimestamps(original, isTs, toMs);
    // Vira JSON puro (sem instâncias) e volta.
    const roundtrip = JSON.parse(JSON.stringify(encoded));
    const decoded = decodeTimestamps(roundtrip, makeTs);
    expect(decoded.createdAt).toBeInstanceOf(FakeTs);
    expect(decoded.createdAt.toMillis()).toBe(1000);
    expect(decoded.items[0].date.toMillis()).toBe(2000);
    expect(decoded.recurrence.start.toMillis()).toBe(3000);
    expect(decoded.recurrence.enabled).toBe(true);
    expect(decoded.nome).toBe('Conta');
  });

  it('preserva null, números e strings', () => {
    const v = { a: null, b: 0, c: '', d: false };
    expect(decodeTimestamps(encodeTimestamps(v, isTs, toMs), makeTs)).toEqual(v);
  });
});

describe('validateBackup', () => {
  it('aceita backup válido', () => {
    const ok = validateBackup({ version: 1, entities: [{ id: 'e1', collections: {} }] });
    expect(ok.ok).toBe(true);
  });
  it('recusa objeto sem versão', () => {
    expect(validateBackup({ entities: [] }).ok).toBe(false);
  });
  it('recusa versão futura', () => {
    expect(validateBackup({ version: BACKUP_VERSION + 1, entities: [] }).ok).toBe(false);
  });
  it('recusa entities não-array', () => {
    expect(validateBackup({ version: 1, entities: {} }).ok).toBe(false);
  });
  it('recusa entidade malformada', () => {
    expect(validateBackup({ version: 1, entities: [{ id: 'x' }] }).ok).toBe(false);
  });
});

describe('countBackupItems', () => {
  it('conta entidades e documentos', () => {
    const backup = {
      version: 1, exportedAt: '2026-01-01', app: 'finanflow',
      entities: [
        { id: 'e1', data: {}, collections: { transactions: [{ id: 't1', data: {} }, { id: 't2', data: {} }], clients: [{ id: 'c1', data: {} }] } },
        { id: 'e2', data: {}, collections: { transactions: [{ id: 't3', data: {} }] } },
      ],
    };
    expect(countBackupItems(backup as any)).toEqual({ entities: 2, documents: 4 });
  });
});

describe('backupFilename', () => {
  it('usa a data ISO', () => {
    expect(backupFilename('2026-08-01T10:20:30.000Z')).toBe('finanflow-backup-2026-08-01.json');
  });
  it('tem fallback', () => {
    expect(backupFilename('')).toBe('finanflow-backup-backup.json');
  });
});

describe('BACKUP_SUBCOLLECTIONS', () => {
  it('inclui as coleções essenciais', () => {
    for (const c of ['transactions', 'bank_accounts', 'credit_cards', 'clients', 'quotes', 'config']) {
      expect(BACKUP_SUBCOLLECTIONS).toContain(c as any);
    }
  });
});
