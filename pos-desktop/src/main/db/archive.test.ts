import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { archiveTerminal, financialFingerprint } from './archive';
import { LocalDb } from './database';
import { NODE_SQLITE } from '../test/helpers';
it('archives settlement sources and retry state with a verified hash and restores without erasing the terminal', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'moto-release-archive-'));
  const db = new LocalDb(path.join(directory, 'source.sqlite'), { nativeBinding: NODE_SQLITE });
  try {
    db.db.prepare('INSERT INTO rejected_settlements VALUES (?, ?, ?)').run('op1', 'sale1', JSON.stringify({ payoutAmount: 50, reference: 'synthetic' }));
    db.enqueue({ opId: 'pending1', type: 'sale', payload: { localId: 'sale1' }, createdAt: new Date().toISOString(), summary: 'synthetic' });
    const fingerprint = financialFingerprint(db), result = await archiveTerminal(db, directory, NODE_SQLITE);
    expect(result.sha256).toBe(createHash('sha256').update(readFileSync(result.file)).digest('hex'));
    expect(result.settlements).toEqual([{ payoutAmount: 50, reference: 'synthetic' }]);
    expect(financialFingerprint(db)).toBe(fingerprint); expect(db.counts().pending).toBe(1);
    const restored = new LocalDb(result.file, { nativeBinding: NODE_SQLITE });
    try { expect(financialFingerprint(restored)).toBe(fingerprint); expect(restored.counts().pending).toBe(1); } finally { restored.close(); }
    expect(() => db.wipe()).toThrow('UNSYNCED_OPERATIONS');
  } finally { db.close(); }
});
