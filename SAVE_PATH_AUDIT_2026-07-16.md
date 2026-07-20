# Save-Path Audit — 2026-07-16

**Scope:** every save/write path in the portal — the client persistence engine
(`src/lib/dbEngine.js`), the `_dbSave*` handlers and direct writes in `App.js` /
`OrderEditor.js`, the page-level direct-write surfaces (`Webstores.js`, `OmgOrderPortal.js`,
`RosterOrders.js`, storefront/coach pages), the server-side save paths
(`netlify/functions/*`, save RPCs in `supabase/migrations/`), and specifically whether the
SO-1514 bug class is actually closed.

**Method:** Playbook B from `FABLE_WORKING_PROCESS.md` — six independent finder passes
(engine concurrency, App.js handlers, Webstores, secondary pages, server-side, SO-1514
fix-chain trace), each candidate then judged by a separate adversarial verification pass
instructed to refute it. ~45 candidates were raised; verdicts below distinguish
**CONFIRMED** (trigger named, vulnerable line quoted, guard absence verified),
**PLAUSIBLE** (mechanism real, trigger not fully provable statically), and refuted items
(§6). Prior audits (`DATA_PERSISTENCE_AUDIT_*`, `WEBSTORE_MONEY_AUDIT_2026-07-02`,
`FABLE_SYSTEM_AUDIT_2026-07-03`, `PROMO_FUNDS_AUDIT_2026-07-06`) were inventoried first;
findings below are new, or previously-known items re-verified as still open where they
intersect the save surface.

---

## 1. Executive summary

**The SO-1514 class is not closed.** The specific loop shipped in PR #1677 is fixed, but
the underlying class — stale-client-state saves silently overwriting server truth — has
confirmed open instances on invoices (never fixed), estimates and `so_jobs` (fixes written
but their migrations are marked **"FILE ONLY, NOT YET APPLIED"**), and quantity edits
(the hydration guard added for SKU swaps was never added to `uSz`). None of the three core
SO-1514 fixes has test coverage.

Beyond that class, the audit confirmed three structural weaknesses that generate most of
the individual findings:

1. **The version/outbox safety net has holes at its own seams** — the client version check
   fails open on exceptions (SOs/invoices), safety-guard blocks don't capture the blocked
   edit durably, and customer conflicts silently drop the edit.
2. **Money side-tables have no concurrency protection at all** — promo periods, credits,
   commission snapshots, and webstore transfers are plain read-modify-write upserts with
   fire-and-forget error handling; the UI reports success regardless.
3. **Page-level direct writes bypass the engine** and either race it (OMG portal's
   `sales_orders` write is provably reverted by any staff tab's next save) or swallow
   partial failures on multi-write sequences (label/void flows, roster cloning).

Counts: **24 confirmed findings** (5 rated critical), 4 plausible, 5 refuted.

---

## 2. Is SO-1514 closed? — fix-chain verdicts

| Commit | Invariant added | Verdict |
|---|---|---|
| `dec9892` SO id collision → insert-not-upsert | New SOs INSERT, fail loud on 23505, re-mint | ✅ Closed for SOs — **but never ported to invoices (F1)** |
| `425b2a4` estimate create-collision guard | `save_estimate p_is_new` + client re-mint | ⚠️ Client code ready; **migration 00195 marked NOT APPLIED → inert (F2)** |
| `04d42f8` cross-type over-commit guard | New PO/pick lines trimmed to ordered sizes | ⚠️ Client-side only; cross-tab TOCTOU remains (F13); no DB constraint |
| `743afa3` block SKU change while unhydrated | SKU swaps gated on `_picksHydrated`/`_posHydrated` | ⚠️ Only the two SKU entry points; **qty edits unguarded (F3)** |
| `1ebe476` deterministic paging | `id` tiebreaker on every `.range()` | ✅ Closed (truncation blindness is separate — F20) |
| `8635163` outbox base-version poisoning | `_obBaseVersion` at all 4 auto-heal sites | ✅ Closed — verified exactly 4 heal sites, no 5th; art-file and app_state paths verified not in the risk class |

**Test honesty:** the tests import the real `dbEngine` module (not a mirror — good), but
only the boot-time outbox gate is covered. The id-collision insert branch, the over-commit
trim, and the hydration-gated SKU block have **zero unit or e2e coverage** — a regression
in any of them would ship silently.

---

## 3. Critical findings

### F1 — Invoice id collision: SO-1514 shape, never fixed  `CONFIRMED`
`nextInvId` (App.js:225) mints from `_dbMaxIds.inv`, synced **once** at initial load
(App.js:2250) — there is no `_refreshInvMaxId` and no poll/realtime refresh.
`_dbSaveInvoiceInner` does a bare `supabase.from('invoices').upsert(invRow,{onConflict:'id'})`
(dbEngine.js:1879) with no `_isNewInv` insert branch — contrast the SO fix at
dbEngine.js:1110 (`_isNewSO?insert:upsert` + 23505 re-mint). Two tabs creating invoices
concurrently: the second silently replaces the first invoice's header (customer, SO link,
totals). This is the exact incident shape of SO-1514, on the money document of record.

### F2 — The two protective migrations are written but not applied  `CONFIRMED (repo evidence)`
`supabase/migrations/00194_so_jobs_version.sql:1` and
`00195_save_estimate_create_flag.sql:1` both open with **"FILE ONLY, NOT YET APPLIED."**
They are the two highest-numbered migrations; nothing later supersedes them. Consequences
while unapplied:
- **Estimates:** the client's re-mint-on-collision logic (dbEngine.js:906-921) falls back
  via `_fnMissing` to the old `save_estimate`, whose `ON CONFLICT (id) DO UPDATE` silently
  overwrites on id collision — 425b2a4 is inert in production.
- **so_jobs:** persistence is a blind whole-row upsert (dbEngine.js:1592) protected only by
  re-injection of 4 coach columns (1580-1590); every other job column (`art_status`, deco
  fields, notes) is open to stale-tab overwrite with no conflict signal.
*Assumption to verify:* applied-status is asserted from the repo's own headers; confirming
against the live database (`list_migrations`) is a 2-minute check and should be step one
of remediation.

### F3 — Qty edits bypass the SO-1514 hydration guard  `CONFIRMED`
`uSz` (OrderEditor.js:2273) floors size reductions using `safePicks(item)` /
`item.po_lines` from client state with **no** `_picksHydrated`/`_posHydrated` check — the
exact guard the SKU-swap paths got in 743afa3 (OrderEditor.js:2027, 2060). On a tab whose
pick/PO hydration timed out, `committed` computes 0 and a size can be shrunk below what is
picked/ordered. The save-side over-commit guard does **not** catch it: it only trims
*newly introduced* lines (`if(!_newLines.length)return`, dbEngine.js:1529) and never
validates `it.sizes` against pre-existing committed lines. Silent under-commit reaches the
DB — the same root cause as the original SO-1514 Gildan incident, open on a different verb.

### F4 — Concurrent-refund double-spend window (Stripe before cap-under-lock)  `CONFIRMED`
`stripe-payment.js:219-225` computes `remainingCents` from an **unlocked** SELECT, then
calls Stripe (:230-238), and only afterwards `apply_webstore_refund` (which takes
`FOR UPDATE` and enforces the cap — 00164:56). Two admin tabs (the client latch at
Webstores.js:2554-2581 is per-tab only) can each pass the stale pre-check, both move real
money at Stripe, and only the second *recording* is rejected — surfaced as "Refund was
issued but recording it failed — contact an admin" (:250), i.e. money out exceeds the
order total pending manual cleanup. Auth on the action is present (`verifyUser`/
`verifyAdmin` — the older "open refund action" concern is fixed). Fix direction: reserve
the refund in the DB (locked cap check) *before* the Stripe call.

### F5 — Promo funds: unguarded money math, invisible failures  `CONFIRMED`
Three compounding defects on `customer_promo_periods` / `customer_promo_usage`:
- **Lost deductions:** `period.used` is authoritative (balances everywhere compute
  `allocated - used`; nothing derives from the usage ledger — CustDetail.js:606,
  OrderEditor.js:3680), yet `_dbSavePromoPeriod` (dbEngine.js:2141-2150) is a bare upsert
  with no `_checkVersion`. Two tabs applying $500 each from a $1000 period: last writer
  wins, one deduction vanishes, no error.
- **Fire-and-forget with unconditional success UI:** App.js:6064 chains period→usage saves
  without the caller checking either; `setCust` at :6066 applies the deduction to state
  regardless. Credits are worse — App.js:6079-6081 fire both writes with no `.then` at
  all. The UI callbacks (App.js:8448-8449, 8594-8596) await, discard the result, and toast
  success.
- **No safety net:** none of the promo/credit/pending-ship savers are `_outboxWrap`'d
  (contrast dbEngine.js:2079/2248); failures are `console.error`-only — no failed-id, no
  banner, no retry, and a period-save-succeeded/usage-insert-failed split leaves `used`
  inflated with no ledger row and no reconciliation anywhere.
Reversal paths (App.js:6459-6462, 6862-6864) are equally unawaited/unchecked.

---

## 4. High findings

### F6 — Client version check fails open on exception (SOs, invoices)  `CONFIRMED`
`_checkVersion` returns `false` on exception (dbEngine.js:671) and toasts "Save blocked" —
but SO (1078) and invoice (1876) callers only branch on `typeof vc==='number'`, so
`vc===false` **falls through and the save proceeds unverified**, with every
conflict-gated guard downstream (deco restore 1096, stale-content guard 1187) disarmed
because `_versionConflict` stays null. A network blip during the version SELECT converts a
stale save from "blocked" to "applied". (Estimates are protected regardless: the
`save_estimate` RPC enforces the version server-side — this is exactly why the SO/invoice
paths, which have no server-side CAS, need the client check to fail closed.)

### F7 — Blocked/conflicted edits are not captured durably  `CONFIRMED`
Two symmetric holes in the outbox's own capture rule (`_outboxWrap` only outboxes a
failure when `_dbSaveFailedIds.has(id)` — dbEngine.js:2564):
- **Customer version conflict** (2084) returns false without marking the id failed — no
  outbox entry, no conflict card. In-session the pending-ids set still shields it; across
  a reload/tab-close the edit is gone silently.
- **All the item-safety guard branches** (est 779-1155 range: 779-783, 825-828, 838,
  852-855, 881-885; SO: 1150-1154, 1262-1265, 1281-1284, 1300-1302, 1316-1319, 1332-1336,
  1447-1451, 1472-1476) `return false` with only a transient toast — the blocked edit is
  never added to failed-ids or the outbox. The one branch that does it right
  (`_emitOutboxConflict` at 1385-1394) proves the pattern was known and inconsistently
  applied.

### F8 — SO stale-content TOCTOU can still drop a concurrent tab's new item  `CONFIRMED`
The uncovered-items guard (dbEngine.js:1187-1203) runs only when `_versionConflict` is
truthy — captured from the **single** version check at 1078. A concurrent write landing
between that check and the `so_items` re-read at 1146 leaves `_versionConflict` null; the
hydrated branch (1252-1253) then treats the count mismatch as an intentional edit and the
delete/insert swap discards the other session's just-added item. Narrow window, but it is
the SO-1333 incident's mechanism surviving behind a slightly later race.

### F9 — OMG portal's `sales_orders` write is reverted by any staff tab's next save  `CONFIRMED`
`recomputeSOCost` (OmgOrderPortal.js:566) writes `_shipping_cost`/`_shipstation_cost`
directly. Both columns are in `_soCols` (constants.js:6), and `_dbSaveSOInner` upserts the
**full row from the client's in-memory copy** (dbEngine.js:1084→1110). The version heal
updates only `so._version` — there is no re-injection for these columns — so a staff tab
that loaded the SO before the label was printed will, on its next save of *any* field,
silently restore the stale shipping cost. Freight-margin data loss with no error anywhere.

### F10 — Label flows: buy-then-swallow, void-wipes-everything  `CONFIRMED (both portals)`
- **Webstores.js:11026-11031 / OmgOrderPortal.js:599-605:** a real (chargeable) label is
  purchased, then `shipped_qty`/tracking writes run inside `try{}catch{}` with errors
  discarded — a failed write leaves the order looking unshipped, inviting a second label
  purchase for the same units (no idempotency check against an existing shipment id).
  `shipped_qty` is also a stale read-modify-write (OmgOrderPortal.js:599-602).
- **`voidLabel` (Webstores.js:11414-11416) / `voidOmgLabel` (OmgOrderPortal.js:634-636):**
  all three statements scope by `order_id` alone — voiding the *second* label deletes
  every `webstore_shipments` row and reopens already-delivered lines from the first
  shipment (the OMG code's own comment admits "multi-shipment split-voids aren't
  tracked"). Sequential unguarded writes also leave mixed states on interruption
  (items say `bagging`, order still says shipped).
- `label_cost` is overwritten, not summed (Webstores.js:11030) — second label discards the
  first's cost from the SO freight rollup (11036-38); `webstore_shipments` rows carry no
  cost to recover it from.

### F11 — Commission snapshots: override vs re-snap clobber  `CONFIRMED`
`_applyOvrToSnap` / `_resnap` (CommissionsPage.js:265, 274) write the "money of record"
from `snaps` state fetched once at mount (no realtime, no version column on
`commission_snapshots`). Two admin tabs: a `_resnap` full-row upsert silently discards an
override the other tab just applied (the errors are checked — the writes both *succeed*;
that's the problem). The initial freeze's `ignoreDuplicates` guard is correct; the
update paths have nothing.

### F12 — `customers.art_files` has three uncoordinated writers  `CONFIRMED`
Six Webstores.js sites (1628-2411) do SELECT-then-UPDATE on the JSON array with no CAS;
no DB version guard exists for this column (00103 covers only `so_art_files`/
`estimate_art_files`). The engine is a third writer: `art_files` **is** in `_custCols`, so
a staff tab's `_dbSaveCustomer` full-row upsert can overwrite a fresher array written
moments earlier by Webstores (its `_checkVersion` protects only against other engine
writes). Concurrent art uploads/mock bakes lose work silently.

### F13 — Over-commit guard is client-side only  `CONFIRMED`
dbEngine.js:1485-1563 is a per-tab read-then-write; `so_item_po_lines`/
`so_item_pick_lines` have only `allow_all` policies (00007:826-827), no CHECK/trigger.
`_queuedEntitySave` serializes within one tab only. Two tabs can jointly over-commit the
same item — the double-commitment SO-1514 symptom, reachable via a different door.

---

## 5. Medium / notable findings

- **F14 `CONFIRMED`** — Generic `_dbSave` (dbEngine.js:2638) for team_members/vendors/
  issues/rep_csr_assignments/omg_stores: errors console-only, **and the diff snapshot is
  advanced before the save resolves** (App.js:2863-2866 pattern), so a failed write is
  never re-diffed — permanently lost, not retried. A failed rep-deactivation or
  access-change silently doesn't take (security-adjacent for `team_members.access`).
- **F15 `CONFIRMED`** — `invoice_payments` fallback is delete-then-insert with neither
  result checked (dbEngine.js:1914-1918): if the insert fails after the delete, payment
  history is wiped. The file itself documents why this pattern is banned elsewhere
  (1927-1929).
- **F16 `CONFIRMED`** — portal-action.js legacy path: the CAS guard runs only when
  `art_status` is in the patch (:187-193); comment/rejection-only patches write
  unconditionally (:194) — a stale coach tab can append contradictory approval data to a
  job that has moved on. (The pre-00172 approve/reject fallback also leaves split
  job/art states on partial failure — likely dead code if 00172 is applied, same
  verify-in-production caveat as F2.)
- **F17 `CONFIRMED`** — `save_estimate` CAS is fail-open when `p_base_version` is null
  (00195:57-66, same in live 00156): any client holding `_version == null` sails through.
  Plus a statically-verified TOCTOU (no `FOR UPDATE` between check and upsert) rated
  `PLAUSIBLE` for real-world trigger.
- **F18 `CONFIRMED`** — Webstores money-adjacent swallows: transfer-pull stale decrement
  (1778-1786, lost updates on `on_hand`); `priceAllToMargin` (2176-2179) never reads
  errors, flashes full success; `setItemMissing` (11391-11404) empty-catch feeds the ship
  plan (11020) → overship after a silent failure; batched-order edits (2518-2551) have no
  status/so_id gate → webstore order and its SO silently diverge (banner-only); coupon
  percent unclamped on **both** creation (2452) and redemption (webstore-checkout.js:233)
  — a `-10`/`150` coupon surcharges or comps orders (known since 07-02, still open).
- **F19 `CONFIRMED`** — Roster/coach flows: `cloneSession` (RosterOrders.js:1887-1912)
  non-atomic 4-table clone with unchecked inner inserts → cloned seasons with silently
  empty team rosters; `changeStatus` (1484-1501) optimistic + unchecked, reopen email
  fires even when the reopen didn't persist; kit-catalog save (455-469) reports success on
  failure; `removeCoach` (1850-1853) — access revocation optimistic, delete result
  discarded (found identically by two independent passes; not adversarially verified).
  Coach saved orders (AdidasInventory.js:1636-1653): blind full-array update on a
  team-shared row → teammates clobber each other's lines; `submit()` (1208-1213) ignores
  the save result and `catalog-order-request` has no dedup → retry double-emails the rep.
- **F20 `CONFIRMED`** — `_truncatedTables` is consumed **only** by the Reports banner
  (App.js:12774). Commissions, SalesHistory, and the Dashboard aggregate the same
  20k-capped tables (`customer_invoices` is the likely first to truncate) with no warning
  — silent under-reporting once any table hits the cap.
- **F21 `CONFIRMED`** — Load-during-save window: `_dbLoad`'s single `_dbSavingCount>0`
  check (dbEngine.js:280) runs before the save increments the counter (the save does
  session/version network round-trips first — 743-765/1070-1078 vs guard at 769/1079), so
  a poll can read child tables mid-swap. The loader's phantom dedup mitigates but
  tie-breaks wrong when child counts are equal.
- **F22 `CONFIRMED`** — Shared load-state corruption: `_lastLoadTimedOut`/
  `_truncatedTables` are module-level Sets; concurrent `_dbLoad` calls (poll, realtime,
  products reload — no mutex) and orphaned 20s-timeout losers mutate them across each
  other's windows. Worst case is a **false-clean hydration flag**, which disarms the
  empty-wipe save guards — the dangerous direction.
- **F23 `PLAUSIBLE`** — The SO zero-wipe no-op branch (dbEngine.js:1175-1179) clears a
  pre-existing failed-save flag unconditionally (not hydration-gated like its two sibling
  branches), which drops poll-protection for an id that may still hold a different unsaved
  edit. Whether a real edit can reach it with a transiently hollow item list wasn't
  provable statically.
- **F24 `PARTIALLY CONFIRMED`** — `rmI` item delete checks POs but never picks
  (OrderEditor.js:1899). Usually the save-side pick-restore guard converts this to a
  loud save-block; but if another line shares the deleted item's SKU+color,
  `_matchRestoreItem` (dbEngine.js:1030-1047) silently reattaches the orphaned pick to
  the wrong line — misattribution, not orphaning.

---

## 6. Checked and cleared (refuted candidates)

So the next auditor doesn't re-litigate these:
- **Estimate saves surviving a failed client version check** — refuted; the
  `save_estimate` RPC enforces the version server-side regardless (dbEngine.js:909, 930).
- **Stale module-export snapshots** (`_dbSavingCount`/`_bgSync` read via bare imports) —
  refuted; ESM/webpack live bindings verified experimentally. The `_isSessionDead` getter
  comment appears to encode a misconception, not a defect.
- **`_mergeDbEstStatus` poisoning the outbox base version** — refuted; the merge never
  touches `_version`/`_obBaseVersion`, and the gate is version-keyed only.
- **CoachCatalogAccess `customers` bypass clobbering** — the bypass is real but harmless:
  `school_colors`/`allowed_brands` are not in `_custCols`, so engine full-row saves never
  carry them.
- **`place_webstore_order` duplicate orders on retry** — closed: 00170's partial unique
  index on `client_ref` + the storefront always sending `clientRef`
  (Storefront.js:1665-1727). Residual exposure only for pre-00170 cached clients.
- **Webstore refund idempotency for same-attempt retries** — solid (`wsrefund_+attempt_id`
  Stripe key + RPC `FOR UPDATE`); the remaining risk is only the cross-tab race in F4.
- Also verified as fixed since the 07-02 money audit: order-edit tax/fee recompute,
  club-payout basis, refund path moved server-side.

## 7. Recommended remediation order

1. **Apply migrations 00194 + 00195** (after confirming via `list_migrations` they truly
   aren't live). Cheapest step; activates two already-written fixes (F2).
2. **Port the SO id-collision fix to invoices** — `_isNewInv` insert branch + 23505
   re-mint + `_refreshInvMaxId` (F1). Small, mirrors existing code at dbEngine.js:1106-1133.
3. **Add the hydration guard to `uSz`** (and deco edits) exactly as in the SKU-swap paths
   (F3), and make the save-side guard validate shrinks against pre-existing committed
   lines, not just new lines.
4. **Fail closed on `_checkVersion` exceptions** for SOs/invoices (F6) and route every
   safety-block `return false` through `_dbSaveFailedIds.add` + outbox capture (F7).
5. **Promo/credit/commission concurrency** (F5, F11): server-side RPCs with row locks (the
   `apply_webstore_refund` pattern already in the repo), or at minimum `_version` columns
   + `_outboxWrap`. Reserve-before-Stripe for refunds (F4).
6. **Stop page-level writes to engine-owned columns** (F9): route `recomputeSOCost`
   through an RPC or add re-injection for `_shipping_cost`/`_shipstation_cost` at the heal
   site.
7. **Shipment-scoped voids + label idempotency + summed `label_cost`** (F10).
8. Regression tests for the three untested SO-1514 fixes (§2) — they're one silent
   regression away from recurring.

## 8. Coverage and limitations

- Examined: all of `dbEngine.js`; all 93 direct write sites in `App.js` at grep level with
  ~25 deep-read (the ShipStation/bill-application cluster around App.js:21500-24860 got
  only a shallow pass); all ~100 genuine write sites in `Webstores.js` with ~60 deep-read;
  all 52 write sites across the nine secondary files; the nine named serverless functions
  and the save-related RPC migrations. `businessLogic.js` mirrors and the `qb-api`/
  `taxcloud` money paths were out of scope (already documented as open in
  `FABLE_SYSTEM_AUDIT_2026-07-03.md`).
- **Assumed, not verified:** production applied-status of migrations (repo headers only);
  the deployed `save_estimate`/`apply_coach_art_decision` function bodies. Both are
  checkable in minutes against the live project and gate findings F2/F16-F17.
- Findings marked PLAUSIBLE (F17-TOCTOU, F23) have statically-real mechanisms whose
  real-world triggers couldn't be proven without a live reproduction.
