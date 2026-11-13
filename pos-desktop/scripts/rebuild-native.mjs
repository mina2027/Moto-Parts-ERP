/**
 * Validate and install the bundled Node-API binary for better-sqlite3 v13+.
 * For older releases, fetch runtime-specific better-sqlite3 prebuilt binaries for:
 *   1) the installed Electron ABI → node_modules/better-sqlite3/build/Release (used by the app)
 *   2) the current Node ABI       → native/better_sqlite3.node (used by vitest)
 * electron-builder's `install-app-deps` runs a nested npm install which breaks inside npm workspaces,
 * so we call prebuild-install directly against the hoisted package.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
let electronVersion;
let sqliteDir;
try {
  electronVersion = require('electron/package.json').version;
  sqliteDir = dirname(require.resolve('better-sqlite3/package.json'));
} catch {
  console.log('better-sqlite3: electron / better-sqlite3 not installed (e.g. --omit=dev or API-only image) — skipping.');
  process.exit(0);
}
const built = join(sqliteDir, 'build', 'Release', 'better_sqlite3.node');
const nodeCopy = join(here, '..', 'native', 'better_sqlite3.node');
const sqliteVersion = require('better-sqlite3/package.json').version;
const nodeStamp = `${nodeCopy}.runtime`;
const nodeRuntime = `node@${process.versions.node}/better-sqlite3@${sqliteVersion}`;
const electronRuntime = `electron@${electronVersion}/better-sqlite3@${sqliteVersion}`;
// better-sqlite3's own install script leaves a Node-ABI binary in build/Release, so existence alone
// is not proof the app binary matches Electron — this stamp records which runtime built it.
const stamp = join(sqliteDir, 'build', 'Release', '.runtime');
const force = process.env.FORCE_REBUILD === '1';

// v13 ships Node-API binaries shared by Node and Electron, replacing ABI-specific downloads.
const napiBinary = join(sqliteDir, 'prebuilds', `${process.platform}-${process.arch}.node`);
if (Number(sqliteVersion.split('.')[0]) >= 13 && existsSync(napiBinary)) {
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:', { nativeBinding: napiBinary });
  const sqlite = probe.prepare('SELECT sqlite_version() AS version').get();
  probe.close();
  mkdirSync(dirname(nodeCopy), { recursive: true });
  mkdirSync(dirname(built), { recursive: true });
  copyFileSync(napiBinary, nodeCopy);
  copyFileSync(napiBinary, built);
  writeFileSync(nodeStamp, `${nodeRuntime}\n`);
  writeFileSync(stamp, `${electronRuntime}\n`);
  console.log(`better-sqlite3@${sqliteVersion}: installed bundled Node-API binary; Node SQLite probe ${sqlite.version} passed. Electron probe required separately.`);
  process.exit(0);
}

const fetch = (runtime, target) => execSync(`npx prebuild-install -r ${runtime} -t ${target}`, { cwd: sqliteDir, stdio: 'inherit' });
const stamped = () => (existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : '');

if (force || !existsSync(nodeCopy) || !existsSync(nodeStamp) || readFileSync(nodeStamp, 'utf8').trim() !== nodeRuntime) {
  console.log(`better-sqlite3: fetching prebuild for node ${process.versions.node} (tests)…`);
  fetch('node', process.versions.node);
  mkdirSync(dirname(nodeCopy), { recursive: true });
  copyFileSync(built, nodeCopy);
  writeFileSync(nodeStamp, `${nodeRuntime}\n`);
}

if (force || !existsSync(built) || stamped() !== electronRuntime) {
  console.log(`better-sqlite3: fetching prebuild for electron ${electronVersion} (app)…`);
  fetch('electron', electronVersion);
  writeFileSync(stamp, `${electronRuntime}\n`);
} else {
  console.log('better-sqlite3: binaries present (set FORCE_REBUILD=1 to refetch).');
}
