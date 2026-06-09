# Code Audit — 2026-06-09

Follow-up to `DATA_PERSISTENCE_AUDIT_2026-05-25.md` (~180 commits ago). Scope:
full client codebase (`src/`), all server functions (`netlify/functions/*`,
`supabase/functions/*`), live Supabase security/performance posture, tests/CI,
and migration hygiene. **Read-only audit — no code or schema was changed.**
Every finding below was verified against the current code (file:line cited);
live-DB numbers come from the Supabase advisors + `pg_policies` as of today.

Priority legend: **P0** = act now (public abuse / financial / data-loss),
**P1** = should fix soon, **P2** = hygiene.

---

## Executive summary

The save engine in App.js remains the strongest part of the system and has
kept improving (the `_bgSync` shrink-guard fix, promo/credit awaits, the batch
receive index bug is fixed). The risk profile has **shifted to the edges**:

1. **The public storefront checkout trusts the browser end-to-end** — prices,
   totals, and the Stripe charge amount are all client-supplied, and the order
   writes go straight from the browser to the DB via the anon key. (P0)
2. **The unauthenticated Stripe function now also exposes a `refund` action** —
   worse than what the May audit recorded. (P0)
3. **Most May P0s are still open**: always-true RLS (59 policies), the two
   SECURITY DEFINER views, taxcloud-capture idempotency, qb-api client tokens,
   open service-role endpoints. (P0)
4. **New financial-math defects**: the invoice builder ignores the
   reversible/numbers equivalent-quantity (`_nq`) so invoices diverge from SO
   totals; CC surcharges still inflate `inv.total`, and commissions are
   computed from it. (P1)
5. **The test suite is red on `main`** (4 failures), CI doesn't run on PRs,
   and the failing tests guard a **test-only copy** of totals logic that has
   drifted from the (3+) production implementations. (P1 process)
6. **Schema drift recurred**: two migrations were applied to the live DB
   *today* (`webstore_multi_transfers_and_images`) that exist nowhere in this
   repo. (P1 process)

---

## A. Prior-findings scoreboard (May 25 → today)

| May finding | Status | Where now |
|---|---|---|
| RLS effectively public (41 anon SELECT, 13 public ALL, 2 SECDEF views, leaked-pw off) | **OPEN — slightly worse** (public ALL grew 13→16; 59 always-true policies total) | live DB |
| Schema drift (prod ahead of repo) | **RECURRED** (2 live migrations today, no repo counterpart) | live DB |
| `omg_store_products` delete-then-insert, un-awaited | **OPEN** | App.js:3883 |
| SO/estimate commit/rollback deletes unchecked | **OPEN** | App.js:1649–1652, 1190–1191 |
| Batch PO "Confirm Received" wrong-index → full-qty fallback | **FIXED** (render/read index spaces now match via `findIndex`) | App.js:10157, 10161 |
| CC surcharge added into `inv.total` | **OPEN** (and commissions read `inv.total`) | App.js:10607–10612, 14124 |
| Final invoice closes SO without checking invoice save | **OPEN** | OrderEditor.js:5455–5457 |
| Editor `setDirty(false)` regardless of save result | **OPEN** (30+ sites; app-level failed-ID tracker is the only backstop) | OrderEditor.js:138 etc. |
| Money/qty from uncontrolled DOM inputs at save time | **OPEN** | OrderEditor.js:5938–6264, 9061–9976 |
| Ship-modal merge drops sizes already in a box | **OPEN** | App.js:17217–17218 |
| UPS pickup loop saves from stale SO snapshot | **OPEN** | App.js:15620–15627 |
| Inventory CSV writes 0 for non-numeric cells | **OPEN** | App.js:20960 |
| `Date.now()` IDs (batch PO, messages) | **OPEN** | OrderEditor.js:6219; App.js:3356, 3370 |
| Promo/credit usage fire-and-forget | **IMPROVED** (now awaited in promo close flow) | OrderEditor.js:2633–2634, 2725–2726 |
| stripe-payment: no auth / idempotency / ceiling | **OPEN + WORSE** (open `refund` action found) | netlify/functions/stripe-payment.js:42–80 |
| taxcloud-capture: no idempotency, always 200 | **OPEN** | supabase/functions/taxcloud-capture |
| qb-api: client-supplied token mutations | **OPEN** | netlify/functions/qb-api.js |
| omg-store-ingest: unauth delete-then-insert | **OPEN** | netlify/functions/omg-store-ingest.js:155–174 |
| create-quote-request / portal-action: unauth service-role | **OPEN** | both files |
| send-scheduled-emails: duplicate-send window | **OPEN** | supabase/functions/send-scheduled-emails |
| richardson-inventory hardcoded key | **FIXED** (env-required, throws if unset) | netlify/functions/richardson-inventory.js |

---

## B. New P0 findings

### B1. Public storefront checkout is client-trusted end to end
`src/storefront/Storefront.js:657–696` (+ `stripe-payment.js`)

- **Prices/totals are computed in the browser from cart state** (`:658–662`)
  and written as-is to `webstore_orders`. The Stripe PaymentIntent amount is
  also client-supplied (`stripe-payment.js:44–51` floor-checks $0.50 only).
  Anyone can pay $0.50 for a $500 cart by editing cart state — the order will
  insert as `paid` with tampered `unit_price`/`total`.
- **`webstore_order_items` insert result is never checked** (`:682`). If the
  order header inserts but items fail, the result is a *paid* order with no
  line items — charged customer, nothing to fulfill, no alert.
- **Jersey-number claim failure leaves a paid orphan order** (`:688–691`).
  Claims are inserted *after* the order; on a duplicate-number conflict the
  function returns an error but never cleans up the already-inserted (often
  already-charged) order + items.
- **Coupon redemption is a read-modify-write race with swallowed errors**
  (`:693`): `used_count: coupon.used_count + 1` from stale client state inside
  `try{...}catch{}` — concurrent redemptions under-count, so `max_uses` is not
  actually enforced.

Fix shape: move checkout to a server function (verify prices from
`webstore_products`, compute the total, create the PaymentIntent server-side,
insert order+items+claims with rollback on failure, increment coupons
atomically e.g. RPC `used_count = used_count + 1`). This also unblocks
tightening anon RLS to SELECT + nothing else.

### B2. `stripe-payment.js` exposes an unauthenticated `refund` action
`netlify/functions/stripe-payment.js:72+`. Any internet caller who learns a
PaymentIntent id (receipts, logs, support emails) can refund it, full or
partial, with zero auth. Combined with the existing no-auth `create_intent`
(no idempotency key, no ceiling, caller-set `receipt_email`), this function
needs caller auth before anything else.

### B3. `brevo-proxy.js` is an open email relay
`netlify/functions/brevo-proxy.js:49–58`: the default endpoint forwards any
POST body to Brevo's send-email API with the server's key. Anyone can send
arbitrary mail (phishing) from the company's verified sender domain, and burn
the Brevo quota. Needs caller auth (it's only used by the logged-in app).

### B4. Carryover P0s (unchanged, see scoreboard)
Always-true RLS posture (the umbrella issue behind B1), `taxcloud-capture`
double-reporting tax filings, `qb-api` client-token mutations.

---

## C. New P1 findings (financial / data integrity)

1. **Invoice builder ignores equivalent quantity (`_nq`/reversible)** —
   `OrderEditor.js:5218` and `:5238` compute deco revenue as `qty * dp2.sell`,
   while SO totals use `eq = dp._nq ?? (reversible ? q*2 : q)` (App.js:12067,
   businessLogic.js:300). Invoices for reversible art / roster-numbers /
   front-and-back names bill the wrong deco amount and shipping/tax proration
   inherits the error. (The recent `dP()` fix commits covered PDFs but not
   this modal.)
2. **Commissions are paid on CC surcharges** — each card payment does
   `total = total + fee` (App.js:10607–10612); commission GP reads `inv.total`
   (App.js:14107, 14124–14125) without subtracting `cc_fee`. Reps earn ~3% of
   every card payment as phantom GP. Fix: stop mutating `total` (track fee in
   `cc_fee`/payments only), or subtract `cc_fee` in the GP lines.
3. **Final invoice marks the SO complete without confirming the invoice
   persisted** — OrderEditor.js:5455–5457 (`onInv` is fire-and-forget). A
   failed invoice insert leaves a completed SO with unbilled work. The
   app-level `_dbSaveFailedIds` banner is the only backstop.
4. **Webstore refunds can double-process** — `src/Webstores.js:507–523`
   computes `refunded = order.refunded_amt + amount` from React state with no
   in-flight guard and no optimistic-lock predicate; a double-click issues two
   Stripe refunds but records one. Add a busy-latch + `.eq('refunded_amt',
   prior)` guard.
5. **UPS pickup poller saves from a stale SO snapshot** — App.js:15620–15627;
   multiple shipments on one SO overwrite each other's `carrier_picked_up`.
   Group by SO (the receive flow already does this).
6. **Ship-modal box merge drops sizes** — App.js:17217–17218 rebuilds `sizes`
   from only the incoming item's sizes; sizes already in the box but absent
   from the add are lost → undercounted boxes.
7. **`omg_store_products` non-atomic replace, both tiers** — App.js:3883
   (un-awaited delete-then-insert, delete error unchecked) and
   `omg-store-ingest.js:155–174` (same, plus unauthenticated, returns 200 on
   failure). `omg-player-report-ingest.js:124+` repeats the pattern for order
   line items.
8. **`omg-order-enrich.js` lets unauthenticated callers overwrite buyer
   emails** (service-role; `saleCode` is guessable; `buyer_email` is always
   overwritten when supplied) — order-notification interception.
9. **Editor reports "saved" on failed saves** — the pervasive
   `setO(x); onSave(x); setDirty(false)` pattern (30+ sites) plus
   fire-and-forget `onInv`. Make `onSave`/`onInv` return and check the
   `_dbSave*` promise result.
10. **Webstores tracking/label-cost update swallowed** — Webstores.js:1752
    `try{await ...update(...)}catch{}` — a paid label with no recorded
    tracking and no alert.
11. **Carryover**: `portal-action` (any caller can patch any SO / approve any
    estimate), `create-quote-request` (forgeable identity), and
    `send-scheduled-emails` (duplicate-send window) are all still as the May
    audit described.

---

## D. P2 (hygiene — selected)

- Commit/rollback deletes in the SO/estimate save engine still unchecked
  (App.js:1649–1652, 1190–1191) → duplicate line items if a commit-delete
  fails; invisible because the post-verify doesn't re-count after delete.
- Money/qty still read from uncontrolled DOM inputs (`defaultValue` +
  `getElementById` at save) across PO create/receive/cancel/shipment-edit.
- Invoice totals round only at save; intermediate `grossTotal`/proration use
  unrounded floats (OrderEditor.js:5234–5266) → cent-level display/DB drift.
- Inventory CSV import coerces non-numeric cells to 0 (App.js:20960).
- `Date.now()` ids for batch POs / issues / messages.
- `sanmar-pricing-sync.js:127` / `ss-pricing-sync.js:38` build PostgREST
  `in.(...)` filters by string-concatenating vendor ids (internal data, so not
  injection, but URL-encode them).
- `vectorizer-proxy.js` is unauthenticated → third-party credit burn.
- **App.js contains literal control bytes** (lines ~24472/24474, regex char
  classes written as raw bytes). ripgrep treats the file as binary and stops
  there — greps silently miss the last ~4,000 lines. Replace with escaped
  `\x00`-style sequences.
- Performance advisors: 48 unused indexes, 10 unindexed FKs, 29 tables with
  multiple permissive policies, 3 `auth_rls_initplan` warnings.

---

## E. Tests, CI, and duplicated business logic

- **4 tests fail on `main`** (304 pass): three are explicit regression guards
  for the legacy `items[].po_lines` outside-deco cost path, which
  `businessLogic.calcTotals` (`:284–314`) no longer reads (it only reads
  `so.deco_pos`); one is `buildJobs` now creating jobs for name decorations
  (the deco-name-method change) with the old expectation never updated.
- **`businessLogic.calcTotals`/`createInvoice` are dead code in production** —
  no app module imports them (App.js imports only the job/QB helpers). The
  real totals math exists in at least three places: App.js `soCalc`
  (:12061–12069), the OrderEditor invoice modal (:5213–5266), and the
  businessLogic copy. They already disagree (see C1). Extract ONE shared
  totals module, use it everywhere, and the failing tests become meaningful
  again.
- **CI never runs on pull requests** (`.github/workflows/test.yml`: push to
  `main` + daily cron only) — which is how the suite went red silently across
  ~1,100 merged PRs. Add `pull_request` to the trigger.

## F. Migration hygiene

- `supabase/migrations/` has **13 duplicate number prefixes** (three files
  share `00059`; `00028/29/60/65/66/69/70/88/92/94/98/104` are doubled) —
  lexical ordering is ambiguous and the directory can't be replayed cleanly.
- **~38 loose SQL files at the repo root** (`supabase_migration_*.sql`,
  including the entire webstore schema) never moved into the canonical dir.
- Live DB has migrations applied **today** with no repo counterpart
  (`webstore_products_multi_transfers_and_images`,
  `webstore_multi_transfers_and_images`), plus two migrations applied twice.
  Adopt one rule: every schema change lands as a timestamped file in
  `supabase/migrations/` in the same PR as the code that uses it.

---

## G. What's solid (no action needed)

- The quasi-transactional SO/estimate save engine: insert→verify→commit/
  rollback, failed-ID tracking + backoff retry + `beforeunload` guard,
  per-entity save queue, `_version` optimistic concurrency on art files,
  hydration flags preventing empty-wipe, boot-time snapshot regression scan,
  localStorage quota budgeting, `_safeQuery` paged reads. The `_bgSync`
  shrink-guard now correctly allows intentional deletions.
- Webhooks that should verify signatures do: `stripe-webhook` (sig +
  idempotent on `pi.id`), `shipstation-webhook` (Basic + idempotent),
  `slack-reply` (HMAC). `team-invite`/`team-deactivate`/`team-list` use
  `verifyAdmin()`. `image-proxy` has a domain allowlist. `qb-callback` is
  idempotent. `daily-backup`, `taxcloud-lookup/refresh` budget correctly.
- `businessLogic.js` pure functions + 300 passing tests (pricing tiers, SO
  status, promo dollars, job grouping) — well-tested where it's actually used.
- `safeHelpers.js`, `pricing.js` localStorage version-gating, recent
  reversible-×2 fixes in PDFs/portal, double-click latches on PO creation,
  `oRef`-based async handlers in the editor.

---

## H. Recommended fix order

1. **Auth on `stripe-payment.js`** (esp. kill the open refund), idempotency
   key + amount ceiling. *(small)*
2. **Auth on `brevo-proxy.js`** (and `vectorizer-proxy`, `omg-order-enrich`,
   `omg-store-ingest`, `create-quote-request`, `portal-action` + alpha-tag
   scoping). A shared `verifyUser()` in `_shared.js` covers all of them. *(small–medium)*
3. **Server-side storefront checkout** (price verification + transactional
   order/items/claims + atomic coupon increment). *(medium)*
4. **RLS migration**: move data tables to `authenticated`, scope anon to the
   storefront's exact needs, recreate the 2 views as `security_invoker`,
   enable leaked-password protection. Test behind a preview. *(medium, the May
   plan still applies)*
5. **Invoice `_nq` fix** at OrderEditor.js:5218/5238. *(small, real dollars)*
6. **Stop adding CC fees to `inv.total`** (or subtract `cc_fee` in GP/commission). *(small)*
7. **Make final-invoice → SO-complete conditional on the invoice save**; have
   `onSave`/`onInv` surface results to the editor (kills the false
   `setDirty(false)` class too). *(medium)*
8. **Refund double-process guard** in Webstores.js. *(small)*
9. **TaxCloud idempotency** + error propagation; **qb-api** server-side
   tokens. *(medium)*
10. **One shared totals module** + fix/realign the 4 red tests + run CI on
    PRs. *(medium, prevents the next regression class)*
11. Remaining P1 mechanics: UPS pickup grouping, ship-merge sizes, OMG
    replaces → upsert-style, tracking-update check. *(small each)*
12. Migration hygiene: renumber dupes, move root SQL into
    `supabase/migrations/`, commit today's live drift. *(small)*
