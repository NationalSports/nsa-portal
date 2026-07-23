# Fake-order tests for the cart bot

Test the Adidas CLICK cart bot end-to-end **without touching the real portal**.
`mock-portal.mjs` is a behavior-faithful local clone of the CLICK flow the
`prompts/add_to_cart.md` prompt drives: login → search all SKUs at once →
"ADD ALL TO CART" → cart with Customer PO #, Delivery Location (default
warehouse / one-time address), Delivery Dates chip, and per-product size grids.

Portal behaviors the mock reproduces on purpose:
- The PO field pre-fills with an account name ("FPU Soccer") that must be replaced.
- A size cell only saves on blur — a typed-but-never-blurred value is lost
  (this is how the real portal lost the last size cell; the prompt's
  blur + reload read-back rule exists because of it).
- Changing the delivery date clears entered quantities and re-checks
  availability (a backordered cell becomes enterable once the chosen date
  reaches its restock date).
- Fixture SKUs: `JW6608` (all in stock), `JW6600` (L restocks in 7 days —
  short backorder), `KB5529` (M restocks in 30 days — must be skipped),
  `KE9493` (all hatched, no date — genuinely unavailable).

Everything the bot does is recorded at `GET /api/state`, including whether
SUBMIT ORDER was ever pressed (a passing run requires it wasn't).

## Run

```bash
npm run test:harness   # deterministic Playwright drive of the mock (~10s)
npm run test:agent     # full dress rehearsal: real claude CLI + production
                       # prompt vs the mock, then graded (~5 min, uses tokens)
WORKER_MODEL=haiku npm run test:agent   # cheaper/faster model
```

`test:agent` spawns `claude` exactly like `worker.js` does (same flags, same
prompt built by `lib.js`) and grades the recorded portal state: add-all used,
PO replaced, address correct, delivery date shifted for the ≤14-day backorder,
exact per-size quantities, the >14-day SKU skipped with `needs_input`, and no
submit. Chromium comes from `/opt/pw-browsers/chromium` (Claude Code cloud) —
on another machine, adjust `executablePath` in `spec.mjs` and
`--executable-path` in `mcp.test.json`, or remove them if `npx playwright
install chromium` browsers are present.

Note: if running as root (containers), the claude CLI refuses
`--dangerously-skip-permissions`; prefix with `IS_SANDBOX=1`.
