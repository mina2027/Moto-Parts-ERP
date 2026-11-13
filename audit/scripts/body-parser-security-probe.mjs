import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '../..');
const evidence = path.resolve(root, process.argv[2]);
fs.mkdirSync(evidence, { recursive: true });
const results = [];
function send(port, encoding, frame, suffix, delay) {
  return new Promise(resolve => {
    let status;
    const request = http.request({ hostname: '127.0.0.1', port, path: '/api/health/live', method: 'GET', headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding, 'Transfer-Encoding': 'chunked' } }, response => {
      status = response.statusCode; response.resume(); response.on('end', () => resolve({ status }));
    });
    request.on('error', error => resolve({ status, error: error.message }));
    request.setTimeout(2000, () => request.destroy(new Error('probe request timeout')));
    request.write(frame);
    setTimeout(() => { if (!request.destroyed) request.end(suffix); }, delay);
  });
}
for (const [encoding, compress] of [['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync], ['br', zlib.brotliCompressSync]]) {
  for (const delay of [0, 100]) {
    let stdout = '', stderr = '', closed = false, exitCode, signal, intentionalStop = false;
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'audit/scripts/body-parser-probe-server.ts')], { cwd: path.join(root, 'erp-backend'), windowsHide: true });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Isolated server startup timed out')); }, 8000);
      child.stdout.on('data', data => { stdout += data; const match = stdout.match(/\{"port":(\d+)\}/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
      child.stderr.on('data', data => { stderr += data; });
      child.on('error', reject);
      child.on('close', (code, sig) => { closed = true; exitCode = code; signal = sig; clearTimeout(timer); if (!stdout.match(/\{"port":(\d+)\}/)) reject(new Error(stderr)); });
    });
    const frame = compress(Buffer.from('{}'));
    const baseline = await send(port, encoding, frame, Buffer.alloc(0), 0);
    const malformed = await send(port, encoding, frame, Buffer.from('trailing-non-frame-bytes'), delay);
    await new Promise(resolve => setTimeout(resolve, 350));
    const crashed = closed;
    if (!closed) { intentionalStop = true; child.kill(); await new Promise(resolve => child.once('close', resolve)); }
    const name = `${encoding}-${delay}ms`;
    fs.writeFileSync(path.join(evidence, `${name}.log`), stdout + '\n' + stderr);
    const result = { name, encoding, delayMs: delay, baseline, malformed, crashed, exitCode, signal, intentionalStop, databaseAccessed: false };
    results.push(result); console.log(JSON.stringify(result));
  }
}
fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
if (results.some(result => result.crashed || result.baseline.status !== 200)) process.exitCode = 1;
