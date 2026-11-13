# ERP + POS continuation: IPC security and development dependencies

2026-10-12, Africa/Cairo. **Release recommendation: NOT READY.** This pass continues [PASS2.md](PASS2.md). It preserves the working-tree reorganization, previous findings and evidence. Existing business databases were not modified. No production deployment, real payment, destructive migration or historical rewrite occurred.

## Executed verification

| Runner | Passing executions | Failed / skipped in final runner |
|---|---:|---:|
| Backend main / shared | 297 / 23 | 0 / 0 |
| Frontend main / client / POS / shared | 39 / 5 / 100 / 23 | 0 / 0 |
| Desktop main / client / POS / shared | 104 / 5 / 100 / 23 | 0 / 0 |
| **Total** | **719** | **0 / 0** |

These are executions including shared-package copies, not unique business scenarios. The previous total was 707. The 12 new desktop cases are included once; targeted repeats and Electron scenarios are excluded from this total. All suites were rerun because the test runner changed to Vitest 5.0.3. Typecheck and lint passed in all three projects. API, web and desktop builds passed. Shared source parity passed.

Real Electron 44.7.0 executed seven IPC checks, native SQLite 3.53.4/OS encryption/synthetic online and offline authentication/PDF probes, and a production-renderer checkout/printing/retry/cancellation scenario with mocked IPC. Six real PDFs were generated. Packaging with `--dir --publish never` and the resulting executable's isolated-profile SQLite smoke passed. Authenticode reports **NotSigned**. No physical print, installed NSIS/portable lifecycle or downloaded signed update is certified.

Actual results: [summary](evidence/pass3/verification-summary.json), [execution exits](evidence/pass3/execution-results.json), [IPC runtime](evidence/pass3/ipc-runtime/results.json), [native runtime](evidence/pass3/runtime/results.json), [renderer](evidence/pass3/renderer/results.json). Earlier failed or intermediate attempts remain separate and are not counted as passing verification.

## O09: IPC, navigation and display disclosure — repaired in tested paths; acceptance remains partial

**Reproduction.** Run `node audit/scripts/ipc-runtime.mjs` after the desktop build. Its before-fix phase bundles the preserved original preload from `originals-pass3/`, installs the original sender-blind cached-session handler against synthetic credentials, and loads a separate customer-display document. That document retrieves `SYNTHETIC_PRIVATE_TOKEN`. No real credentials are used. Source evidence also shows unrestricted `shell.openExternal(url)`, absent navigation/frame guards, anonymous unpair/outbox/retry/printing handlers and unrestricted display payloads: [before evidence](evidence/pass3/o09-before.json).

**Root cause.** Renderer IPC handlers trusted every window and frame, TypeScript types were treated as runtime validation, the customer display received the entire POS bridge, and cached-session responses exposed bearer tokens. Display state contained full cart/customer records, including costs, stock and account data. Popup URLs could launch arbitrary OS schemes. Retry and local quick-grid/transfer actions lacked complete local authorization gates.

**Changes.** Every privileged main-window invoke handler now registers through `createIpcBoundary`. It checks the exact live `WebContents`, its top frame and approved document URL before session, permission and argument checks. A sibling window, same-document subframe or navigated page is denied. The single exception is a dedicated display-settings handler that validates the exact display window/frame and returns company name, currency and tax configuration only. No database or authentication bridge is exposed to that display.

The display bridge is selected through main-process `additionalArguments: ['--pos-customer-display']`; one self-contained sandboxed preload is bundled. A first attempt at two preload entries created a shared `require('./chunks/...')` which sandboxed Electron cannot load. The actual Electron probe found this build regression, so the final build uses one preload. Its display capability exposes settings and state subscriptions only. Display payload schemas retain product/name/quantity/price/discount and customer name; they discard costs, availability, balances and contacts. Logout clears the display. Session responses retain user, permissions and expiry, with no access/refresh tokens.

Navigation, redirects, frame navigation and webview attachment are guarded. Popups are denied; the main window can launch credential-free HTTPS browser URLs. Display popups do not launch external URLs. Pairing accepts normalized HTTP/HTTPS server URLs without credentials/query/fragment, retaining the existing local HTTP deployment behavior; transport encryption policy remains a release decision.

Bounded schemas reject invalid credentials, print geometry/copies/oversized HTML, malformed IDs, oversized/deep collections and non-finite numbers. Local data calls use existing shared business schemas before mutation, validate branch writes, and enforce quick-grid/transfer permissions. Unpair requires `settings.edit` or `cash.open`, a closed shift and resolved outbox. The login-screen unpair path now authenticates with entered credentials before invoking it. Retry requires a rejected operation and the relevant operation permission. Update installation requires a downloaded update, a closed shift and resolved synchronization.

**Files.** `pos-desktop/src/main/{index,dataAccess,ipcSecurity,ipcValidation,displayProjection}.ts`; `src/main/ipcSecurity.test.ts`; `src/preload/{index,display}.ts` and `index.d.ts`; `src/shared/{ipc,display}.ts`; `src/renderer/src/{App,display}.tsx`; `screens/{LoginScreen,LockScreen}.tsx`. `audit/scripts/ipc-runtime.mjs` exercises actual Electron IPC and both preload roles.

**Regression execution.** `ipcSecurity.test.ts`: 12 passing cases for exact document matching, forged windows/frames/destroyed windows, logout gates, bootstrap/login, permissions, external schemes/navigation/redirect guards, invalid print/login/pairing arguments, negative/non-finite sale quantities and branch writes, transfer/quick permissions, display projection and token removal. Existing data-access five cases passed. Full desktop main suite: 104 passed. Actual runtime: seven checks passed, including before-fix disclosure, after-fix sender denial, minimal display state/settings, blocked iframe/foreign-file navigation and logout denial. Production renderer/PDF acceptance passed after the single-preload correction.

**Unresolved risks.** Signed update/download/install and authorized unpair/re-pair recovery with historical data still need acceptance. The actual IPC probe executes production boundary/preload/data-dispatch code with synthetic callbacks; it is not full hardware or complete business-handler certification. Print content remains HTML in sandboxed preview windows and needs a separate external-resource/content policy. HTTPS destination-host restrictions, trusted server provisioning, renderer idle-lock enforcement in the main process and offline credential expiry/revocation remain O09/O10 follow-ups. Unit tests cover forged subframes; the real runtime denies iframe navigation before a privileged child bridge is created. Synthetic probe pages intentionally lack production CSP; their warnings are retained, not suppressed.

## O12: development-tool vulnerabilities — critical paths removed; residual advisories remain

**Reproduction and cause.** Previous `npm audit --json` results included critical Vitest/tinypool, vulnerable Vite/esbuild and related paths in three independent lockfiles and workspace copies. Dependency range/runtime selection mattered: Electron is a development dependency but its executable is shipped. Its pass2 upgrade to 44.7.0 remains intact.

**Compatibility established before edits.** Registry peer/engine metadata supports Vitest 5.0.3 with Vite 7.3.7, electron-vite 5.0.0 with Vite 5/6/7, and React plugin 5.2.0 with Vite 7. Local Node 22.17.0 satisfies the new minimum 22.12.0. Vite 8 was not selected because electron-vite's peer range excludes it. Backend esbuild is pinned to 0.28.2. All independent workspace Vitest declarations changed together; no `npm audit fix --force` or historical changes were used.

**Files.** All three project `package.json`/`package-lock.json`, shared/client/POS workspace manifests where Vitest is declared. Each original manifest/lock is preserved under `originals-pass3/`. Existing native rebuild script installed the bundled better-sqlite3 13.0.3 Node-API binary and ran its Node SQL probe during installation/packaging. Real Electron SQL/auth/PDF verification passed afterward.

| Project | Before full scan | After full scan | Current production-only scan |
|---|---|---|---|
| Backend | 2 critical, 1 high, 3 moderate | 0 | 0 |
| Frontend | 2 critical, 6 high, 6 moderate | 0 critical, 5 high, 3 moderate | 0 |
| Desktop | 2 critical, 6 high, 15 moderate | 0 critical, 5 high, 11 moderate | 0 |

**Actual execution.** All three `npm install` commands exited 0. Windows emitted cleanup warnings for locked esbuild binaries belonging to existing running development tools; no user process was killed and no forced deletion occurred. Three complete suites, typecheck/lint and builds passed. Packaging/native rebuild/isolated executable smoke passed. ASAR inspection found none of the checked Vitest/tinypool/Vite/builder/electron-vite/esbuild/Tailwind/braces/sprintf/parser packages shipped: [membership and archive hash](evidence/pass3/packaged-dependency-inspection.json). Production-only audit alone is not used to certify shipped Electron. Six new PDFs and virtual printers only.

**Residual triage.** High paths come from Tailwind 3's braces/micromatch/chokidar/fast-glob chain. The registry still reports braces 3.0.3 as latest while the advisory covers `<=3.0.3`; no patched same-major version was available. Tailwind 4 requires CSS/config/component migration, so that needs a separate visual and packaging acceptance pass. Moderate paths include postcss-selector-parser (patched 7.1.6 available, older major pinned by Tailwind/nested dependencies) and builder's older `@electron/get`/global-agent/roarr/sprintf chain. Registry reports sprintf-js 1.1.3 as latest while the advisory includes that release. New `@electron/get` 5.1.0/global-agent 4.1.3 remove the old logger path but are major transitive upgrades: qualify proxy/download behavior before override, or take a compatible upstream builder repair. The audit-suggested builder downgrade was not applied. Remaining advisory details are in the full JSON scans. Installation is unsigned; no update feed was configured or published.

## Findings retained without repeating completed discovery

| Finding | Status after this pass / next evidence needed |
|---|---|
| O01 | Existing API branch/supplier/customer projections retain passing full-suite regressions. Display/account/cost disclosure additionally bounded by O09. Whole-system historical isolation remains partial. |
| O02 | Accounting scope decision remains open: operational summaries do not establish journal/COA/fiscal-close support. |
| O03 | Paid-credit cancellation guard preserves receipts; immutable paid-document reversal/settlement workflow remains P0. |
| O04 | Company-wide supplier-number guard retains passing tests; historical index/uniqueness migration remains unapplied pending representative review. |
| O05 | Proportional discounted return/refund bounds retain passing tests; explicit mixed/supplier reimbursements remain P0. |
| O06 | Initial-payment absence was disproved previously. Split tender/allocation repairs retain tests; historical null allocations/prepayments need reconciliation. |
| O07 | Durable offline refund/source history and rounding tests retain passes; backdated history/presentation acceptance remains. |
| O08 | Two-terminal conflict/lost-response/return/retry/restart acceptance remains recorded in pass2. Rejected collected cash settlement and endurance remain open. |
| O09 | Bounded sender/frame/authorization/schema/navigation/display repairs and actual runtime evidence described above; remaining policies/acceptance listed. |
| O10 | Offline expiry/revocation, renderer idle lock and refresh concurrency remain unverified. Token disclosure repaired under O09. |
| O11 | Business timezone/day boundary policy remains unset; audit timezone is not silently treated as accounting policy. |
| O12 | Critical development paths removed; remaining Tailwind/build paths and signed distribution described above. |
| O13 | New isolated unpacked package passed; authenticated deployment, signed installer/update and infrastructure acceptance remain open. |
| O14 | Read-only price plan/disposable additive test retained; no historical apply/index migration performed. |
| O15 | Build warnings for large chunks remain; no SLA or long-shift performance certification. |
| O16 | QR `act()` warnings remain in the passing frontend suite; lifecycle improvements still pending. |
| O17 | Prior read-only two-product/no-purchase sample and synthetic restoration retained. Representative historical/PITR/RPO/RTO acceptance requires infrastructure/data. |
| O18 | Physical printers/drawer/scanner, provider sandboxes, comprehensive accessibility/CRUD, disk faults and endurance remain unexecuted. |

## Prioritized release backlog

1. **P0 — O03/O05/O06/O08/O17:** finish explicit customer/supplier reimbursement, immutable reversal and rejected cash settlement workflows; reconcile source documents and reviewed historical allocations. Existing ambiguity blocks stay in place.
2. **P1 — O09/O10:** qualify offline revocation/expiry/refresh/idle lock, server provisioning and print-resource policy; execute authorized unpair/re-pair and update-readiness recovery acceptance.
3. **P1 — O12/O13:** remove remaining Tailwind/build advisories with compatible upstream changes; certify signed installer and signed download/install/restart updates.
4. **P1 — O13/O17:** execute authenticated isolated deployment, production-format backup restoration/PITR and RPO/RTO with representative historical reconciliation when infrastructure becomes available.
5. **P1/P2 — O02/O04/O11/O14/O15/O18:** establish accounting/date scope, qualify historical migration/index plans, physical/provider acceptance and workload/endurance targets. O16 QR harness debt is P3.

**NOT READY.** The 719 passing executions and bounded real IPC/runtime/package evidence reduce demonstrated risks; the remaining financial, historical and release-acceptance blockers prevent an evidence-based production recommendation.
