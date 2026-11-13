import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const report = path.join(root, 'audit/REPORT.md');
let text = fs.readFileSync(report, 'utf8');
text = text.replace(/## A\. Executive Summary[\s\S]*?(?=## B\.)/, `## A. Executive Summary

**Release recommendation: NOT READY.** The continuation repairs reproduced branch leaks, guards ambiguous financial reversals/refunds, preserves split tender and supplier allocations, persists offline refund history, and upgrades Electron to44.7.0 with better-sqlite3 13.0.3. Full reproduction/root-cause/file/test/risk records are in [PASS2.md](PASS2.md). The first-pass report and evidence remain at [previous report](evidence/pass2/previous-report.md).

Latest final verification: **707 passing executions** (backend297+shared23; frontend39+client5+POS100+shared23; desktop92+client5+POS100+shared23), zero failures/skips in completed final runners. Earlier failed reproductions and fixture/intermediate attempts are preserved separately. Package copies passed parity; type checking/lint passed in all three projects; API and desktop builds passed. These are executions, not distinct business scenarios; targeted reruns are excluded. Previous37 browser checks and400 loopback reads remain prior-pass evidence, not repeated new checks.

New acceptance includes two file-backed SQLite terminals using the actual API client/SyncWorker and a disposable Mongo API: offline conflicting sales, lost committed sale/return responses, duplicate retries, rejected sales/returns, stock reconciliation and restarts passed. BSON logical fixture backup/restore plus additive legacy-price acceptance and SQLite backup/schema3→4 restoration passed. Electron native SQL/encrypted/offline authentication/logout/PDF probes, mock-IPC renderer checkout/print/retry acceptance and unpacked Windows isolated smoke passed; six new real PDFs, no physical printing. Installer is unsigned; signed install/update acceptance remains open.

Business rules established by the user: explicit excess-refund method, supplier invoice uniqueness per supplier/company and proportional original purchase discount allocation. Initial-payment absence was disproved by pre-fix tests; no historical backfill was performed. Existing business data was read only (two products/no purchases); no production deployment, real charge, database reset, destructive migration or historical finance rewrite was performed. Current working-tree reorganization was preserved.

Release blockers remain explicit reimbursement/reversal/settlement workflows and historical reconciliation; IPC/navigation/auth matrix gaps; dev-tool critical/high advisories; authenticated release deployment/backup certification; signed installers/update distribution; required accounting scope and physical/provider acceptance. See [current verification](evidence/pass2/verification-summary.json) and [persistent checklist](CHECKLIST.md).

`);
text = text.replace('Electron 33.4.11, React, better-sqlite3', 'Electron 44.7.0, React, better-sqlite3 13.0.3');
text = text.replace(/## C\. Test Results\s*/, `## C. Test Results

**Current continuation totals supersede the first-pass table below:**707 passing executions; current per-runner counts/evidence are [PASS2.md](PASS2.md#current-verification) and [pass2 summary](evidence/pass2/verification-summary.json). The following baseline/final table records the preserved first pass (675), not the latest working tree.

`);
const statuses = {
  O01: ['P0', 'Reproduced customer/sync/supplier catalog and owned shared-customer summary leaks; API8/IPC5 and existing financial regressions passed', 'Safe contact projection, branch supplier balances and customer source-summary filtering repaired; full IPC/channel/historical matrix remains O09/O17. Details/evidence: PASS2.md#o01--branch-data-isolation-p0-repaired-in-tested-paths'],
  O03: ['P0', 'Paid credit cancellation deleted receipts; synthetic100/50 regression reproduced and now blocks409 without changing history/balance', 'Safe guard repaired in sales/service.ts; no receipt deletion. Full immutable reversal/settlement workflow still required. PASS2.md'],
  O04: ['P1', 'Read-only local DB:0purchases/no compound supplier-number index; concurrent cross-branch duplicate creates reproduced', 'API creates serialized per supplier and trimmed company-wide number checked;2regressions passed. Historical index migration deferred, no index applied. PASS2.md'],
  O05: ['P0', 'Excess customer credit/cash refunds, discounted/paid purchase returns and duplicate product rows reproduced with synthetic fixtures', 'Debt/tender bounds, proportional cumulative discounted return and ambiguous-row guards passed. Explicit mixed reimbursement UI/API and historical reconciliation remain. PASS2.md'],
  O06: ['P1', 'Initial customer/supplier tender records and statements passed before repair: original absence allegation disproved', 'Related split-tender method and autoallocated supplier statement defects reproduced/repaired; financial matrix10passed. Historical null purchase allocations and prepayments remain unverified. PASS2.md'],
  O07: ['P1', 'Three separate0.05 lines/0.01discount refunded0.15 and lost history on ack/restart; reproduced', 'SQLite schema4durable returns/invoice cap and branch authoritative reconciliation passed, including lost return response. Legacy unknown/rejected history blocked; presentation/backdated-delta acceptance remains. PASS2.md'],
  O08: ['P1', 'Actual API+two file-backed SQLite terminals tested conflict/lost responses/retries/returns/rejection/restart', 'Bounded two-terminal acceptance passed; rejected cash collection settlement UX and endurance/hardware remain open. PASS2.md'],
  O09: ['P1', 'Anonymous/prototype/foreign-record data IPC regressions passed through actual dispatcher helper', 'Partial repair only; sender/all-channel schema/permissions and external URL/navigation allowlists remain unverified source risks. PASS2.md'],
  O12: ['P1', 'Electron44.7.0/SQLite13.0.3 runtime/auth/PDF/unpacked package acceptance passed; full desktop audit23paths, omit-dev0', 'Shipped Electron advisory path removed; backend6/frontend14/desktop23dev-tool paths remain, including critical Vitest/tinypool. Compatible toolchain plan, signing/update acceptance still required. PASS2.md'],
  O13: ['P1', 'Docker daemon/mongodump/mongorestore unavailable; BSON fixture restore/SQLite restore and unsigned package smoke passed', 'Partial isolated acceptance only; authenticated release stack, production backup/PITR/RPO/RTO and signed installer/update acceptance remain. PASS2.md'],
  O14: ['P2', 'Missing price command restored as read-only plan; legacy spec/raw local schema inspected first;2current products unchanged', 'Plan unit/disposable migration acceptance passed. --applydisabled; representative historical backup/approval/apply/rollback still required. PASS2.md'],
  O17: ['P1', 'Configured DB aggregate/index reads completed without writes;2products/0purchases; synthetic restored hashes/balances passed', 'Representative historical orphan/precision/receipt/financial audit remains open. Local sample/logical backup is not production integrity certification. PASS2.md'],
};
text = text.split('\n').map(line => {
  const id = /^\| (O\d\d) \/ P\d \|/.exec(line)?.[1];
  if (!id || !statuses[id]) return line;
  const [priority, evidence, status] = statuses[id];
  return `| ${id} / ${priority} | Continuation: [PASS2.md](PASS2.md), preserved first evidence | ${evidence} | ${status} |`;
}).join('\n');
text = text.replace(/## H\. Remaining Work[\s\S]*$/, `## H. Remaining Work

1. P0: explicit customer/supplier reimbursement, paid cancellation/immutable reversal and rejected offline cash settlement; historical receipt reconciliation. O03/O05/O06/O07/O08.
2. P1: full IPC sender/channel/schema/navigation and authentication refresh/revocation acceptance. O09/O10.
3. P1: compatible vulnerable dev-tool upgrades, signed installers and trusted update distribution/install/restart. O12/O13.
4. P1: isolated authenticated Docker deployment, actual production backup restoration, representative historical integrity and approved migration/index plan. O04/O13/O14/O17.
5. P1/P2: required accounting scope, timezone policy, physical/provider/accessibility/large-catalog/endurance thresholds and acceptance. O02/O11/O15/O18; QR harness warning debt O16.

Detailed priorities and limits: [PASS2.md](PASS2.md#prioritized-remaining-release-work). Existing checklist/backlog IDs are retained. Infrastructure-unavailable items remain open, not silently skipped or declared successful.

## I. Final Release Recommendation

**NOT READY.**707passing executions, runtime/package evidence, actual two-terminal sync and synthetic backup/restore materially reduce risk. Explicit financial settlement/history, trusted IPC/navigation, dev-tool advisories, authenticated staging and signed release/update/hardware acceptance remain required. No production release is recommended.
`);
fs.writeFileSync(report, text);
const checklist = path.join(root, 'audit/CHECKLIST.md');
let checks = fs.readFileSync(checklist, 'utf8');
checks = checks.replace('- [ ] Resolve customer/sync and supplier catalog financial sharing (O01).', '- [x] Repair/test bounded customer/sync/supplier projection and branch-summary sharing (O01); full IPC/historical matrix remains open.');
checks = checks.replace('- [ ] Define supplier invoice uniqueness and missing price migration (O04/O14).', '- [x] Establish supplier/company uniqueness, inspect local schemas read-only, guard API duplicates and restore read-only price plan (O04/O14); historical index/apply remains open.');
checks += `
## Continuation verification and evidence

- [x] Apply user-approved explicit refund/company invoice uniqueness/proportional purchase-discount rules.
- [x] Reproduce customer/sync/supplier leaks and repair API projection/cache/IPC/financial writes; API8/IPC5 regressions.
- [x] Reproduce paid credit cancellation/excess refund/purchase discount/split tender/autoallocated supplier receipt/ambiguous purchase-line defects; financial10regressions.
- [x] Correct O06initial-payment allegation: pre-fix initial receipt/statement checks passed; no backfill performed.
- [x] Persist SQLite refund history with additive schema4, cumulative cap and authoritative sync/restart checks.
- [x] Run real two-terminal file-backed SQLite↔API acceptance with lost committed sale/return responses, duplicate retry, rejection, return, conflict and restart.
- [x] Upgrade Electron44.7.0/SQLite13.0.3/updater6.8.9/builder26.15.3; native Node-API validation and real runtime/auth/PDF checks.
- [x] Build unpacked Windows with --publishnever; smoke using isolated profile; record unsigned status and virtual printers.
- [x] Execute renderer/mock-IPC checkout/retry/cancellation and five new real PDFs after fixing Electron capture harness.
- [x] Execute BSON logical fixture restore/hash/index/balance and disposable additive legacy-price acceptance; SQLite online backup/schema3→4integrity check.
- [x] Read configured local DB aggregate/index shapes only:2products/0purchases; historical scope limitation recorded.
- [x] Complete707passing project executions, three-project typecheck/lint, API/desktop builds and package parity; preserve failed/intermediate logs.
- [x] Preserve previous report/summary and update current report, finding evidence and machine-readable counts.
- [ ] Complete explicit mixed/supplier reimbursements, immutable reversals and rejected offline cash settlement with historical allocations.
- [ ] Close dev-tool critical/high advisories and certify signed NSIS/portable installation/update lifecycle.
- [ ] Execute authenticated release Docker/mongodump/PITR/restoration/RPO/RTO and representative historical reconciliation when infrastructure is available.

Current detailed evidence: [PASS2.md](PASS2.md), [verification-summary.json](evidence/pass2/verification-summary.json). Earlier675totals above remain the first-pass record. Current release recommendation remains NOT READY.
`;
fs.writeFileSync(checklist, checks);
console.log('Persistent report/checklist updated; first-pass evidence preserved.');
