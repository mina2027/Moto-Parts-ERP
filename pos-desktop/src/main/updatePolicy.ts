import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { LocalDb } from './db/database';
const execFileAsync = promisify(execFile);

export function trustedUpdateFeed(raw: string, publisher: string, thumbprints: readonly string[]): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !publisher.trim() || !thumbprints.length || thumbprints.some(pin => !/^[A-Fa-f0-9]{40}$/.test(pin))) throw new Error('UNTRUSTED_UPDATE_CONFIGURATION');
  return url.href;
}

export function assertSignature(info: { Status: number; Path: string; SignerCertificate?: { Thumbprint: string } | null }, file: string, pins: readonly string[]) {
  if (info.Status !== 0 || path.resolve(info.Path).toLowerCase() !== path.resolve(file).toLowerCase() || !info.SignerCertificate || !pins.map(p => p.toUpperCase()).includes(info.SignerCertificate.Thumbprint.toUpperCase())) throw new Error('UNTRUSTED_UPDATE_SIGNATURE');
}

/** Fail closed if Windows verification is unavailable, the chain is invalid, or the signer isn't pinned. */
export async function verifyPinnedExecutable(file: string, pins: readonly string[]) {
  if (process.platform !== 'win32' || !pins.length) throw new Error('UNTRUSTED_UPDATE_SIGNATURE');
  const { stdout, stderr } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$s = Get-AuthenticodeSignature -LiteralPath $env:POS_VERIFY_EXECUTABLE; [PSCustomObject]@{ Status = [int]$s.Status; Path = $s.Path; SignerCertificate = $(if ($s.SignerCertificate) { @{ Thumbprint = $s.SignerCertificate.Thumbprint } } else { $null }) } | ConvertTo-Json -Compress'], { timeout: 20000, windowsHide: true, env: { ...process.env, POS_VERIFY_EXECUTABLE: path.resolve(file) } });
  if (stderr.trim()) throw new Error('UPDATE_SIGNATURE_CHECK_FAILED');
  assertSignature(JSON.parse(stdout.replace(/^\uFEFF/, '').trim()), file, pins);
}

export function assertInstallable(db: LocalDb, downloaded: boolean, trusted: boolean) {
  if (!downloaded) throw new Error('UPDATE_NOT_READY');
  if (!trusted) throw new Error('UNTRUSTED_UPDATE_SIGNATURE');
  if (db.counts().pending || db.counts().rejected || db.openSession()) throw new Error('RECONCILIATION_REQUIRED');
}
