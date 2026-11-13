import { snapshotFiles } from './layout.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '../..');
const evidence = path.join(root, 'audit/evidence/final');
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const hash = data => createHash('sha256').update(data).digest('hex');
const changes = [], diffs = [];
for (const { before, relative } of snapshotFiles('originals-final')) {
  const after = path.join(root, relative);
  if (!fs.existsSync(after)) throw new Error(`Missing snapshot source ${relative}`);
  const a = fs.readFileSync(before), b = fs.readFileSync(after);
  if (a.equals(b)) continue;
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--', before, after], { encoding: 'utf8', windowsHide: true });
  if (![0, 1].includes(result.status)) throw new Error(`Diff failed ${relative}`);
  changes.push({ file: relative.replaceAll('\\', '/'), snapshotSha256: hash(a), finalSha256: hash(b), baseline: 'Available snapshot; some inherited final-phase snapshots were captured after an edit and are not a complete pre-edit baseline' });
  diffs.push(result.stdout);
}
fs.writeFileSync(path.join(evidence, 'changed-files.json'), JSON.stringify(changes, null, 2) + '\n');
fs.writeFileSync(path.join(evidence, 'changes.patch'), diffs.join('\n'));
const manifest = [];
for (const dir of ['erp-backend/src', 'erp-backend/packages', 'erp-frontend/src', 'erp-frontend/packages', 'pos-desktop/src', 'pos-desktop/packages']) for (const file of files(path.join(root, dir))) if (!file.includes(`${path.sep}node_modules${path.sep}`)) manifest.push({ file: path.relative(root, file).replaceAll('\\', '/'), sha256: hash(fs.readFileSync(file)) });
fs.writeFileSync(path.join(evidence, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${changes.length} available snapshot changes; ${manifest.length} final source hashes; no user baseline reconstructed.`);
