# ERP + POS audit continuation — 2026-10-12

**Release recommendation: NOT READY.** This pass repairs reproduced branch and financial defects, upgrades the shipped desktop runtime, and adds real two-terminal acceptance. It does not authorize a production release or certify historical financial data. All prior work and evidence remain under `evidence/`; the original report is preserved at `evidence/pass2/previous-report.md`.

Latest continuation: [PASS3.md](PASS3.md), 719 passing executions and additional IPC/toolchain evidence. Counts and statuses below preserve pass2.

## Scope and approved business rules

The three independent projects and the user's existing uncommitted reorganization were preserved. Existing business databases were inspected read-only. All financial writes, restores and migration experiments used disposable fixtures. No production deployment, real payment, customer message, historical financial rewrite, existing-database reset, destructive migration or historical uniqueness index was executed.

The user established these rules:

- Refund value beyond outstanding debt requires an explicit refund method. Ambiguous excess is blocked, rather than converted into implicit customer/supplier credit.
- Supplier invoice numbers are unique per supplier across the company. Empty numbers remain optional; surrounding whitespace is normalized. Case remains significant; no fiscal-period exception was inferred.
- Purchase returns include the proportional original invoice discount. Cumulative rounding ensures a complete undiscounted-quantity return reverses the original discounted total.

Foreign retail customers are private to their branch. Foreign non-retail contacts can be selected for cash sales, with only identity/contact/type/status fields shared. The projection clears address, notes, balance and credit limit and explicitly marks `financialRestricted`. Financial writes and special prices remain within the customer account's branch, including desktop POS even when an ERP administrator has broader access.

## Current verification

Latest completed project totals are recorded by `evidence/pass2/verification-summary.json`; it refuses incomplete, failed or skipped runner output. Targeted reproductions and reruns are excluded from the final total. Shared packages run separately in each copy; totals describe executions, not distinct business scenarios.

| Runner | Latest passed executions |
|---|---:|
| Backend main | 297 |
| Backend shared | 23 |
| Frontend main / API client / POS core / shared | 39 / 5 / 100 / 23 |
| Desktop main / API client / POS core / shared | 92 / 5 / 100 / 23 |
| **Total** | **707** |

Previous completed pass: **675**. Failed pre-fix reproductions, faulty fixture attempts and intermediate verification failures remain recorded separately. The previous browser/performance coverage was retained, not repeated. Latest type checks and lint passed in all projects; backend and desktop builds passed. Shared-copy parity passed. No new frontend implementation changed beyond mirrored shared contracts; its build evidence remains from the preceding pass.

Electron 44.7.0 ran with better-sqlite3 13.0.3 / SQLite 3.53.4. The real-runtime probe verified native SQL, OS encryption, synthetic online login, offline login, wrong password, logout data access, a real PDF and updater feed configuration/unpackaged skip. The renderer verification used mocked IPC, exercised checkout/retry/cancellation and generated five actual PDFs. This is six new PDF artifacts, no physical printing. A Windows unpacked app was built with `--publish never`; its native SQLite smoke passed with an isolated profile. `Get-AuthenticodeSignature` reports **NotSigned**. NSIS/portable installation and signed update download/install remain unverified.

The renderer initially failed with `UnknownVizError` during screenshot capture after the Electron upgrade. The harness now keeps hidden captures awake and disables native-window occlusion rather than forcing GPU off. It subsequently passed; failed attempts are preserved. Electron 44 removed `PrinterInfo.isDefault`; Windows CIM now resolves the default printer. Available devices remain virtual OneNote and Microsoft Print to PDF.

## Findings and evidence

### O01 — branch data isolation, P0: repaired in tested paths

Reproduction: log in as br-1 manager `khaled.m`; read a synthetic br-2 retail customer directly, read a wholesale customer/all contacts/special prices, request sync bootstrap/delta, and list/read supplier `sup-1` after creating a foreign purchase. Pre-pass routes failed five cases with actual financial disclosure. A further owned wholesale customer's summary included a foreign cash sale (100) although its branch had no invoices. Evidence: `reproduced-branch-projection.log`, `reproduced-owned-customer-summary.log`.

Cause: catalog endpoints and snapshots exposed full account documents or global supplier balances; summary service checked customer ownership but did not scope source sales. Repairs: shared `customerProjection.ts`/types; backend customers routes/service, sales service, purchases routes and sync routes; desktop database, local operations, `dataAccess.ts` and the actual IPC dispatcher. Supplier balances and balance filters use branch purchases; customer summary/statement source records are scoped. Cached foreign rows/prices are scrubbed on delta pulls, including rows omitted by safer servers. Desktop credit sales/receipts reject restricted contacts. Anonymous reads and inherited method names are rejected before handler execution. Regression: backend `branch-projection.test.ts` (8), desktop `dataAccess.test.ts` (5), existing financial branch/report regressions. Latest runs passed.

Risk: full IPC sender/channel/schema security remains O09. All-branch ERP read access is intentionally retained. This does not certify every catalog/mutation endpoint or historical cross-branch debt assignment.

### O03 — credit cancellation history, P0: safe guard repaired; reversal workflow remains

Reproduction: create a credit invoice 100 with initial cash 50, then cancel. Previously HTTP 200 deleted the customer payment; the new regression expects HTTP 409 with records, invoice and balance unchanged. Evidence: `reproduced-financial-matrix.log`.

Cause: cancellation deleted linked receipt documents before reversing debt. `sales/service.ts` now refuses paid/receipt-bearing credit cancellations with `PAYMENT_RECONCILIATION_REQUIRED` and removes receipt deletion. Unpaid credit cancellation and cash cancellation retain existing tested behavior. `financial-followup.test.ts`, existing `sales.test.ts` and source-balance checks passed. The old sales tests selected arbitrary foreign wholesale customers; fixtures now choose br-1 customers. Their cash-return case now includes actual paid tender (60).

Risk: a full immutable reversal and multi-invoice receipt allocation workflow is still absent. Historical linked receipts were not rewritten; operator reconciliation is required for paid cancellation.

### O04 — duplicate supplier invoice, P1: new API writes guarded; historical constraint deferred

Read-only discovery preceded implementation: configured database contains 0 purchases; supplier invoice uniqueness index is absent. No historical duplicate invoices were present in this local database, which is not representative of other installations. `historical-readonly.json` contains aggregate counts/index shapes only.

Reproduction: two concurrent API creates for the same supplier/number from br-1 and br-2 previously both returned 201. `reproduced-supplier-invoice.log`. `purchases/routes.ts` now trims the number, serializes creates by incrementing a supplier guard within the transaction and checks existing trimmed numbers company-wide. No index migration was run. `supplier-invoice-uniqueness.test.ts` (2) verifies exactly one 201, one 409, another supplier allowed and empty numbers allowed; passed.

Risk: enforcement covers this API create path on a replica set. Direct database/import writers bypass it. A partial compound unique index remains a proposal requiring a complete read-only duplicate/orphan audit, backup and explicit migration approval. Standalone databases cannot provide the same concurrency guarantee; production already requires transactions.

### O05 — refund/discount policy, P0: verified guards and arithmetic; reimbursement workflow remains

Reproductions in `financial-followup.test.ts`: credit invoice 100/paid50 with credit refund100, unpaid credit invoice with cash refund100, paid supplier purchase with full return, and three returns against 0.15 purchase discounted by0.01. Formerly accepted ambiguous excess and refunded0.15 instead of0.14. A purchase with duplicate product rows at costs10 and20 could select the first row ambiguously. Evidence: `reproduced-financial-matrix.log`, `reproduced-purchase-duplicate-lines.log`.

`sales/service.ts` now checks debt reduction against remaining debt and cash/card/bank payouts against paid tender minus earlier payouts, before stock/documents persist. Desktop local operations mirror these bounds. `purchases/routes.ts` allocates discount proportionally and subtracts rounded cumulative entitlement; expected partial totals are0.05/0.04/0.05. Returns requiring supplier reimbursement return409 until an explicit workflow exists. Duplicate historical product rows return `RETURN_LINE_RECONCILIATION_REQUIRED`, avoiding ambiguous source-cost selection. Stock, documents, balances and supplier statements reconcile in the regression matrix (10 cases); passed.

Risk: mixed debt-reduction plus payout within one return is not implemented; split the business operation only through a reviewed explicit workflow. Supplier cash/bank reimbursement UI/API, receipt reversals and journal postings remain absent. Existing malformed/negative payable history was not repaired. Fractional return item costs retain precision while document totals round to cents; no new global money-storage migration was introduced.

### O06 — initial payment statements, P1: original allegation disproved; related defects repaired

The original source-only allegation was incorrect: initial customer credit tender and initial supplier payment already created receipt documents. Synthetic 100/50 initial-payment statement tests passed before repair. Evidence: `reproduced-financial-followup.log` and `reproduced-financial-matrix.log`. No initial-payment backfill or financial history rewrite was made.

Related confirmed defects: initial split tender cash 20/card 30 was recorded as one cash 50 receipt; `sales/service.ts` now writes each paid tender method, ordered within the transaction. An automatically allocated supplier receipt with null purchaseId disappeared from a branch statement, although payable was reduced. A deterministic isolated supplier reproduction confirms the missing line in `reproduced-supplier-auto-statement.log`; `purchases/routes.ts` now stores per-purchase receipt allocations with the shared reference. One explicitly selected purchase still creates one receipt. `financial-followup.test.ts` reconciles statement/source balances and methods; passed.

Risk: historical null-purchase supplier receipts cannot be assigned retrospectively without reviewed allocation evidence. Existing prepayments, general customer-credit allocation and multi-invoice receipt presentation remain outside completed certification. No old receipts were duplicated or rewritten.

### O07 — offline refund history, P1: durable history/cap/reconciliation repaired

Reproduction: sell three separate0.05 lines with0.01 invoice discount, return each, acknowledge/remove outbox entries and reopen file-backed SQLite. Previously refunded0.15 and retained no separate durable return document. `reproduced-offline-refund.log`.

Desktop schema 4 adds `sale_returns` and a unique server-id index; migration is additive. `database.ts` persists local documents, status and server mapping through acknowledgements/retries/restart and merges branch-scoped authoritative refund documents/source invoices. Shared sync contracts and backend `sync/routes.ts` expose this bounded history. `localOps.ts` caps invoice-wide total, refuses failed/rejected/legacy unknown-history returns and writes refund history plus outbox atomically. `refundHistory.test.ts`, SQLite restore test and the real two-terminal case passed. The two-terminal test also drops the return response after server commit and confirms one durable server return after restart/duplicate retry.

Risk: old installations whose acknowledged return operations were deleted lack trustworthy historical local refund totals; further returns are blocked for reconciliation. Rejected non-sale financial operations remain visible with their local provisional effects. Authoritative history is synchronized by return date; late backdated writes outside a delta window and long-term history volume need follow-up. History UI/export and cross-terminal returning of every server invoice are not certified.

### O08 — two-terminal offline acceptance, P1: bounded acceptance passed; settlement remains

`two-terminal-acceptance.test.ts` connects two independent file-backed SQLite databases and the actual API client/SyncWorker to a disposable Mongo replica-set API listening on loopback. It bootstraps one unit to each terminal, disconnects, sells offline on both, restarts, drops a committed response, retries without duplicating, rejects the conflicting sale, blocks refunding the rejected invoice, returns the successful sale offline, drops/retries that return response, restarts and retries the rejected sale after stock restoration. It then submits an excess return, verifies durable rejection across restart and confirms unresolved operations prevent wiping. Server invoices, return count and both local/server stock reconcile. `two-terminal-acceptance.log`; passed.

Risk: this is one deterministic acceptance scenario, not a load/endurance/hardware claim. A rejected offline cash sale may represent money physically collected; operator cash settlement and reversal UX are still required. The application keeps these records visible rather than claiming automated financial settlement.

### O12 — dependencies, P1: shipped runtime upgraded; dev-tool advisories open

Pinned desktop versions: Electron 44.7.0, better-sqlite3 13.0.3, electron-updater 6.8.9, electron-builder 26.15.3. Node host22.17.0; Electron embeds Node24.21.0. `package.json`/lock, native rebuild script and printing compatibility changed. better-sqlite3v13 distributes Node-API binaries; old ABI download logic failed because no ABI-specific v13 artifact exists. The script now validates the bundled platform binary and installs test/runtime copies with package/runtime stamps. Real Node and Electron SQL probes passed. First Electron install had an EBUSY rename; retry completed. No user process was killed to obtain success.

Full scan package-path counts: backend 6 (2 critical/1 high/3 moderate), frontend 14 (2 critical/6 high/6 moderate), desktop 23 (2 critical/6 high/15 moderate). All three `--omit=dev` scans report zero. Electron is a development dependency used to ship the runtime, so its installed version and full scan were explicitly inspected; Electron itself is no longer flagged. Zero omit-dev advisories is not an exploit/security certification. Scans and package smoke/runtime/PDF/auth results are preserved.

ASAR membership inspection found none of the checked development tools (Vitest, tinypool, Vite, builder, electron-vite, esbuild) in the packaged application. `packaged-dependency-inspection.json` records the archive hash; package membership is not a security certification.

Next compatible upgrade plan: minimum Node22.12; Vitest 5.0.3 across independent projects and test workspaces; Vite 7.3.7 with electron-vite5 (its peers support Vite 5/6/7), compatible React plugin, then audit/build/test/package again. Backend esbuild should move to a patched compatible release. Vite 8 is not an automatic choice because electron-vite5 does not declare compatibility. Tailwind3/transitive braces/micromatch/parser and builder transitive advisories require separate compatibility or upstream remediation. Do not force npm's suggested builder downgrade solely from advisory metadata. Native addon support on every distributed architecture must be verified.

Risk: unsigned installer and untested signed update chain remain release blockers. Toolchain advisories are retained, not automatically suppressed. No update was published, downloaded or installed on a user's terminal.

### O14 — missing price migration, P2: read-only command restored; historical apply deferred

The command referenced a nonexistent file; Git history contained no original migration. The original `docs/UPGRADE_PROMPT.md` specification replaced retailPrice/wholesalePrice with three price tiers and requested a migration. Read-only raw-document inspection found two products already using all three numeric tiers, no legacy retailPrice. No existing record needed conversion.

New `src/db/migrations/price-plan.ts` preserves valid current prices, proposes retailPrice→retail1/retail2 and wholesalePrice→wholesale, retains legacy fields and blocks malformed/ambiguous records. `001-three-tier-prices.ts` defaults to read-only totals and deliberately refuses `--apply`. `migrate:prices` executed successfully:2 unchanged/0 planned/0 blocked. `price-migration.test.ts` (2) and disposable legacy migration/second-pass acceptance passed.

Risk: a production write migration remains unapproved and unexecuted. The second retail tier duplicates the only old retail value until explicitly repriced. Representative historical exports, backup, reviewed plan and rollback procedure are required before application.

### O13/O17 — deployment, backup and historical integrity, P1: partial isolated acceptance

Configured business database operations were count/aggregate/index reads only:2 products/0 purchases; no personal records or connection secrets printed. `historical-readonly.json`. This sample cannot establish historical referential/financial integrity.

`backup-restore-acceptance.test.ts` writes a BSON logical backup of every seeded test collection to a disposable file, restores to a new disposable database, reproduces indexes, compares complete sorted document hashes and sales/debt/purchase/payment/stock aggregate totals. It applies the reviewed additive price mapping only to a disposable legacy fixture and confirms repeat safety. Two cases passed. `backupRestore.test.ts` uses SQLite online backup, restores schema 3 as schema 4, preserves pending/sent attempts/invoice counter and runs `integrity_check=ok`; passed.

Docker daemon remains unavailable; mongodump/mongorestore are unavailable. The logical fixture test is not mongodump/PITR or production-backup certification. Authenticated private replica set, container network/TLS/CORS/proxy, actual migration/restore/RPO/RTO, signed installation/update distribution and fault-recovery release-stack acceptance remain open. No production deployment or existing-data migration was attempted.

### Other persistent findings

| Finding | Current disposition and next verification |
|---|---|
| O02 / P1 | General ledger/COA/journals/fiscal close remain missing modules. No new implementation/test this pass. Establish required accounting scope and journal invariants; operational reports are not a trial balance. |
| O09 / P1 | Data IPC authentication/projection/prototype regression repaired. Other channel sender validation, external URL/navigation allowlists and pairing/printing/update permissions remain source risks; full exploit/channel/schema matrix unexecuted. |
| O10 / P1 | Existing authentication tests and synthetic Electron offline login passed. Concurrent refresh/password revocation/offline revocation policy acceptance remains open; no new refresh defect proven. |
| O11 / P2 | Business timezone and date validation/live cron boundary policy still unestablished. Audit timezone is not automatically the accounting policy. No new job/date test or repair. |
| O15 / P2 | Prior400 loopback reads and existing performance evidence preserved. New desktop renderer remains about1.392MB; no long-shift/large-catalog/SLA certification. |
| O16 / P3 | React async QR `act()` warnings remain in passing shared POS tests. No warnings suppressed. Await the visible QR lifecycle in a future harness repair. |
| O18 / P2 | Full forms/export/accessibility/cross-browser/provider failures/disk faults/endurance/hardware acceptance remains unexecuted. Only the named new scenarios are claimed. |

## Prioritized remaining release work

1. **P0:** implement explicit mixed customer/supplier reimbursement and receipt reversal/settlement workflows; reconcile historical general receipts and rejected offline cash transactions without deleting evidence. Preserve the new blocking guards until each workflow exists. O03/O05/O06/O07/O08.
2. **P1:** complete IPC sender/channel/schema and navigation/external URL protections; authentication revocation/refresh acceptance. O09/O10.
3. **P1:** resolve dev-tool critical/high advisories with compatible upgrades; build signed installers and verify trusted update feed/download/install/restart. O12/O13.
4. **P1:** isolated authenticated release deployment and real backup restoration, representative historical reconciliation and approved migration/index plan. O04/O13/O14/O17.
5. **P1/P2:** agree ledger/accounting scope, business timezone, release thresholds and named physical/provider/accessibility/endurance acceptance. O02/O11/O15/O18; QR harness debtO16 last.

**Release remains NOT READY.** The verified runtime upgrade, branch isolation and synthetic financial/restore results materially reduce risk. They do not establish immutable historical accounting, operational settlement, trusted installer/update distribution or production deployment readiness. No release to users is recommended until the applicable blockers and acceptance gates are resolved.
