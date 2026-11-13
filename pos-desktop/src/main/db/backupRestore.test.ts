import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { LocalDb } from './database';
import { NODE_SQLITE } from '../test/helpers';
it('restores a SQLite online backup and preserves schema migration, catalog, and retry state', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'moto-sqlite-restore-'));
  const source = new LocalDb(path.join(folder, 'original.sqlite'), { nativeBinding: NODE_SQLITE });
  let restored: LocalDb | undefined;
  try {
    source.setState('localInvoiceSeq', '42');
    source.enqueue({ opId: 'audit-op', type: 'customer_create', payload: { name: { ar: 'synthetic' } }, createdAt: new Date().toISOString(), summary: 'synthetic' });
    source.markOp('audit-op', 'sent', { bumpAttempts: true });
    source.setMeta('schema_version', '3');
    source.db.exec('DROP TABLE sale_returns');
    const backup = path.join(folder, 'backup.sqlite'); await source.db.backup(backup);
    restored = new LocalDb(backup, { nativeBinding: NODE_SQLITE });
    expect(restored.getMeta('schema_version')).toBe('5');
    expect(restored.getState('localInvoiceSeq')).toBe('42');
    expect(restored.pendingOps()).toMatchObject([{ opId: 'audit-op', attempts: 1 }]);
    expect(restored.db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(restored.db.prepare('SELECT count(*) n FROM sale_returns').get()).toEqual({ n: 0 });
  } finally { restored?.close(); source.close(); }
});
