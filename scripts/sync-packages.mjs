/**
 * The three projects each ship their own physical copy of the shared packages. This mirrors a
 * source copy onto the others and reports what changed, so a package edit can never land in one
 * project only. Run with --check to verify without writing.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** source project → projects that must match it, per package. */
const PACKAGES = [
  { name: 'shared', from: 'pos-desktop', to: ['erp-frontend', 'erp-backend'] },
  { name: 'pos-core', from: 'pos-desktop', to: ['erp-frontend'] },
  { name: 'ui', from: 'pos-desktop', to: ['erp-frontend'] },
  { name: 'api-client', from: 'pos-desktop', to: ['erp-frontend'] },
];

const check = process.argv.includes('--check');

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full, base) : [path.relative(base, full)];
  });
}

let differences = 0;
let copied = 0;

for (const pkg of PACKAGES) {
  const src = path.join(ROOT, pkg.from, 'packages', pkg.name, 'src');
  if (!existsSync(src)) continue;
  const srcFiles = walk(src);
  for (const project of pkg.to) {
    const dest = path.join(ROOT, project, 'packages', pkg.name, 'src');
    if (!existsSync(dest)) continue;
    for (const rel of srcFiles) {
      const a = readFileSync(path.join(src, rel));
      const target = path.join(dest, rel);
      const same = existsSync(target) && readFileSync(target).equals(a);
      if (same) continue;
      differences++;
      console.log(`${check ? 'DIFF' : 'COPY'} ${project}/packages/${pkg.name}/src/${rel.replace(/\\/g, '/')}`);
      if (!check) {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, a);
        copied++;
      }
    }
    for (const rel of walk(dest)) {
      if (srcFiles.includes(rel)) continue;
      differences++;
      console.log(`${check ? 'EXTRA' : 'DELETE'} ${project}/packages/${pkg.name}/src/${rel.replace(/\\/g, '/')}`);
      if (!check) rmSync(path.join(dest, rel));
    }
  }
}

if (check && differences) {
  console.error(`\n${differences} file(s) differ between package copies.`);
  process.exit(1);
}
console.log(check ? 'All package copies are identical.' : `Synced ${copied} file(s).`);
