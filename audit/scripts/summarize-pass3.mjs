import { auditPath, evidenceFiles } from './layout.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '../..');
const evidence = path.join(root, 'audit/evidence/pass3');
const read = file => {
  const bytes = fs.readFileSync(auditPath(path.relative(path.join(root, 'audit'), path.join(evidence, file))));
  return bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
};
const tests = [
  ['backend', 'backend-tests.log', [297, 23]],
  ['frontend', 'frontend-tests.log', [39, 5, 100, 23]],
  ['desktop', 'desktop-tests.log', [104, 5, 100, 23]],
].map(([project, log, expected]) => {
  const text = read(log);
  const counts = [...text.matchAll(/^\s*Tests\s+(\d+) passed \((\d+)\)/gm)].map(m => Number(m[1]));
  if (JSON.stringify(counts) !== JSON.stringify(expected) || /Tests[^\r\n]*(?:failed|skipped)|FAIL\s/.test(text)) throw new Error(`Incomplete or failed runner ${log}: ${counts}`);
  return { project, log: `pass3/${log}`, counts, passed: counts.reduce((a, b) => a + b, 0), failed: 0, skipped: 0 };
});
const ipc = JSON.parse(read('ipc-runtime/results.json'));
const runtime = JSON.parse(read('runtime/results.json'));
const renderer = JSON.parse(read('renderer/results.json'));
const codes = JSON.parse(read('execution-results.json'));
if (!ipc.passed || !runtime.passed || !renderer.passed || !read('packaged-smoke.log').includes('"smoke":"ok"')) throw new Error('Electron acceptance incomplete');
if (Object.values(codes.finalRunnerExitCodes).some(code => code !== 0)) throw new Error('Runner did not exit successfully');
const dependencies = ['backend', 'frontend', 'desktop'].map(project => ({ project, full: JSON.parse(read(`${project}-audit.json`)).metadata.vulnerabilities, omitDev: JSON.parse(read(`${project}-audit-runtime.json`)).metadata.vulnerabilities }));
const files = evidenceFiles('pass3').map(({ file, source }) => ({ file, sha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex') }));
const result = {
  at: new Date().toISOString(), previousPassExecutions: 707, tests,
  totalPassingExecutions: tests.reduce((sum, run) => sum + run.passed, 0),
  countedAs: 'Latest complete project runners, including shared-copy executions; targeted reruns and Electron scenario checks excluded',
  electron: { version: runtime.electron, sqlitePackage: runtime.nativePackage, sqliteVersion: runtime.sqlite, ipcChecks: ipc.checks.length, runtimePassed: true, rendererScenarioPassed: true, realPdfs: renderer.jobs.length + 1, physicalPrints: 0, packagedSmoke: true, signature: 'NotSigned' },
  dependencies, executionResults: codes, releaseRecommendation: 'NOT READY',
  unresolvedRisks: ['Explicit mixed/supplier reimbursement and immutable cancellation/settlement workflows', 'Representative historical reconciliation', 'Offline auth revocation/refresh/lock acceptance', 'Remaining Tailwind/build-tool advisories', 'Signed installer/update and authenticated release/backup acceptance', 'Physical printers/drawer/scanner, providers and endurance acceptance'],
  priorEvidence: 'pass2/verification-summary.json', evidenceFiles: files,
};
fs.writeFileSync(path.join(evidence, 'verification-summary.json'), JSON.stringify(result, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'audit/evidence/verification-summary.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ total: result.totalPassingExecutions, tests, dependencies, release: result.releaseRecommendation }));
