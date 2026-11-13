import Database from 'better-sqlite3';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { LocalDb } from './database';

export function financialFingerprint(db: LocalDb): string {
  const hash = createHash('sha256');
  for (const table of ['sales', 'sale_returns', 'rejected_settlements', 'register_sessions', 'outbox', 'customers', 'stock_levels', 'sync_state']) hash.update(JSON.stringify(db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
  return hash.digest('hex');
}

/** Complete SQLite snapshot, including encrypted auth: keep under the terminal's protected profile. */
export async function archiveTerminal(db: LocalDb, directory: string, nativeBinding?: string) {
  await mkdir(directory, { recursive: true });
  const fingerprint = financialFingerprint(db), id = randomUUID();
  const file = path.join(directory, `terminal-${id}.sqlite`), manifest = path.join(directory, `terminal-${id}.json`);
  await db.db.backup(file);
  const copy = new Database(file, { readonly: true, fileMustExist: true, ...(nativeBinding ? { nativeBinding } : {}) });
  try {
    if (copy.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('ARCHIVE_INTEGRITY_FAILED');
    if (financialFingerprint({ db: copy } as LocalDb) !== fingerprint || financialFingerprint(db) !== fingerprint) throw new Error('ARCHIVE_STATE_CHANGED');
    const rows = copy.prepare('SELECT doc FROM rejected_settlements ORDER BY op_id').all() as { doc: string }[];
    const result = { file, manifest, createdAt: new Date().toISOString(), sha256: createHash('sha256').update(await readFile(file)).digest('hex'), fingerprint, schemaVersion: db.getMeta('schema_version'), settlements: rows.map(row => JSON.parse(row.doc)), counts: db.counts(), integrity: 'ok', containsEncryptedCredentials: true };
    await writeFile(manifest, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    return result;
  } finally { copy.close(); }
}
