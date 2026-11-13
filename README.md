# MotoParts ERP + POS

Multi-branch ERP and point-of-sale for a motorcycle spare-parts business. Arabic-first (RTL) with optional English.

The repository holds **three independent projects**. Each one has its own `package.json`, lockfile and
`node_modules`, and each carries its own copy of the shared packages under `packages/` (linked through
that project's internal npm workspace). You can clone, install, build and deploy any of them on its own.

| Project | What it is | Stack |
|---|---|---|
| `erp-backend` | REST + Socket.IO backend | Node 22 · Express 5 · Mongoose 8 (MongoDB replica set) · Zod · JWT · node-cron |
| `erp-frontend` | Back-office web app | React 18 · Vite · Tailwind · TanStack Query · Zustand |
| `pos-desktop` | Offline-first POS terminal for Windows | Electron 33 · better-sqlite3 · electron-updater · electron-builder |

Shared packages carried inside the projects that use them:

| Package | What it is | Lives in |
|---|---|---|
| `@moto/shared` | Domain types, Zod schemas, permissions, money/barcode/QR utils, defaults | all three |
| `@moto/api-client` | Typed HTTP client (refresh-on-401, `Idempotency-Key`) | erp-frontend · pos-desktop |
| `@moto/ui` | Radix/shadcn-style primitives, `Barcode` (Code-128/EAN-13), `QrCode` | erp-frontend · pos-desktop |
| `@moto/pos-core` | POS terminal UI (product rows, tiers, payment, printing) behind a `PosAdapter` interface | erp-frontend · pos-desktop |

> The copies are real copies — a change to `@moto/shared` must be applied in every project that ships it.

## Quick start (development)

Prerequisites: Node ≥ 22, Docker or a local MongoDB (replica set), Windows for the desktop installer.

```bash
npm run install:all                              # installs all three projects
npm run db:start                                # local MongoDB single-node replica set rs0
cp erp-backend/.env.example erp-backend/.env     # set JWT_SECRET / JWT_REFRESH_SECRET
npm run dev                                      # API http://localhost:4000 + web http://localhost:5173
npm run dev:pos                                  # Electron POS (separate terminal)
```

Each project also works standalone — `cd erp-backend && npm install && npm run dev`.

Startup creates system configuration only (roles, print profiles and category roots). Company identity,
contact details, tax identifiers and receipt branding start blank. No products, customers, stock,
transactions or accounts are generated. Create the first administrator with real branch details:

```bash
npm run db:reset                        # dry run: lists what would be deleted
npm run db:reset -- --confirm           # delete all business data (PowerShell: npm run db:reset "--" --confirm)
ADMIN_PASSWORD='…' BRANCH_NAME_AR='…' BRANCH_CITY_AR='…' BRANCH_ADDRESS_AR='…' npm run init-admin
```

Test fixtures live under `erp-backend/src/test/fixtures` and are restricted to the isolated test database;
they are excluded from deployment bundles. There is no demo seed command or simulated WhatsApp provider.
WhatsApp uses manual `wa.me` preparation (`web`) or authenticated Meta Cloud API (`cloud`); preparation
never counts as delivery. Existing databases are preserved; changing defaults does not erase stored data.

## Scripts (root)

The root `package.json` has **no dependencies** — it only forwards to the three projects.

| Command | Purpose |
|---|---|
| `npm run install:all` | `npm install` in all three projects |
| `npm run dev` | API + web concurrently |
| `npm run dev:pos` | Electron POS in dev mode (HMR) |
| `npm run db` / `db:start` / `db:stop` | Local single-node MongoDB replica set (rs0) |
| `npm run build` | Build erp-backend + erp-frontend |
| `npm run typecheck` | `tsc --noEmit` in all three projects |
| `npm run lint` | ESLint (flat config, zero warnings) in all three projects |
| `npm run test` | Vitest in all three projects (API spins up `mongodb-memory-server` replica set) |
| `npm run test:integration` | API + two real offline desktop terminals; requires backend and desktop installs |
| `npm run db:reset "--" --confirm` | Delete every business document and return to a clean install |
| `npm run init-admin` | Create the first branch, warehouse, register and admin |
| `npm run docker -- <args>` | Backend Docker stack from `erp-backend/docker-compose.yml` |
| `npm run docker:stack -- <args>` | Backend Docker stack plus the frontend service |
| `npm run pos:dist` | Build the Windows NSIS installer + portable exe → `pos-desktop/release/` |

## Production with Docker

```bash
cp erp-backend/.env.docker.example erp-backend/.env.docker  # edit deployment secrets and origins
npm run docker:stack -- up -d --build  # mongo + rs init + api (127.0.0.1:4000) + nginx SPA on :8080
npm run docker:stack -- exec -e ADMIN_PASSWORD='…' -e BRANCH_NAME_AR='…' -e BRANCH_CITY_AR='…' -e BRANCH_ADDRESS_AR='…' api node dist/db/init-admin.js
```

Put TLS in front of the `web` container. [erp-backend/docker-compose.yml](erp-backend/docker-compose.yml)
owns MongoDB, API, the legacy uploads migration volume and backups. Company logo images are stored in
MongoDB and included in its backups. [erp-frontend/docker-compose.yml](erp-frontend/docker-compose.yml)
adds the web service. Docker uses `erp-backend/.env.docker`; local Node development uses `erp-backend/.env`.
Both files are ignored by Git. Run a backup with `npm run docker -- run --rm backup`.

## Architecture highlights

- **Single stock gateway.** Every quantity change goes through `applyMovement()` inside a Mongo transaction; sales, returns, purchases, transfers, adjustments and counts all produce `StockMovement` rows.
- **Three-tier pricing.** `prices.{retail1, retail2, wholesale}` on every product; the POS picks the tier from the customer type, the cashier can switch per line (keys 1/2/3), customer special prices override, wholesale needs `prices.wholesale` permission. Every sale item stores `priceTier` + `listPrice` for margin reports.
- **One barcode engine.** `internalBarcode` is generated by the server (`BARCODE_PREFIX` + sequence + check digit; EAN-13 when numeric/13). Supplier barcodes live in `legacyBarcode` and still scan (flagged in the UI). Labels and receipts render the internal code only.
- **Two invoice paper sizes throughout the system.** Small is an 80mm thermal roll; large is portrait A4 (210×297mm). The branded design uses the full paper width at 100%, with padding inside the canvas and zero external print margins. Roll length follows the content plus 4mm for the cutter; long A4 invoices paginate. Old 58mm/A5 profiles adopt 80mm/A4 while keeping their printer and options. Profiles support compact/detailed output and a per-device default; printer selection uses the system dialog. Labels: drag/resize designer with exact-mm output, presets 50×25 / 40×30 / 58×40.
- Sales reports use billed totals including tax; profit uses invoice revenue excluding tax after all discounts and rounded item costs. Accounting shows the tax deduction explicitly. POS availability and offline stock deductions use the branch's same active sales warehouse. Transfers can select a source warehouse, defaulting to the active main warehouse.
- **Invoice verification QR.** Each sale gets a TLV/Base64 QR (seller, tax no., timestamp, total, tax, verify URL). Public `/v/:id` page verifies against the server. This is internal verification, not integration with a government e-invoicing authority.
- **Alerts engine.** Cron evaluates low stock, dead stock, overdue debts, register discrepancies, failed syncs; results surface in the notification bar and `/alerts`.
- **Offline-first POS.** See [pos-desktop/README.md](pos-desktop/README.md). Sales are committed to SQLite first, pushed via an idempotent outbox, invoice numbers are `PREFIX-TERMINAL-SEQ` so they never collide with server numbers.
- **Realtime.** Socket.IO rooms per branch; web invalidates TanStack Query caches on `stock.changed`, `sale.created`, `alert.created`, etc.

## Repository layout

```
erp-backend/     src/modules/<domain>/{model,service,routes,test}.ts · src/db (bootstrap, init-admin, migrations) · jobs/ · Dockerfile
  packages/shared/
  scripts/       local-mongo.mjs (dev replica set) · pack-api.mjs (deployable zip)
  docker-compose.yml · .env.docker.example
  audit/         backend audit scripts, snapshots, evidence and MongoDB tools
erp-frontend/    src/features/<domain>/ · src/components/{ui,shared,layout} · src/services (api-client wrappers) · src/i18n · nginx/ · Dockerfile
  packages/{shared,api-client,ui,pos-core}/
  docker-compose.yml (web service overlay)
pos-desktop/     src/main (Electron main: db, sync, auth, printing) · src/preload · src/renderer · electron-builder.yml
  packages/{shared,api-client,ui,pos-core}/
scripts/         dev.mjs · run-all.mjs (root task runner, no dependencies)
audit/           combined reports and cross-project checks
```

Shared package sources:
`shared/` types.ts · schemas.ts · permissions.ts · utils.ts · constants.ts —
`api-client/` http.ts · client.ts —
`ui/` primitives/* · barcode.tsx · qr.tsx —
`pos-core/` adapter.ts · store.ts · components/* · print/*

Per-project docs: [erp-backend/README.md](erp-backend/README.md) · [erp-frontend/README.md](erp-frontend/README.md) · [pos-desktop/README.md](pos-desktop/README.md)
