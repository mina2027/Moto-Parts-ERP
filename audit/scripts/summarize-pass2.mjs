import { auditPath, evidenceFiles } from './layout.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '../..');
const evidence = path.join(root, 'audit/evidence/pass2');
const read = file => {
  const bytes = fs.readFileSync(auditPath(path.relative(path.join(root, 'audit'), path.join(evidence, file))));
  return (bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString('utf16le') : bytes.toString('utf8')).replace(/^\uFEFF/, '');
};
const runs = [
  ['backend', 'backend-final-tests-complete.log', [297, 23]],
  ['frontend', 'frontend-final-tests.log', [39, 5, 100, 23]],
  ['desktop', 'desktop-final-tests.log', [92, 5, 100, 23]],
];
const tests = runs.map(([project, log, expected]) => {
  const text = read(log);
  const counts = [...text.matchAll(/^\s*Tests\s+(\d+) passed \((\d+)\)/gm)].map(m => Number(m[1]));
  if (JSON.stringify(counts) !== JSON.stringify(expected) || /Tests[^\r\n]*(?:failed|skipped)|FAIL\s/.test(text)) throw new Error(`Incomplete or failed verification: ${log}: ${counts}`);
  return { project, log, counts, passed: counts.reduce((a, b) => a + b, 0), failed: 0, skipped: 0 };
});
const runtime = JSON.parse(read('runtime/results.json'));
const renderer = JSON.parse(read('renderer/results.json'));
if (!runtime.passed || !renderer.passed) throw new Error('Electron acceptance incomplete');
const dependencies = ['backend', 'frontend', 'desktop'].map(project => ({ project, full: JSON.parse(read(`${project}-audit.json`)).metadata.vulnerabilities, omitDev: JSON.parse(read(`${project}-audit-runtime.json`)).metadata.vulnerabilities }));
const files = evidenceFiles('pass2').map(({ file, source }) => ({ file, sha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex') }));
const result = { at: new Date().toISOString(), previousPassExecutions: 675, tests, totalPassingExecutions: tests.reduce((sum, run) => sum + run.passed, 0), countedAs: 'Latest complete project runners; shared copies count as executions, targeted reruns excluded', electron: { version: runtime.electron, sqlitePackage: runtime.nativePackage, sqliteVersion: runtime.sqlite, runtimePassed: true, rendererScenarioPassed: true, realPdfs: renderer.jobs.length + 1, physicalPrints: 0, packagedSmoke: fs.readFileSync(path.join(evidence, 'packaged-smoke.log'), 'utf8').includes('"smoke":"ok"') }, dependencies, releaseRecommendation: 'NOT READY', unavailable: ['Docker daemon', 'mongodump/mongorestore', 'authenticated isolated deployment', 'signed installer/update distribution', 'physical printers/drawer/scanner', 'production historical dataset'], evidenceFiles: files };
fs.writeFileSync(path.join(evidence, 'verification-summary.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ total: result.totalPassingExecutions, tests, release: result.releaseRecommendation }));
