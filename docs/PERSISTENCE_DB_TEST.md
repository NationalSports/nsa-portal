# DB-backed Persistence Round-trip (the real save-path test)

Proves the highest-risk contract in the app: an edit you make **actually
persists to the database**, not just to the screen. Because the app is
DB-as-truth (edits go to Supabase via `_diffSave`, never back to localStorage),
the only honest test is: edit → save → **drop the browser's local copy** →
reload → confirm it comes back **from the database**.

That requires a real Supabase endpoint, so the suite
(`e2e/14-persistence-db-roundtrip.spec.js`) is **gated** and skips unless a
throwaway test DB is provided.

## ⚠️ Never point this at production

Use a **disposable** database with no real customer data:
- a **Supabase branch** (clones the schema, no prod data; ~$0.01344/hr — create, run, delete), or
- a **dedicated test project**.

The suite seeds and deletes its own run-stamped rows
(`SO-E2E-<ts>` / `cust-e2e-<ts>`), but it still issues real writes — so isolation matters.

## Switching it on

Provide two values pointing at the test DB:

| Var | What |
|---|---|
| `E2E_SUPABASE_URL` | Test DB API URL |
| `E2E_SUPABASE_ANON_KEY` | Test DB anon key |

`playwright.config.js` maps these onto the app's `REACT_APP_SUPABASE_*` so the
app under test talks to the same DB the spec seeds/verifies.

**Locally:**

```sh
E2E_SUPABASE_URL=https://<ref>.supabase.co \
E2E_SUPABASE_ANON_KEY=<anon-key> \
npx playwright test e2e/14-persistence-db-roundtrip.spec.js
```

**In CI:** add the two as repo secrets, then run the **Persistence DB
Round-trip** workflow (`.github/workflows/persistence-db.yml`, manual trigger).
Without the secrets it safely skips.

## Status

Authored against the known schema (`sales_orders` / `so_items` / `customers`)
but **not yet executed against a live DB**. The first run on a test branch is
the validation pass — selectors and the memo-field edit step may need a small
touch-up then. Once green, promote the workflow from manual to scheduled/PR.
