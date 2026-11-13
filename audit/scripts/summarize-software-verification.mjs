import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '../..');
const evidence = path.resolve(root, process.argv[2]);
const read = name => JSON.parse(fs.readFileSync(path.join(evidence, name), 'utf8').replace(/^\uFEFF/, ''));
const suites = ['backend-tests', 'frontend-tests', 'desktop-tests', 'integration-tests'].map(name => {
  const log = fs.readFileSync(path.join(evidence, `${name}.log`), 'utf8');
  const summaries = [...log.matchAll(/^\s*Tests\s+(.*)$/gm)].map(match => match[1]);
  const count = status => summaries.reduce((sum, row) => sum + Number(row.match(new RegExp(`(\\d+) ${status}`))?.[1] ?? 0), 0);
  return { name, passed: count('passed'), failed: count('failed'), skipped: count('skipped'), todo: count('todo'), execution: read(`${name}.execution.json`) };
});
const dependencies = [];
for (const project of ['erp-backend', 'erp-frontend', 'pos-desktop']) {
  const require = createRequire(path.join(root, project, 'package.json'));
  for (const scope of ['production', 'all']) {
    const audit = read(`${project}-audit-${scope}.log`);
    dependencies.push({ project, scope, counts: audit.metadata.vulnerabilities,
      packages: Object.values(audit.vulnerabilities).map(item => {
        let installedVersion;
        try { installedVersion = require(`${item.name}/package.json`).version; } catch {}
        return { name: item.name, installedVersion, severity: item.severity, isDirect: item.isDirect, range: item.range, fixAvailable: item.fixAvailable,
          advisories: item.via.filter(via => typeof via === 'object').map(via => ({ title: via.title, url: via.url, severity: via.severity })) };
      }) });
  }
}
const acceptance = read('uat/results.json');
const apiProbePath = fs.existsSync(path.join(evidence, 'api-probes-verified/results.json')) ? 'api-probes-verified/results.json' : 'api-probes/results.json';
const apiProbes = read(apiProbePath);
const summary = {
  completedAt: new Date().toISOString(), timezone: 'Africa/Cairo', dockerUsed: false,
  suites, total: { passed: suites.reduce((sum, suite) => sum + suite.passed, 0), failed: suites.reduce((sum, suite) => sum + suite.failed, 0), skipped: suites.reduce((sum, suite) => sum + suite.skipped, 0), countsRepeatedWorkspaceExecutions: true },
  acceptance: { passed: acceptance.results.filter(item => item.status === 'passed').length, failed: acceptance.results.filter(item => item.status === 'failed').length, pageErrors: acceptance.pageErrors },
  screens: read('uat/screens.json'),
  apiProbes,
  compressedBodyProbe: read('body-parser-probe/results.json'),
  electronRuntime: read('runtime/results.json'), ipcRuntime: read('ipc-runtime/results.json'),
  dependencies, sourceIntegrity: read('source-integrity.json'), checks: read('verification-checks.json'),
  attempts: { apiProbes: [
    { path: 'api-probes/results.json', explanation: 'Harness used /inventory instead of the documented /inventory/levels route; four checks passed, load preflight failed.' },
    { path: 'api-probes-final/results.json', explanation: 'Harness dashboard request omitted mandatory from/to dates; four checks passed, load preflight failed.' },
    { path: 'api-probes-verified/results.json', explanation: 'Correct route and explicit from/to; all five checks passed.' },
  ].filter(attempt => fs.existsSync(path.join(evidence, attempt.path))) },
};
fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ total: summary.total, acceptance: summary.acceptance, screens: summary.screens.length, apiProbesPassed: apiProbes.filter(item => item.status === 'passed').length,
  dependencies: dependencies.map(({ project, scope, counts, packages }) => ({ project, scope, counts, packages: packages.map(({ name, installedVersion, severity }) => ({ name, installedVersion, severity })) })) }, null, 2));
