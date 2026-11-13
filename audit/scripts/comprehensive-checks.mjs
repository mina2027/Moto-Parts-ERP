import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const evidence = path.resolve(root, process.argv[2]);
fs.mkdirSync(evidence, { recursive: true });
const checks = [
  ['backend-tests', 'erp-backend', 'test'],
  ['frontend-tests', 'erp-frontend', 'test'],
  ['desktop-tests', 'pos-desktop', 'test'],
  ['integration-tests', 'erp-backend', 'test:integration'],
];
const runCheck = ([name, project, script]) => new Promise(resolve => {
  const startedAt = new Date().toISOString();
  const stream = fs.createWriteStream(path.join(evidence, `${name}.log`));
  const child = spawn('npm.cmd', ['run', script], { cwd: path.join(root, project), shell: true, env: { ...process.env, NO_COLOR: '1' } });
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream, { end: false });
  child.on('error', error => stream.write(String(error)));
  child.on('close', code => {
    stream.end();
    const result = { name, project, command: `npm run ${script}`, startedAt, finishedAt: new Date().toISOString(), exitCode: code };
    fs.writeFileSync(path.join(evidence, `${name}.execution.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    resolve(result);
  });
});
// Both backend groups start MongoDB instances; run them separately to avoid startup contention.
const results = await Promise.all(checks.slice(0, 3).map(runCheck));
results.push(await runCheck(checks[3]));
fs.writeFileSync(path.join(evidence, 'checks.json'), JSON.stringify(results, null, 2));
if (results.some(result => result.exitCode !== 0)) process.exitCode = 1;
