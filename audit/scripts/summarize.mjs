import { auditPath } from './layout.mjs';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const evidence = path.join(root, 'audit/evidence');
function read(file) {
  const bytes = fs.readFileSync(auditPath(path.relative(path.join(root, 'audit'), path.join(evidence, file))));
  return bytes.subarray(0, 2).equals(Buffer.from([255, 254])) ? bytes.toString('utf16le').replace(/^\uFEFF/, '') : bytes.toString('utf8').replace(/^\uFEFF/, '');
}
const prior = read('interrupted-verification.log');
const backendEnd = prior.indexOf('=== erp-frontend:');
if (backendEnd < 0) throw new Error('Missing completed backend group');
const finalLog = [prior.slice(0, backendEnd), '=== erp-frontend: completed single-worker main rerun and workspace runners ===\n', read('final-frontend-main.log'), read('final-frontend-packages.log'), '=== pos-desktop: completed single-worker main rerun and workspace runners ===\n', read('final-desktop-main.log'), read('final-desktop-packages.log')].join('\n');
fs.writeFileSync(path.join(evidence, 'final-tests.log'), finalLog);
const groups = [...finalLog.matchAll(/Tests\s+(\d+) passed \((\d+)\)/g)].map(match => Number(match[1]));
if (groups.length !== 10 || /Tests.*failed|FAIL\s/.test(read('final-tests.log'))) throw new Error('Final test log is incomplete or contains failures');
const browser = JSON.parse(read('browser-results.json'));
const checkout = JSON.parse(read('browser-checkout.json'));
const summary = {
  auditDate: '2026-10-12', timezone: 'Africa/Cairo', releaseRecommendation: 'NOT READY',
  baselineTestExecutions: 628,
  finalTests: { total: groups.reduce((a, b) => a + b, 0), passed: groups.reduce((a, b) => a + b, 0), failed: 0, skipped: 0, groups, caveat: 'Shared-package copies are repeated executions; suite totals mix unit, component and integration cases.' },
  browserChecks: { total: browser.results.length + checkout.length, passed: browser.results.filter(r => r.status === 'passed').length + checkout.filter(r => r.status === 'passed').length, pageErrors: browser.pageErrors.length },
  electron: { scenarios: 1, passed: true, verification: 'Real Electron PDF output and production renderer with mock IPC. No physical printer or live backend checkout.' },
  performance: JSON.parse(read('performance.json')),
  dependencies: Object.fromEntries(['backend', 'frontend', 'desktop'].map(project => [project, JSON.parse(read(`${project}-dependencies.json`)).metadata.vulnerabilities])),
  checks: { tests: 0, typecheck: 0, lint: 0, apiWebBuild: 0, desktopBuild: 0, packageParity: 0, composeSyntax: 0 },
  checkExitCodeNote: 'Completed backend and rerun frontend/desktop runners exited 0. Interrupted root attempt failed worker module collection and is retained separately. Final log combines completed runners; build/check exits observed by audit agent.',
  coverage: 'Not measured; no coverage-provider package installed.',
};
fs.writeFileSync(path.join(evidence, 'verification-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ tests: summary.finalTests, browser: summary.browserChecks }));
