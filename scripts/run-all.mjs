#!/usr/bin/env node
/**
 * Runs one npm script in every project, sequentially, and fails on the first error.
 * Usage: node scripts/run-all.mjs <script> [project ...]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL = ['erp-backend', 'erp-frontend', 'pos-desktop'];

const [script, ...rest] = process.argv.slice(2);
if (!script) {
  console.error('usage: node scripts/run-all.mjs <script> [project ...]');
  process.exit(1);
}
const projects = rest.length ? rest : ALL;

for (const project of projects) {
  console.log(`\n=== ${project}: npm run ${script} ===`);
  const args = script === 'install' ? ['install'] : ['run', script, '--if-present'];
  const res = spawnSync('npm', args, {
    cwd: path.join(ROOT, project),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}
