// Shared audit reports combine evidence from all projects. Backend artifacts live with the API.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');

export function auditPath(relative) {
  const backend = path.join(root, 'erp-backend/audit', relative);
  return fs.existsSync(backend) ? backend : path.join(root, 'audit', relative);
}

export function snapshotFiles(phase) {
  const walk = (dir, base = dir) => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file, base) : [{ before: file, relative: path.relative(base, file) }];
  });
  return [
    ...walk(path.join(root, 'audit', phase)),
    ...walk(path.join(root, 'erp-backend/audit', phase)).map(entry => ({ ...entry, relative: path.join('erp-backend', entry.relative) })),
  ];
}

export function evidenceFiles(phase = '') {
  const relative = path.join('evidence', phase);
  const directories = [path.join(root, 'audit', relative), path.join(root, 'erp-backend/audit', relative)];
  const names = new Set(directories.flatMap(dir => !fs.existsSync(dir) ? [] : fs.readdirSync(dir).filter(name => fs.statSync(path.join(dir, name)).isFile())));
  return [...names].sort().filter(name => name !== 'verification-summary.json').map(name => ({ file: name, source: auditPath(path.join(relative, name)) }));
}
