# moto-erp-frontend

Back-office web app (React 18 + Vite) with an in-browser POS at `/pos`. It uses the same `@moto/pos-core` terminal, product filters, cash/credit checkout, invoice notes, held carts, searchable paged sales history and invoice templates as `../pos-desktop`, plus the desktop toolbar, font scaling, shift opening/closing, idle lock and customer display (`/pos/display`, F7). The POS fills the viewport, including the desktop footer; Exit POS returns to an accessible ERP page without signing out or closing the shift.

`node ../scripts/sync-packages.mjs --check` verifies that the package sources match the desktop. Run `node ../scripts/sync-packages.mjs` after updating desktop package sources to keep the project copies identical.

Browser sales are saved directly through the API and require connectivity. Carts and held invoices persist per user and branch on the device. Printing uses the browser print dialog. The only invoice papers are 80mm thermal (small) and portrait A4, 210×297mm (large). Designs use the full paper width at 100% with zero external margins. Roll length follows the content plus 4mm for the cutter; long A4 invoices paginate. Old 58mm/A5 profiles adopt the supported sizes while preserving printer options. The physical cash drawer and SQLite/outbox sync remain desktop capabilities. Desktop checkout also uses the system printer dialog.

Barcode labels print one copy per page at the template's physical millimeter dimensions. The browser print document is isolated from the ERP layout and preview zoom; hardware DPI does not change label size. Both the barcode queue and label designer use this path, and wait for fonts and company images before opening the print dialog. Select matching label stock and 100% scale in the printer settings.
Self-contained project: `@moto/shared`, `@moto/api-client`, `@moto/ui` and `@moto/pos-core` live in `packages/` and are linked through this project's own npm workspace.

```bash
npm install
npm run dev      # http://localhost:5173 — proxies /api, /socket.io, /uploads → :4000
npm run build    # tsc -b && vite build → dist/
npm test         # vitest + testing-library (jsdom)
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `/api` | REST base URL |
| `VITE_SOCKET_URL` | `window.location.origin` | Socket.IO origin |
| `VITE_PUBLIC_URL` | `window.location.origin` | Base for the `/v/:invoice` QR link printed on receipts |
| `VITE_API_PROXY` | `http://localhost:4000` | Dev-server proxy target (read from `.env*` via `loadEnv`) |

**Same-origin with the API is the preferred deployment** (reverse proxy `/api`, `/socket.io`, `/uploads` → `api:4000`). `Dockerfile` (build context = this folder) + `nginx/app.conf` do exactly that: a non-root nginx serving the hashed bundle with long-lived asset caching, a CSP, and the three proxied paths. `VITE_*` values are build arguments because Vite inlines them, so changing them means rebuilding the image.

The web service is defined in `docker-compose.yml` as an overlay on the backend stack. Configure
`../erp-backend/.env.docker` from its example, then run `npm run docker:stack -- up -d --build` from
the repository root or `erp-backend`. Backend services and deployment variables live in `erp-backend`.

### Cross-origin deployment (Firebase Hosting + Azure App Service)

Firebase Hosting can only rewrite to Cloud Run/Functions, so `/api` there falls through to the SPA rewrite and the app receives `index.html` where it expects JSON. `.env.production` therefore points `VITE_API_URL` / `VITE_SOCKET_URL` at the API origin, and the API must be configured to match:

- `CORS_ORIGINS` must list the app origin (e.g. `https://moto-parts.web.app`).
- `COOKIE_SAMESITE=none` — the refresh cookie is `httpOnly` and scoped to `/api/auth`; with the default `Lax` the browser never sends it cross-site and every session silently dies after the 15-minute access token expires.
- `PUBLIC_URL` on the API and `VITE_PUBLIC_URL` here both point at the **app** origin (the `/v/:invoice` QR route is a frontend route).

### Azure Static Web Apps

Build with `npm run build` and deploy `dist/` (for a repository-root build, use
`app_location: erp-frontend` and `output_location: dist`). Vite copies
`public/staticwebapp.config.json` to the root of `dist/`; include it in the deployment.
Its `navigationFallback` serves `index.html` for frontend routes such as `/dashboard`
and `/sales/:id`, so direct links and refreshes work with React Router. Asset and
backend paths are excluded from this fallback.

When the API is hosted separately, set `VITE_API_URL` and `VITE_SOCKET_URL` to the
API origin before building, and configure the backend's `CORS_ORIGINS` and
`COOKIE_SAMESITE` as described above using the Azure Static Web Apps origin.
Set `VITE_PUBLIC_URL` and the backend's `PUBLIC_URL` to that app origin too.

## Features added in v2

| Route | Feature |
|---|---|
| `/products/labels/designer` | Label designer: drag/resize elements (company, name, barcode, price tier, SKU, logo, custom text), presets 50×25 / 40×30 / 58×40, exact-mm print |
| `/products/barcodes` | Batch label printing with the system barcode |
| `/pos` | Product rows with catalog selection, quantity controls, three-tier pricing (1/2/3 keys, per-line tier popover, special prices), print profiles, alternatives suggester, QR on receipt |
| `/settings` → Printing | Print profiles (80mm thermal and A4 · compact/detailed), per-device default, full paper width at 100% |
| `/reports/dead-stock` | Idle-days filter, frozen capital, carrying cost, suggested actions (discount / transfer / liquidate / return to supplier) |
| `/alerts` | Alerts center + top notification bar (low/dead stock, overdue debts, register discrepancies, failed syncs) |
| `/v/:invoiceNumber` | Public invoice verification (QR target; resolves offline-generated numbers once synced) |

## Layout

```
src/
  features/<domain>/   pages + dialogs per module
  services/            thin wrappers over @moto/api-client (singleton in services/api.ts)
  stores/              zustand: auth (persisted), ui (locale/theme/branch)
  lib/realtime.tsx     Socket.IO → TanStack Query invalidation
  i18n/                ar.ts / en.ts — Arabic is the source of truth; `tx()` falls back ar→en
  components/          ui primitives, shared tables/forms/charts, layout
```

Product names are Arabic-required with optional English; everything in the UI renders via `tx()` so missing English never breaks a screen.
