# AGENTS.md

## Cursor Cloud specific instructions

### What this is
`nsa-portal` ("National Sports Connect") is a single-page **Create React App** (run through **CRACO**) for an apparel ERP. The backend is **Supabase** (hosted; no local DB) plus **Netlify functions** (`netlify/functions`) and **Supabase Edge functions** (`supabase/functions`) that only run when deployed. The frontend is by far the primary, locally-runnable product. `bot-worker/` is a separate Node service meant to run on a dedicated machine with the Claude Code CLI + a Supabase service-role key — it is not part of local dev and is not runnable here.

### Standard commands (defined in `package.json`)
- Dev server: `npm start` (CRACO dev server on http://localhost:3000). Use `BROWSER=none` to avoid a browser-open attempt.
- Unit tests: `npm test` (Jest via `react-scripts test --watchAll=false`). CI runs `node scripts/run-tests.js`, which wraps the same Jest suites and also writes reports under `test-reports/`.
- Build: `npm run build`.
- E2E: `npm run test:e2e` (Playwright, Firefox, against `localhost:3000`).

### Non-obvious gotchas
- **Logging in without Supabase auth:** The login gate (`src/LoginGate.js`) normally needs a real Supabase session. For local dev, set `REACT_APP_ADMIN_PW_HASH` in a `.env` file (gitignored, repo root) to the SHA-256 of any password. On the login screen, type any email + that password and click Sign In to open an **admin user picker** seeded from `DEFAULT_REPS` (`src/constants.js`) — pick a user (e.g. "Steve Peterson", admin) to enter the dashboard fully offline. Compute a hash with: `node -e "console.log(require('crypto').createHash('sha256').update('YOUR_PW').digest('hex'))"`.
- With no `REACT_APP_SUPABASE_URL`/`REACT_APP_SUPABASE_ANON_KEY` configured, the app still loads and renders (dashboards show zeros, stats empty); Supabase data fetches/writes simply no-op or fail silently — this is expected for local UI work. To exercise real data, add those two env vars in `.env`.
- **Lint is run by CRA's `eslint-webpack-plugin` during `npm start`/`npm run build`** — there is no standalone `lint` script and no repo `.eslintrc` (config is CRA's built-in `react-app`). A clean compile means lint passed. Many large files start with `/* eslint-disable */` on purpose.
- The `npm start` compile prints ~57 "Failed to parse source map" **warnings** from `svg2pdf.js`/`html2pdf.js` — these are harmless third-party source-map issues, not errors, and do not block the dev server.
- `src/App.js` (~2.6 MB) and `src/OrderEditor.js` (~1.2 MB) are intentionally huge single files; tooling (and reads) can be slow. CRACO disables webpack `concatenateModules` as a safety measure for these.
- Public, login-free routes exist and bypass the staff login gate: `/shop/<slug>` (storefront), `/shop/order/<token>` (order tracker), `/adidas` (a.k.a. `/livelook`), `/team-stores`, and `/?portal=<tag>` (coach portal). See `src/index.js` for the routing branch.
