# System Audit: Where Careful Rebuilds & Targeted Improvements Pay Off Most

**Date:** 2026-07-03
**Scope:** Full-system survey — architecture, money paths, art approval, persistence/sync, security posture, testing, migrations. Synthesizes prior audit docs (`ART_APPROVAL_BUSINESS_LOGIC_AUDIT_2026-07-02.md`, `WEBSTORE_MONEY_AUDIT_2026-07-02.md`, `DATA_PERSISTENCE_AUDIT_2026-06-09.md`, `SYNC_TROUBLESHOOTING.md`, and others) with fresh code exploration.

## The meta-signal

In the last month this repo merged **140 PRs**, and **~96 commits carry fix/bug/broken language** — roughly half of all work is patching regressions. The exploration below points to a single dominant cause: **deliberately duplicated logic that must be kept in sync by hand**. `App.js` alone contains **99 comments saying "mirrors / shared by / keep in sync / must match"**. Every feature touch risks desyncing a copy, and the fix-churn is the tax. The highest-leverage work is anything that collapses a hand-synced copy into a single source of truth.

Ranked below: two **careful rebuilds** (large, sequenced, high payoff) and five **targeted improvements** (surgical, days not weeks).

---

## Rebuild 1 — Decompose `App.js` (the force multiplier)

`src/App.js` is 33,526 lines, and it is not "a big file with many components" — it is **one 29,660-line React function** (`App()`, line 3864 → EOF):

- **~320 `useState` hooks** in one component scope; zero `createContext`/`useContext`. Pages are `rXxx()` closures over `App()`'s scope, dispatched by a `pg===` switch at line 33018.
- The largest closures are file-sized on their own: `rImport` ~4,600 lines, `rWarehouse` ~3,080, `rReports` ~2,130, `rArtist` ~1,800, `rInvoices` ~1,520.
- The `OrderEditor` mount passes **~84 props** (state slices plus ~40 callbacks) because there is no context/store boundary.
- **241 inline `supabase.from()` calls** and ~210 `_dbSave*` handlers live inside the component — the entire bespoke persistence/sync engine (diff engine, polling, realtime, conflict healing) is embedded in UI code.
- Single JSX lines up to **4,085 characters** (line 9742); 43 `eslint-disable`s; ~76% of the file is business/persistence logic, not markup.
- Known hazard from the 06-09 persistence audit: **literal control bytes near lines 24472/24474** make ripgrep treat the file as binary — greps silently miss the last ~4,000 lines. Tooling (and reviewers) are partially blind inside this file.

It is also the **churn epicenter**: 115 commits touched it in six months, more than any other file. Nearly every fix-type PR passes through it.

**Why this specifically benefits from a careful rebuild:** extraction is high-risk precisely because state sharing is implicit via closure — pulling a page out silently changes what it can see. Past attempts at this kind of file stall because each step requires holding dozens of closed-over variables in mind at once. The safe sequence:

1. **Extract the persistence/sync layer first** (supabase singleton, `_dbSave*`, diff engine at ~line 1134, polling/backoff at ~505–700, `app_state` handling) into a service/hook module. It's pure logic, touches every page, and is the part with the best existing behavior (the audits repeatedly call the save engine "the strongest part of the system") — preserve it, relocate it.
2. **Introduce Context** for the shared entity collections (`cust`, `sos`, `ests`, `prod`, `cu`, `nf`, `REPS`) to kill the 84-prop `OrderEditor` interface.
3. **Lift `rXxx()` closures into real page components one at a time**, starting with the most self-contained (`rImport`, `rReports`, `rQB`), each behind the stable state interface from step 2. One page per PR, e2e suite green between each.
4. Strip the control bytes (a one-line fix) as step zero so tooling can see the whole file again.

**Payoff:** every other item on this list gets cheaper, review becomes possible, and the "keep in sync" copies lose their reason to exist.

## Rebuild 2 — Unify the money model (one pricing source of truth, integer cents, transactional orders)

The money paths were audited fresh. The payment-confirmation and refund layers are genuinely well built — idempotent PaymentIntents (`webstore-checkout.js:430`), atomic `confirmation_sent` claim shared with the webhook (`:490`, `stripe-webhook.js:52`), row-locked capped deduped refunds (`00164_webstore_refunds_audit.sql:40–82`). The structural risk sits underneath them:

1. **Pricing math is triple-maintained and has already drifted.** `src/pricing.js`, `src/businessLogic.js` (an explicit "mirror of App.js"), and App.js itself each carry totals math. The embroidery cost table `EM.pr` **differs today** between `pricing.js:74` and `businessLogic.js:26` — and the unit tests exercise the mirror, not production. Passing tests validate numbers production doesn't use. Separately, `Storefront.js:28–37,1399` hand-mirrors the server's `priceCart` byte-for-byte; drift doesn't mischarge (the server is authoritative) but hard-blocks checkout with a permanent "prices were updated" 409.
2. **Float-dollars end-to-end** in the webstore path (`r2 = Math.round(n*100)/100` after every step) while `stripe-payment.js` is cents-native — two money representations in one system.
3. **Order creation is not a transaction.** `placeOrder` inserts order → items → number claims sequentially with a manual three-delete `rollback()` (`webstore-checkout.js:359–416`). No idempotency token on `place_order`: a double-submit creates two orders and two PaymentIntents.
4. **Inventory is check-then-act and fails open** (`checkStock` at `:141`, fail-open at `:148`), with no decrement or reservation — concurrent buyers oversell. Only jersey numbers have an atomic claim.
5. **Refund-then-record ordering** (`stripe-payment.js:222` → `:235`): if the RPC fails after Stripe succeeds, money moved but nothing recorded.

**Why now:** per the 07-02 money audit, native card checkout has not yet carried real payment volume — these bugs are latent and **will fire the moment real card orders flow**. Rebuilding before that is dramatically cheaper than after.

**Shape of the rebuild:** one shared pricing module (integer cents) imported by server, client, and tests, killing the mirrors; `place_order` as a single Postgres stored proc (order + items + claims + optional stock reservation, modeled on the existing number-claim and refund-RPC patterns, which are already the right idea); client displays server-quoted totals (a `quote` action already exists at `webstore-checkout.js:451–468`) instead of recomputing them.

## Targeted improvement 1 — Art approval as a real state machine

The single most-repeated bug class in the art audits: **forward transitions silently clobber a coach rejection** (root cause of SO-1199; recurs as H3/M1/M2/M4/L1 across two audit docs), because `art_status` transitions are scattered across many call sites with inconsistent gates, and a second status field (`so_art_files.status`) drifts from the first. Compounding it: `mock_links` is **written by the UI and read by the approval gate but never persisted** (stripped by `_pick`/`_artCols`, no DB column) — passes in-session, reverts on reload.

The fix is not many patches; it's one careful piece of design: a **single server-side transition function** (Postgres RPC, like the refund RPC) that owns every `art_status` change, refuses illegal transitions (approve-after-recall, forward-over-rejection), clears/records `coach_rejected` explicitly, and pins coach approval to a specific mockup version (closes open findings H1/H2). All UI paths — buttons, dropdown, coach portal links — call it. This is a bounded, high-care design task with an outsized bug-class kill rate.

## Targeted improvement 2 — Security hardening sweep (RLS + unauthenticated functions)

Every persistence/webstore audit's #1 finding, still open and compounding:

- The shipped anon key grants ~41 anon SELECT and 13–16 public `FOR ALL USING(true)` policies — the database is effectively public. The migration-011 "dev placeholder" RLS on `webstore_*` was never hardened.
- Unauthenticated server functions flagged 06-10 and confirmed still live 07-02: ShipStation webhook (leaks API creds), `stripe-payment` open `refund` action, `pdf-generator`, `receipt`, `image-proxy` (SSRF), `brevo-proxy` (open email relay), `qb-api` (client-supplied tokens), `taxcloud-capture` (double-reports filings).

This is not a rebuild — it's a systematic, table-by-table and function-by-function pass with a policy matrix (who may read/write each table) written first, then applied as migrations through the CLI flow so it survives the drift checker. Tedious, breakage-prone at the edges (anon storefront reads must keep working), and exactly the kind of exhaustive-but-careful sweep worth doing in one concerted effort rather than continuing to re-flag it audit after audit.

## Targeted improvement 3 — Make the tests test production

- `src/__tests__/businessLogic.test.js` tests the **mirror module**, whose constants have drifted from production `pricing.js` — false-confidence coverage. `calcOrderTotals` (the actual production source of truth) is never directly tested.
- Per the 06-09 audit, the suite went **red on `main`** and stayed red across many merges because CI wasn't gating PRs. Workflows exist now (`.github/workflows/test.yml`, `schema-drift.yml`) — verify they're required checks on PRs, not just present.
- Zero coverage on: `stripe-payment.js`, `stripe-webhook.js`, `reconcileInvoiceFromIntent`, the `placeOrder` rollback path, `calcTax`/`procFee`, and the finalize amount-verification branch — i.e., the money-moving code.

Do this **before or alongside Rebuild 2** — the shared pricing module is only trustworthy if the tests import the same module production does.

## Targeted improvement 4 — Persistence guardrails (kill the silent-loss patterns)

Three recurring silent-data-loss patterns from the persistence audits, each fixable systematically:

1. **"Editor lies" saves** — `setO(x); onSave(x); setDirty(false)` at 30+ sites reports success on failed writes. Fix once in the (extracted) save layer: `setDirty(false)` only on confirmed write.
2. **Hand-maintained column whitelists** (`_pick`, `_estCols`, `_soCols`, `_artCols`…) silently drop any field not wired into 2–3 places — the direct cause of the `mock_links` bug. Generate the whitelists from the schema (the Supabase types generator or a build step against `supabase/migrations/`), so a new column can't silently vanish.
3. **`app_state` blobs are last-write-wins with no version guard** (`_saveAppState`, App.js:5407) — two tabs editing `batch_pos` clobber each other; the `_batchPosDirtyUntil` dirty-window is a patch, not a fix. Add per-key `_version` compare-and-swap, mirroring what the relational tables already do well.

## Targeted improvement 5 — Number claims, store lifecycle, and checkout dead-ends

Smaller webstore items repeatedly flagged and still open: number claims never released on abandoned/refunded/edited orders (permanent jersey-number squatting); `so_creation` scheduling is a no-op; stores don't auto-close; `require_login` never enforced; sold-out one-size/bundle items skip stock checks; the `totals_changed` 409 is a permanent dead-end for the buyer. Each is small; bundling them into one focused pass closes out most of the ⟳ items carried between the 06-10 and 07-02 audits.

---

## What NOT to rebuild

- **The client-side save engine's behavior** (quasi-transactional saves, `_version` concurrency, conflict healing, failed-ID retry) — every audit calls it the strongest part of the system. Relocate it out of App.js (Rebuild 1, step 1); don't redesign it.
- **Payment confirmation & refund RPC layers** — already well-architected; use them as the template for `place_order` and the art-status RPC.
- **Vendor integration pattern** (`*-proxy` / `*-sync-background` / `*-sync-cron` triad) — consistent and uniformly error-handled across ~10 vendors. The hard-coded price tables inside sync functions are debt, but low-urgency.
- **Migration tooling** — the legacy duplicate-numbered root SQL files are frozen history; the live `supabase/migrations/` + `check-schema-drift.js` + baseline flow already contains the drift risk. Optionally sweep the root files into an `archive/` dir for hygiene.

## Suggested sequencing

| Order | Item | Size | Why this order |
|-------|------|------|----------------|
| 1 | Security sweep (RLS + open functions) | ~1 wk | Live exposure today; independent of everything else |
| 2 | Test honesty + shared pricing module | ~3–4 days | Prerequisite for money rebuild; kills the drifted mirror |
| 3 | Money rebuild (cents, `place_order` proc, idempotency, reservation) | ~1–2 wks | Before real card volume arrives |
| 4 | Art-status state machine RPC | ~3–4 days | Kills the #1 recurring bug class |
| 5 | App.js decomposition (persistence layer → Context → pages) | ongoing, PR-per-page | Force multiplier; safest done incrementally behind green e2e |
| 6 | Persistence guardrails + webstore loose ends | interleave | Small, bounded passes |
