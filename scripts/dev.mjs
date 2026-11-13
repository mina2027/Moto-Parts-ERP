#!/usr/bin/env node
/**
 * Runs the backend and the web front-end together from the repo root.
 * The three projects are independent npm installs, so there is no workspace
 * runner here — just two child processes sharing this terminal.
 *
 * Usage: node scripts/dev.mjs [api|web|pos ...]   (default: api web)
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = { api: 'erp-backend', web: 'erp-frontend', pos: 'pos-desktop' };
const WIN = process.platform === 'win32';

const names = process.argv.slice(2).filter((a) => a in TARGETS);
const selected = names.length ? names : ['api', 'web'];

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let stopping = false;

// On Windows `npm` is a shim, so killing it orphans the vite/tsx grandchild — kill the whole tree.
function kill(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-child.pid, 'SIGTERM');
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) kill(c);
  process.exitCode = code;
}

for (const name of selected) {
  const cwd = path.join(ROOT, TARGETS[name]);
  const child = spawn('npm', ['run', 'dev'], { cwd, stdio: 'inherit', shell: WIN, detached: !WIN });
  child.on('exit', (code, signal) => stop(code ?? (signal ? 1 : 0)));
  children.push(child);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
