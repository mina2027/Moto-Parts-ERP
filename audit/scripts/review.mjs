import { snapshotFiles } from './layout.mjs';
// Read-only comparison with the pre-audit snapshots; preserves existing user changes.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const changes = [];
const diffs = [];
for (const { before, relative } of snapshotFiles('originals')) {
  const after = path.join(root, relative);
  if (!fs.existsSync(after)) throw new Error(`Missing current file: ${relative}`);
  const a = fs.readFileSync(before);
  const b = fs.readFileSync(after);
  if (a.equals(b)) continue;
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--', before, after], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (![0, 1].includes(result.status)) throw new Error(`Diff failed: ${relative}: ${result.stderr}`);
  diffs.push(result.stdout);
  changes.push({ file: relative.replaceAll('\\', '/'), beforeSha256: createHash('sha256').update(a).digest('hex'), afterSha256: createHash('sha256').update(b).digest('hex') });
}
fs.writeFileSync(path.join(root, 'audit/evidence/audit-changes.patch'), diffs.join('\n'));
fs.writeFileSync(path.join(root, 'audit/evidence/changed-files.json'), JSON.stringify(changes, null, 2) + '\n');
console.log(`${changes.length} changed snapshot files compared; mirrored packages are checked separately with sync-packages.mjs --check.`);
