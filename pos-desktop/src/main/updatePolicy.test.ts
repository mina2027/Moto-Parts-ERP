import { expect, it } from 'vitest';
import path from 'node:path';
import { trustedUpdateFeed, assertSignature, assertInstallable } from './updatePolicy';
import { memDb } from './test/helpers';
const pin = 'A'.repeat(40);
it('requires HTTPS without credentials and an explicitly pinned publisher', () => {
  expect(trustedUpdateFeed('https://updates.example/pos', 'CN=Moto', [pin])).toBe('https://updates.example/pos');
  for (const url of ['http://updates.example', 'https://user:pass@updates.example', 'file:///tmp/update', 'https://updates.example?token=secret']) expect(() => trustedUpdateFeed(url, 'CN=Moto', [pin])).toThrow();
  expect(() => trustedUpdateFeed('https://updates.example', '', [pin])).toThrow();
  expect(() => trustedUpdateFeed('https://updates.example', 'CN=Moto', [])).toThrow();
});
it('rejects unsigned, mismatched and wrong-file signatures', () => {
  const file = path.resolve('fixture.exe'), good = { Status: 0, Path: file, SignerCertificate: { Thumbprint: pin } };
  expect(() => assertSignature(good, file, [pin])).not.toThrow();
  expect(() => assertSignature({ ...good, Status: 2 }, file, [pin])).toThrow();
  expect(() => assertSignature({ ...good, SignerCertificate: null }, file, [pin])).toThrow();
  expect(() => assertSignature(good, file, ['B'.repeat(40)])).toThrow();
  expect(() => assertSignature(good, path.resolve('other.exe'), [pin])).toThrow();
});
it('blocks installation with untrusted code, pending/rejected operations or an open shift', () => {
  const db = memDb();
  try {
    expect(() => assertInstallable(db, false, true)).toThrow('UPDATE_NOT_READY');
    expect(() => assertInstallable(db, true, false)).toThrow('UNTRUSTED_UPDATE_SIGNATURE');
    db.enqueue({ opId: 'sale', type: 'sale', payload: {}, createdAt: new Date().toISOString(), summary: 'fixture' });
    expect(() => assertInstallable(db, true, true)).toThrow('RECONCILIATION_REQUIRED');
    db.markOp('sale', 'rejected'); expect(() => assertInstallable(db, true, true)).toThrow('RECONCILIATION_REQUIRED');
    db.deleteOp('sale'); expect(() => assertInstallable(db, true, true)).not.toThrow();
    db.db.prepare('INSERT INTO register_sessions (id, status, opened_at, doc) VALUES (?, ?, ?, ?)').run('shift', 'open', new Date().toISOString(), JSON.stringify({ id: 'shift', status: 'open' }));
    expect(() => assertInstallable(db, true, true)).toThrow('RECONCILIATION_REQUIRED');
  } finally { db.close(); }
});
