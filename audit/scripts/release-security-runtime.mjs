import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..'), desktop = path.join(root, 'pos-desktop');
const require = createRequire(path.join(desktop, 'package.json')), target = path.join(root, 'audit/evidence/release-closure/security-runtime');
mkdirSync(target, { recursive: true });
const entry = `
const { app, BrowserWindow } = require('electron'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http');
const { LocalDb } = require('./src/main/db/database.ts'); const { archiveTerminal } = require('./src/main/db/archive.ts');
const { invoicePdf } = require('./src/main/printing.ts'); const { verifyPinnedExecutable } = require('./src/main/updatePolicy.ts');
const target = ${JSON.stringify(target)}; app.setPath('userData', path.join(target, 'profile'));
app.whenReady().then(async () => {
 let db, win, server; const result = { passed: false, installExecuted: false, physicalPrinting: false };
 try {
   let remoteRequests = 0; server = http.createServer((_req, res) => { remoteRequests++; res.end('unexpected'); });
   await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port;
   db = new LocalDb(path.join(target, 'terminal.sqlite'));
   db.db.prepare('INSERT OR REPLACE INTO rejected_settlements VALUES (?, ?, ?)').run('synthetic-op', 'synthetic-sale', JSON.stringify({ payoutAmount: 50, reference: 'fixture-refund' }));
   const archive = await archiveTerminal(db, path.join(target, 'archives')); assert.equal(archive.settlements.length, 1); assert.equal(archive.integrity, 'ok');
   win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
   const pdf = await invoicePdf(win, { html: '<div dir="rtl">فاتورة اختبار SYNTHETIC</div><script>window.printAttack=true;fetch("http://127.0.0.1:' + port + '/script")</script><img src="http://127.0.0.1:' + port + '/image"><iframe src="http://127.0.0.1:' + port + '/frame"></iframe>', widthMm: 80, heightMm: null, silent: false, copies: 1 });
   assert.equal(await win.webContents.executeJavaScript('window.printAttack === true'), false); assert.equal(remoteRequests, 0); assert.equal(pdf.subarray(0,4).toString(), '%PDF'); fs.writeFileSync(path.join(target, 'secured-receipt.pdf'), pdf);
   await assert.rejects(() => verifyPinnedExecutable(process.execPath, ['A'.repeat(40)]), /UNTRUSTED_UPDATE_SIGNATURE/);
   result.passed = true; result.electron = process.versions.electron; result.nativeArchive = { sha256: archive.sha256, integrity: archive.integrity }; result.csp = { scriptExecuted: false, remoteRequests, pdfBytes: pdf.length }; result.signature = 'actual unsigned/mismatched executable rejected by Windows Authenticode verifier';
 } catch(error) { result.error = error.message; console.error(error); }
 finally { win?.destroy(); db?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); fs.writeFileSync(path.join(target, 'results.json'), JSON.stringify(result,null,2)); console.log(JSON.stringify(result)); app.exit(result.passed ? 0 : 1); }
});
`;
const output = path.join(desktop, 'release/release-security-runtime/entry.cjs'); mkdirSync(path.dirname(output), { recursive: true });
await require('esbuild').build({ stdin: { contents: entry, resolveDir: desktop, sourcefile: 'release-security-runtime.cjs' }, outfile: output, bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'better-sqlite3'], nodePaths: [path.join(desktop, 'node_modules')] });
const env = { ...process.env, NODE_PATH: path.join(desktop, 'node_modules') }; delete env.ELECTRON_RUN_AS_NODE;
const executed = spawnSync(path.join(desktop, 'node_modules/electron/dist/electron.exe'), [output], { cwd: desktop, env, windowsHide: true, stdio: 'inherit', timeout: 60000 });
if (executed.error) console.error(executed.error); process.exit(executed.status ?? 1);
