import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');
const evidenceRelative = process.argv[2];
if (!evidenceRelative) throw new Error('Usage: node audit/scripts/software-verification.mjs audit/evidence/<run>');
const evidence = path.resolve(root, evidenceRelative);
fs.mkdirSync(evidence, { recursive: true });
const checks = [];
const projects = ['erp-backend', 'erp-frontend', 'pos-desktop'];
const excluded = new Set(['node_modules', '.git', 'audit', 'dist', 'out', 'release', '.local', 'uploads', 'coverage']);
function snapshot() {
  const hashes = {};
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (excluded.has(entry.name) || entry.name.startsWith('.env')) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:ts|tsx|js|jsx|mjs|cjs|json|yml|yaml|html|css|md)$/.test(entry.name) && !entry.name.endsWith('.tsbuildinfo')) {
        hashes[path.relative(root, file).replaceAll('\\', '/')] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      }
    }
  }
  for (const project of projects) walk(path.join(root, project));
  walk(path.join(root, 'scripts'));
  return hashes;
}
const before = snapshot();
fs.writeFileSync(path.join(evidence, 'source-before.json'), JSON.stringify(before, null, 2));
async function run(name, project, command, args, extraEnv = {}) {
  const startedAt = new Date().toISOString();
  console.log(JSON.stringify({ name, status: 'started', startedAt }));
  const stream = fs.createWriteStream(path.join(evidence, `${name}.log`));
  const child = spawn(command, args, {
    cwd: project ? path.join(root, project) : root,
    shell: command.endsWith('.cmd'), windowsHide: true,
    env: { ...process.env, NO_COLOR: '1', ...extraEnv },
  });
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream, { end: false });
  let spawnError;
  child.on('error', error => { spawnError = String(error); stream.write(spawnError); });
  const exitCode = await new Promise(resolve => child.on('close', resolve));
  await new Promise(resolve => stream.end(resolve));
  const result = { name, project, command: [command, ...args], startedAt, finishedAt: new Date().toISOString(), exitCode, ...(spawnError ? { spawnError } : {}) };
  checks.push(result);
  fs.writeFileSync(path.join(evidence, `${name}.execution.json`), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(evidence, 'verification-checks.json'), JSON.stringify(checks, null, 2));
  console.log(JSON.stringify(result));
  return result;
}
await Promise.all([
  run('automated-suites', null, process.execPath, ['audit/scripts/comprehensive-checks.mjs', evidenceRelative]),
  (async () => {
    for (const script of ['typecheck', 'lint']) await run(script, null, 'npm.cmd', ['run', script]);
    for (const project of projects) await run(`${project}-build`, project, 'npm.cmd', ['run', 'build']);
    await run('package-copy-consistency', null, process.execPath, ['scripts/sync-packages.mjs', '--check']);
  })(),
  (async () => {
    for (const project of projects) {
      await run(`${project}-audit-production`, project, 'npm.cmd', ['audit', '--omit=dev', '--json']);
      await run(`${project}-audit-all`, project, 'npm.cmd', ['audit', '--json']);
    }
  })(),
]);
// MongoDB acceptance starts only after both automated MongoDB suites have stopped.
await run('browser-acceptance', null, path.join(root, 'erp-backend/node_modules/.bin/tsx.cmd'), ['audit/scripts/comprehensive-uat.ts', `${evidenceRelative}/uat`]);
await run('api-probes', null, path.join(root, 'erp-backend/node_modules/.bin/tsx.cmd'), ['audit/scripts/software-api-probes.ts', `${evidenceRelative}/api-probes`]);
await run('body-parser-probe', null, process.execPath, ['audit/scripts/body-parser-security-probe.mjs', `${evidenceRelative}/body-parser-probe`]);
await run('electron-runtime', null, process.execPath, ['audit/scripts/electron-runtime.mjs'], { POS_AUDIT_EVIDENCE: evidenceRelative });
await run('electron-ipc-runtime', null, process.execPath, ['audit/scripts/ipc-runtime.mjs'], { POS_AUDIT_EVIDENCE: evidenceRelative });
const after = snapshot();
const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]);
fs.writeFileSync(path.join(evidence, 'source-after.json'), JSON.stringify(after, null, 2));
fs.writeFileSync(path.join(evidence, 'source-integrity.json'), JSON.stringify({ filesChecked: Object.keys(before).length, changed }, null, 2));
console.log(JSON.stringify({ complete: true, checks: checks.length, failed: checks.filter(check => check.exitCode !== 0).map(check => check.name), sourceChanges: changed, evidence }));
if (checks.some(check => check.exitCode !== 0) || changed.length) process.exitCode = 1;
