# moto-pos-desktop — MotoParts POS (Windows)

Offline-first point-of-sale terminal. Electron 44.7.0 · better-sqlite3 · `@moto/pos-core` UI · electron-updater.
Self-contained project: `@moto/shared`, `@moto/api-client`, `@moto/ui` and `@moto/pos-core` live in `packages/` and are linked through this project's own npm workspace.

## Run / build

Catalog pulls preserve the stock and customer-balance effects of outstanding local operations. The server
acknowledges operations already included in its snapshot, so a lost push response cannot cause a second
deduction. Offline credit sales update the cached debt and enforce the cumulative limit before committing.
Returns carry the original invoice number and line positions so they also sync for locally created invoices.

Rejected non-sale financial operations stay visible for reconciliation; deleting their queue entry would
leave the stock/refund/payment effects behind. Voiding a rejected sale requires `sales.cancel`, reverses its
local stock/debt in one SQLite transaction and refuses sales that already have returns.

```bash
npm install      # downloads Electron; postinstall validates and installs bundled SQLite Node-API binaries
npm run rebuild  # validate/install SQLite Node-API binary for Node and Electron
npm run dev      # electron-vite dev (HMR renderer)
npm test         # vitest (sync worker, outbox, offline numbering)
npm run dist     # → release/MotoParts POS-<ver>-x64.exe (NSIS) + -portable.exe
```

`POS_UPDATE_URL` (see `.env.example`) is read **at build time** by `electron.vite.config.ts` and compiled into the main process as the generic auto-update feed; host `latest.yml` + the installer there and the app updates itself (`update-ready` badge → restart). Builds without it have auto-update disabled (the API does not serve an `/updates` feed).

> `electron-builder install-app-deps` doesn't work inside npm workspaces, so `scripts/rebuild-native.mjs` pulls the prebuilt binaries directly. The Node-ABI copy lives in `native/` and is only used by tests.

## First run — pairing

1. Enter the server URL (`http://<erp-host>:4000`) and an **admin/manager** login.
2. Pick branch, cash register and a terminal name → the server returns a terminal code (`T001`, `T002`, …).
3. The app bootstraps the branch catalog (products, stock, customers, special prices, quick grid, print profiles, settings) into `%APPDATA%/MotoParts POS/pos.sqlite` (Electron `userData`, named after `productName`).

Cashiers then log in with their normal ERP credentials. Credentials are cached (bcrypt) so the **last successful user can log in offline**, even after a normal logout at the end of a shift.
Session and offline-profile storage require OS encryption. When it is unavailable, online login stays
in memory and offline login is unavailable. Tokens are never stored as plaintext or base64 alone.

## Offline behavior

| Online | Offline |
|---|---|
| Sale → SQLite → pushed immediately → server replies with the final id | Sale → SQLite + outbox; local stock decremented; receipt prints with `INV-T001-00042` |
| Catalog deltas pulled every 30 s and on reconnect | Last snapshot used; product selection/lookups/customers all local |
| Register open/close synced live | Queued as ops, replayed in order |

Sales history shows every invoice saved on this device for the paired branch, in pages of 100.
Invoice, customer and product searches cover the entire local history before pagination, including
Arabic and English names. Paging does not remove older invoices and works offline.

The sync worker (`src/main/sync/worker.ts`):
- heartbeat every 5 s → online/offline badge;
- on reconnect, pushes the outbox **in createdAt order**, batches of 50, then pulls deltas;
- `applied` / `duplicate` → sale marked synced with the server id (receipt reprint works with either id);
- `rejected` (e.g. `INSUFFICIENT_STOCK`) → sale marked failed, stops retrying, shows in the Sync panel with **Retry** (re-queues under a fresh `opId`, since the server remembers rejections by `opId`) / **Void** (restores local stock and cancels the local sale);
- `TRANSIENT` rejections and network errors → exponential backoff 2 s → 5 min.

Invoice numbers never collide: server sales are `INV-000123`, offline sales are `INV-<terminal>-<seq>` and keep that number after sync. Receipt QR codes link to `/v/<invoiceNumber>`, so they verify once the sale has synced.

## Printing & hardware

- **Complete sale** opens the payment details with **Small invoice / Large invoice** choices. **Confirm sale and print** saves the sale, clears the cart, then prints the chosen size. Small uses an 80mm roll; large uses portrait A4 (210×297mm). Designs use the full paper width at 100% with zero external margins. Roll length follows the content plus 4mm for the cutter; long A4 invoices paginate. Cached 58mm/A5 profiles adopt the supported sizes while preserving the printer, detail level and copy count.
  The payment dialog's profile selector saves the preferred profile for this device.
- Checkout opens the Windows printer dialog for each job. Choose an installed printer or **Microsoft Print to PDF** there. Windows displays “This app doesn't support print preview” for Electron jobs; printer selection and printing still work. Separate printer settings and the main-screen print buttons have been removed; legacy printer preferences do not override checkout's printer dialog. Paper comes from synced print profiles and the current device profile selection.
- Print failure offers retry with the same saved invoice and size. Cancelling the printer dialog keeps the sale saved. F8 prints the last sale using its last selected size. Double confirmation and retries cannot create duplicate sales. Successful printing means the job was sent, rather than proof of paper output.
- **Font size** in the top bar: slider and ± buttons (80–140%), saved on this device; click the percentage to restore 100%. Printed paper dimensions stay independent of this setting.
- **Collapse products** slides the catalog closed and expands the cart into its space; the selection is saved for the cashier. Product tiles and cart lines show SKU, barcode, part number, stock and available location/size.
- **Products** is the panel on the right, with rows for product, quantity, price and value. Invoice details on the left contain the customer, one total and checkout controls. Click a product name to search and replace it, or use the empty row to add a product; the list shows stock and shelf below each name. Barcode scanners work without a search field at the top. Products with zero available stock cannot be sold, and quantity cannot exceed available stock. Each product's price menu offers permitted retail/wholesale tiers. Value is price multiplied by quantity. New sales must be fully paid by cash, card or bank transfer and have no manual pricing, discounts or tax. Products load directly from the branch catalog. **Sales** opens the latest 100 locally saved invoices with search and item details, preserving the current cart.
- Thermal (roll) receipts get a page exactly as tall as the content (+4mm tail): no blank paper feed, no splitting long receipts into pages. The document is loaded from a temp file (a `data:` URL fails on any `#` in the markup).
- Cash drawer: ESC/POS kick spooled through the configured small receipt printer as a **RAW** job through winspool (Windows only, real printer required). Automatic opening is skipped when no printer is configured, the configured printer is absent, or it is virtual (PDF/OneNote). An actual failure to send the drawer command to configured physical hardware still shows a warning.
- Customer display: second window (`display.html`) mirroring cart/total; opens on the secondary monitor when present.

## Structure

Pairing and unpairing refuse to clear the terminal while pending, sent or rejected operations remain.
Sync or reconcile those operations first. Offline shift totals include all cached sales for the session,
including card and bank-transfer payments; cash change is subtracted only from cash tender.


```
src/main/        index.ts (IPC, windows, updater) · db/{schema,database}.ts · sync/{worker,localOps,alternatives}.ts · auth.ts · printing.ts · printLayout.ts
src/preload/     contextBridge → window.pos (typed in src/shared/ipc.ts)
src/renderer/    App.tsx (pairing → login → register → <PosTerminal adapter={ipcAdapter} />), screens/*, display.tsx
electron-builder.yml, scripts/rebuild-native.mjs
```

Smoke-test a build without a window: set `POS_SMOKE=1` and `POS_SMOKE_USER_DATA` to a disposable absolute directory before launching `release/win-unpacked/MotoParts POS.exe`. It prints `{"smoke":"ok", …}` and exits 0. An isolated directory is required to keep the smoke test away from cashier data.

After `npm run build`, run `node scripts/verify-desktop.mjs` on Windows to exercise the production renderer with isolated test data. It verifies font controls, catalog collapse, product details, checkout size selection, Windows-dialog job options, both invoice PDFs, cancellation and retry without duplicate sales. Samples and `results.json` are written under `release/verification/`. Physical paper output needs an installed printer; this check does not send jobs to hardware.

Run `node scripts/verify-cart.mjs` after building to verify invoice columns, product selection, quantity arrows, tier prices, product replacement and sales history in an isolated Electron profile. Screenshots and results are written under `release/cart-verification/`.

