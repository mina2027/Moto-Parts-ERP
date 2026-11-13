/**
 * Package the Windows app. The generic auto-update feed is optional: electron-builder cannot expand
 * `${env.POS_UPDATE_URL}` when the variable is unset, so the publish config is injected here instead
 * and simply omitted (no latest.yml, auto-update off) when no feed URL is configured.
 * Usage: node scripts/dist.mjs [extra electron-builder targets…]
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);

const run = (cmd, args) => {
  const { status } = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (status !== 0) process.exit(status ?? 1);
};

const feed = (process.env.POS_UPDATE_URL ?? '').trim();
const publisher = (process.env.POS_UPDATE_PUBLISHER ?? '').trim();
const pins = (process.env.POS_UPDATE_THUMBPRINTS ?? '').split(',').map(pin => pin.trim()).filter(Boolean);
const unsignedAudit = process.env.POS_ALLOW_UNSIGNED_AUDIT === '1';
if (unsignedAudit && feed) throw new Error('Unsigned audit artifacts cannot configure an update feed');
if (!unsignedAudit && (!publisher || !pins.length || pins.some(pin => !/^[A-Fa-f0-9]{40}$/.test(pin)))) throw new Error('Signed release requires POS_UPDATE_PUBLISHER and POS_UPDATE_THUMBPRINTS');
if (feed) {
  const url = new URL(feed);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Release update feed must be HTTPS without credentials/query/fragment');
}
if (process.argv.slice(2).some(arg => /publish|config|forceCodeSigning|publisherName/i.test(arg))) throw new Error('Release signing/publishing configuration cannot be overridden through CLI arguments');
run(process.execPath, ['scripts/rebuild-native.mjs']);
run(process.execPath, [path.join(path.dirname(require.resolve('electron-vite/package.json')), 'bin/electron-vite.js'), 'build']);
if (!feed) console.log('POS_UPDATE_URL not set — building without an auto-update feed.');

run(process.execPath, [
  path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js'),
  '--win',
  ...process.argv.slice(2),
  '--config',
  'electron-builder.yml',
  '--publish', 'never',
  `--config.forceCodeSigning=${!unsignedAudit}`,
  ...(!unsignedAudit ? [`--config.win.publisherName=${publisher}`, `--config.win.signtoolOptions.certificateSha1=${pins[0]}`] : []),
  ...(feed ? [`--config.publish.provider=generic`, `--config.publish.url=${feed}`] : []),
]);
