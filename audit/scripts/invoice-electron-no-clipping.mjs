import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const desktop = path.join(root, 'pos-desktop');
const evidence = path.join(root, 'audit/evidence/invoice-exact-size');
const temp = path.join(os.tmpdir(), 'moto-print-check');
const require = createRequire(path.join(desktop, 'package.json'));
const cases = ['thermal80', 'a4'].flatMap(paper => ['short', 'many', 'long-fields'].map(kind => ({ paper, kind })));
const entry = `
  const { app, BrowserWindow } = require('electron');
  const fs = require('node:fs');
  const path = require('node:path');
  const { invoicePdf } = require('./src/main/printing.ts');
  const evidence = ${JSON.stringify(evidence)};
  app.setPath('userData', ${JSON.stringify(path.join(temp, 'electron-profile'))});
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    try {
      for (const { paper, kind } of ${JSON.stringify(cases)}) {
        const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
        try {
          const name = paper + '-' + kind;
          const html = fs.readFileSync(path.join(evidence, name + '.html'), 'utf8');
          const pdf = await invoicePdf(win, { html, widthMm: paper === 'a4' ? 210 : 80, heightMm: paper === 'a4' ? 297 : null, copies: 1, silent: false });
          fs.writeFileSync(path.join(evidence, 'electron-' + name + '.pdf'), pdf);

        } finally { win.destroy(); }
      }
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
`;
const outfile = path.join(temp, 'invoice-runtime.cjs');
await require('esbuild').build({ stdin: { contents: entry, resolveDir: desktop }, outfile, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const execution = spawnSync(path.join(desktop, 'node_modules/electron/dist/electron.exe'), [outfile], { env, windowsHide: true, stdio: 'inherit', timeout: 60000 });
assert.equal(execution.status, 0, execution.error?.message ?? 'Electron verification failed');

const { getDocument } = await import(pathToFileURL(path.join(temp, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
const results = [];
for (const { paper, kind } of cases) {
  const count = kind === 'short' ? 1 : kind === 'many' ? 75 : 8;
  const parsed = await getDocument({ data: new Uint8Array(fs.readFileSync(path.join(evidence, 'electron-' + paper + '-' + kind + '.pdf'))), useSystemFonts: true }).promise;
  let text = '';
  for (let n = 1; n <= parsed.numPages; n++) {
    const page = await parsed.getPage(n);
    const widthMm = page.view[2] * 25.4 / 72;
    const heightMm = page.view[3] * 25.4 / 72;
    assert(Math.abs(widthMm - (paper === 'a4' ? 210 : 80)) < 0.2, 'Electron PDF width mismatch');
    if (paper === 'a4') assert(Math.abs(heightMm - 297) < 0.2, 'Electron A4 height mismatch');
    const items = (await page.getTextContent()).items;
    text += items.map(item => item.str ?? '').join('');
    for (const item of items) {
      if (!item.str?.trim()) continue;
      assert(item.transform[4] >= -1 && item.transform[4] + item.width <= page.view[2] + 1, 'Text outside PDF width');
      assert(item.transform[5] >= -1 && item.transform[5] <= page.view[3] + 1, 'Text outside PDF height');
    }
  }
  text = text.replace(/\s/g, '');
  for (let i = 0; i < count; i++) {
    assert(text.includes('ROW' + String(i).padStart(4, '0')), 'Missing item ' + i);
    if (kind === 'long-fields') {
      assert(text.includes('NAME_END' + i), 'Clipped item name');
      assert(text.includes('NOTE_END' + i), 'Clipped item note');
      if (paper === 'a4') assert(text.includes('SKU_END' + i), 'Clipped SKU');
    }
  }
  assert(text.includes('END_OF_INVOICE'), 'Missing invoice footer');
  if (paper === 'thermal80' || kind === 'short') assert.equal(parsed.numPages, 1);
  if (paper === 'a4' && kind === 'many') assert(parsed.numPages > 1);
  results.push({ paper, kind, items: count, pages: parsed.numPages, complete: true });
  console.log(JSON.stringify(results.at(-1)));
  await parsed.cleanup();
}
fs.writeFileSync(path.join(evidence, 'electron-results.json'), JSON.stringify(results, null, 2));
