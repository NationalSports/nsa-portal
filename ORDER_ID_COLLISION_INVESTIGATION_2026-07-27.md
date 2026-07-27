# Order ID Collision Investigation — 2026-07-27

**Trigger:** Rachel Najara on SO-1507 — *"Something is going on with this order. It is for Express
rec soccer balls, but it shows input by Sharon and the memo says JV uniforms?"* Steve: *"all kinds
of orders have issues like this."*

**Method:** forensic reconstruction from `public.audit_log` plus a read of the save paths in
`src/lib/dbEngine.js`. Claims marked CONFIRMED have a specific audit row or a quoted line of code
behind them. Inference is marked as such.

**This is a different defect from `ORDERS_DATA_LOSS_INVESTIGATION_2026-07-27.md`.** That one is
about *line items* disappearing from one order. This one is about *two different orders being
issued the same number* and overwriting each other. They share a root theme (client-side writes
with no server-side arbitration) but neither fix addresses the other.

---

## 1. Executive summary

**SO-1507 is two different orders that collided on one number.** Rachel created it at 10:34 AM on
Jul 13 for **Encinitas Express Soccer** ("Rec Ball Order", 300 size-4 + 30 size-5 STARLANCER
soccer balls) and ran it to `complete` by 10:38. Six minutes later Sharon's browser — which had
been open since before Rachel created it — minted the *same* number for a new **Clovis South Girls
Volleyball** "JV Uniforms" order and saved. That save **overwrote Rachel's order header** while the
item-write guards blocked the item swap, leaving Rachel's soccer balls sitting under Sharon's
header. That is exactly what Rachel is looking at. CONFIRMED.

**Neither order was intact.** Encinitas's rec-ball order lost its identity — along with its tax rate
and ship-to address, which had become Clovis South's; Clovis South's JV Uniforms order never got its
line items and exists nowhere else.

**Scope: 8 sales orders and 9 estimates** across at least 9 users, Jun 26 – Jul 22. Several show
sessions *ping-ponging* — two users each holding "their" order at the same number, alternately
stomping each other for up to 20 minutes (SO-1437 had **four** competing identities; EST-1645 flipped
7 times).

**Two orders have been repaired** (§3.1): SO-1507 restored in place, and Fresno Pacific's destroyed
"Sunny Jersey" order rebuilt as **SO-1670** with its already-sent invoice re-pointed to it. Three
others lost their headers before any line item was ever saved, so nothing exists to rebuild — those
have to be re-entered by hand (§3).

**Root cause is one line asking the wrong question.** The save decides insert-vs-upsert with
`_isNewSO = !existingSO` — *"is this id free in the DB?"* On a real collision the incumbent row is
right there, so this is `false`, and the save takes the upsert branch and replaces the other
order. The "brand-new orders INSERT rather than upsert" guard added on Jul 21 for this exact bug
**can only fire when there is nothing to collide with**, so it never engaged. Estimates have the
identical flaw and it is still live: EST-1672 collided on **Jul 22, after that fix shipped**.
CONFIRMED.

Fixed in this change (§5). The deeper fix — server-side number allocation — is recommended but not
done here (§6).

---

## 2. What actually happened to SO-1507

From `audit_log`, `table_name='sales_orders'`, id `SO-1507`. Local time is UTC-7.

| When (UTC) | Who | `_version` | Row said |
|---|---|---|---|
| Jul 13 17:34:43 | **Rachel** | 1 (INSERT) | Encinitas Express Soccer · "Rec Ball Order" · created 10:34:43 |
| Jul 13 17:34–17:38 | Rachel | 2 → 10 | worked to `complete`; 2 soccer-ball lines written |
| **Jul 13 17:40:13** | **Sharon** | **11 (UPDATE)** | **Clovis South Girls Volleyball · "JV Uniforms" · created 10:36:38** |
| Jul 13 – Jul 27 | various | 12 → 33 | operated on as the Clovis order |

The Jul 13 17:40:13 row is the collision, and the audit captured the fingerprint: the UPDATE
rewrote `created_at` from `7/13/2026, 10:35:00 AM` to `7/13/2026, 10:36:38 AM` and `created_by`
from Rachel to Sharon. **A normal edit never changes `created_at`** — that is what makes this
detectable, and it is what the fix now keys on.

Sharon's session believed it was *creating* an order. It had no `_version`, so the optimistic-lock
check was skipped entirely, and the upsert wrote her header straight over Rachel's.

**The items never followed.** Every `so_items` write on SO-1507 — all 21 of them, Jul 13 through
Jul 27 — is Rachel's two soccer-ball lines (`IP1649` blue/White ×300 size 4, `IP1648` White/Black
×30 size 5). Sharon's session never successfully wrote a single item row. The item guards did their
job; only the header was unprotected. CONFIRMED.

Current live state of SO-1507: Rachel's Encinitas soccer balls, under Clovis South Girls
Volleyball / "JV Uniforms", status `needs_pull`.

---

## 3. Full damage list

Detector: `UPDATE` rows on `sales_orders`/`estimates` where `old_data->>'created_at'` differs from
`new_data->>'created_at'` (§7). Over ~4 months of audit history this returns **only** collisions —
no false positives were found on inspection.

### Sales orders — 8 contested numbers

"Lost" = that order's header was overwritten. "Recreated as" = a live order with the same customer
and memo exists elsewhere.

| Contested | Order that lost the number | Status |
|---|---|---|
| **SO-1507** | Encinitas Express Soccer · "Rec Ball Order" | ✅ **repaired in place** — see §3.1 |
| **SO-1502** | Fresno Pacific University · "Sunny Jersey" | ✅ **rebuilt as SO-1670** — see §3.1 |
| SO-1485 | Dave Blomquist · "Camp Balls" | header only — nothing recoverable |
| SO-1437 | Clovis South Girls Golf · (blank memo) | header only — nothing recoverable |
| SO-1514 | Dana Hills Football · "Pracitce Gear" | header only — nothing recoverable |
| SO-1340 | Biola University Men's Soccer · "2026 June Pinnies" | recreated as SO-1371 |
| SO-1454 | Orange Lutheran Boy's Soccer · "2026Book" | recreated as SO-1455 |
| SO-1472 | CUI W Soccer · "June 2026 add M" | recreated as SO-1608 |
| SO-1437 | Golden West Flag Football · "Pop Flags (copy)" | recreated as SO-1539 |

"Header only" means the losing session never successfully wrote a single `so_items` row, so there is
nothing in the audit log to rebuild from beyond customer, memo and a few header fields. Those three
have to be re-entered by the rep who owns the account; no tooling can recover them. The same is true
of Sharon's Clovis South "JV Uniforms" order on SO-1507.

SO-1437 is the worst case: **four** different orders (Clovis South Tennis, Clovis South Girls Golf,
Golden West Flag Football, and Clovis South Tennis again) held that number across 34 minutes on
Jul 6, with Sharon and Kevin's sessions overwriting each other six times.

**Correction to an earlier draft of this document:** SO-1514 was listed as a recoverable loss because
two Gildan tee lines (`5000 GphHeather`, `5000-49 Graphite Heather`) appear in history but not in the
live order. That was a false positive. They are earlier variants of the same tee, swapped for
`5000 Graphite Hthr` during ordinary editing on Fresno Pacific Cheer's order — the decoration notes
on all of them read "Fresno Pacific Cheerleading Logo". No work was lost there. Dana Hills' order on
that number saved no items at all.

### 3.1 Repairs applied to production — 2026-07-27

**SO-1507 — restored in place.** Sharon's overwrite had replaced nine header fields, three of which
were live hazards rather than cosmetic: `tax_rate` 0.0775 → **0** (the order no longer reconciled with
its own invoice, which had been cut at the correct rate), `ship_to_id` → **Clovis South's alternate
address** (on an order sitting in `needs_pull`, that ships 330 soccer balls to the wrong school), and
`shipping_value` 3 → 5. Restored from the `old_data` of the overwrite audit row: `customer_id`,
`memo`, `created_by`, `created_at`, `estimate_id` (→ EST-1534), `tax_rate`, `shipping_value`,
`ship_to_id`, and cleared `po_number` 27000632 (which arrived *with* Sharon's overwrite, so it is
Clovis's customer PO, not Encinitas's).

Deliberately **not** reverted: `status` (Rachel set `needs_pull` herself on Jul 27) and
`expected_date` (unchanged by the overwrite). Items and INV-63155 ($4,294.34, billed to Encinitas)
were already correct and now agree with the header.

**SO-1502 → rebuilt as SO-1670.** Fresno Pacific University's "Sunny Jersey" order was invoiced
before it was destroyed — **INV-63149 ($87.01) was emailed to the customer on Jul 13 and opened**, and
was still pointing at Clarksville Football's backpack order. Rebuilt from audit history with both
lines (1× CUSTOM SUBLIMATED JERSEY, UBIX, vendor `ns_3801`, $48 sell / $25 cost, sizes `{"OSFA":1}`;
plus the $15 Artwork line), header restored from the pre-overwrite audit row (EST-1537, flat $35
shipping, 8.35% tax, `default` ship-to), and **INV-63149 re-pointed to SO-1670**. Its invoice math
independently confirms the reconstruction: 48 + 35 shipping + 4.01 tax = 87.01, and only the jersey
was billed — the Artwork line was on the SO but never invoiced.

`status` was set to `complete` to match its state at destruction; if that jersey never actually
shipped, that needs changing by hand.

**Verification.** A sweep of every live invoice against its order's customer now returns no
mismatches except four on SO-1436 (Lincoln Cross Country, billed to four Portland-area high schools),
which is deliberate split billing for a meet, not a collision.

### Estimates — 9 contested numbers

| Contested | Lost | Currently holds it |
|---|---|---|
| EST-1672 (**Jul 22**) | Ronnie MacBride · "Raley Hoods" | Giving Children Hope · "July Ts and hats" |
| EST-1646 (Jul 20) | West Valley College Basketball · "2026 Fill In Shorts" | Orange Lutheran Store · "2026 Shirts 500" |
| EST-1645 (Jul 20) | Golden West Athletics · "Tennis Visors" | Saugus Cross Country · "2026 Team Order 7/20" |
| EST-1594 (Jul 15) | Fresno Pacific Women's Basketball · "Tees" | Fresno Pacific Basketball · "Basketballs" |
| EST-1593 (Jul 15) | Reedley HS Football · "Helmet Decals" | Clovis High School Football · "Sweats" |
| EST-1592 (Jul 15) | Concordia Women's Lacrosse · "2026Players" | San Diego City College W Soccer · "Dri-fit shirts" |
| EST-1469 (Jul 6) | Golden West Flag Football · "Spirit Packs" | Civica HS Football · "2026 July JV Order" |
| EST-1449 (Jul 1) | Cuyamaca College M Soccer · "Squadra kits…" | *(estimate no longer exists)* |
| EST-1397 (Jun 26) | Stockdale HS Athletics · "Customers Adidas Polos And Pullover" | Stampede Football · "Quitckturn Uniforms" |

**EST-1672 collided on Jul 22 — the day after the Jul 21 fix shipped.** That is the proof the
existing guard does not work, not an inference.

---

## 4. Root cause

### 4.1 Numbers are minted client-side from a ceiling refreshed once per page load — CONFIRMED

`App.js:229`:

```js
const nextSOId=sos=>'SO-'+(Math.max(_maxNum(sos),_dbMaxIds.so,1000)+1);
```

`_dbMaxIds` is populated by `_syncDbMaxIds()`, which is called from exactly one place — `App.js:2405`,
on initial DB load. A tab open since 9 AM is still minting against 9 AM's ceiling at 3 PM. Two
sessions that both loaded before the other's create will both mint the same number. This is not a
tight race: Rachel and Sharon's saves were **five and a half minutes apart**.

### 4.2 The insert-vs-upsert guard asks the wrong question — CONFIRMED

`dbEngine.js` (before this change):

```js
const{data:existingSO}=await supabase.from('sales_orders').select('updated_at,deco_pos').eq('id',so.id).maybeSingle();
const _isNewSO=!existErr&&!existingSO;
…
let{error:soErr}=await(_isNewSO?supabase.from('sales_orders').insert(soRowInitial)
                               :supabase.from('sales_orders').upsert(soRowInitial,{onConflict:'id'}));
```

Its own comment states the intent exactly right:

> Brand-new orders INSERT rather than upsert … a stale tab can re-mint an id another tab already
> saved (the SO-1514 incident) — an upsert would then silently REPLACE that order's header while
> the item-write guards below block the item write, **leaving one order's header on another
> order's items**.

That last clause is a precise description of SO-1507's live state. But `_isNewSO` is derived from
the *database*, not from the client's intent. In a collision the row exists by definition, so
`_isNewSO` is `false` and control flows to the upsert. **The insert branch can only run when there
is no incumbent to protect** — the 23505 re-mint path below it is unreachable for the scenario it
was written for. The guard has never once fired on a real collision.

The estimate path (`dbEngine.js`, `save_estimate` RPC call) computes `_isNewEst` the same way and
inherits the same hole, which is why EST-1672 collided a day after the SO-side fix.

### 4.3 Why the header was unprotected when the items were not — CONFIRMED

A colliding create carries no `_version` (nothing has been read back for it yet), so
`if(so._version){…_checkVersion…}` is skipped and `_versionConflict` stays `null`. The item, PO,
pick-line and deco-PO guards all have their own independent checks and blocked the write. The SO
row itself had none. Hence: one order's header, another order's items.

---

## 5. The fix in this change

**Compare `created_at` — the document's fingerprint.** It is stamped once at creation and no edit
path rewrites it, so a DB row whose `created_at` differs from the payload's is a *different*
document wearing our number. This replaces "is the id free?" with "is the row at this id actually
mine?", which is the question that matters.

Applied to **all three** document save paths in `src/lib/dbEngine.js` — sales orders, estimates and
invoices:

- **Brand-new document** (`!_version` — never successfully saved, so it owns no children under this
  id yet): re-mint from a fresh DB-wide max and INSERT under a free number. Safe to renumber
  precisely because nothing is attached yet. On the SO path the re-minted row also drops the
  incumbent's `updated_at`, which the existence probe had copied in.
- **Already-saved document**: refuse the write. Renumbering here would strand its items, POs and
  art under the old id. The edit goes to the outbox conflict card, so nothing typed is lost, and
  the rep gets *"Save blocked — SO-1507 now belongs to a different order. Please reload before
  editing."*
- **`created_at` unusable on either side** (null on the text paths, unparseable on the invoice
  path): treated as "can't tell" and allowed through. An unprovable mismatch must never block a
  legitimate save.

On the estimate path the guard just forces `_isNewEst = true`, which makes the RPC raise
`ESTIMATE_ID_EXISTS` and reuses the re-mint machinery that was already there but unreachable.

**The invoice path needed a different comparison.** `_dbSaveInvoiceInner` had no new-vs-existing
check of any kind — a bare `upsert` — so it was the most exposed of the three, on a money document
carrying payments. But `invoices.created_at` is `timestamptz DEFAULT now()`, **not** the `text`
column `sales_orders` and `estimates` use, so the two sides legitimately differ in *format* for the
same instant: a client that just created the invoice holds a `toLocaleString()` value
(`"7/27/2026, 2:54:42 PM"`) while the DB returns ISO with microseconds
(`2026-07-27T21:54:42.663188+00:00`). A string compare there would have blocked an ordinary re-save
of every freshly-created invoice — worse than the bug. It compares parsed instants with a 5-second
tolerance instead. Its re-mint scans on the `INV` prefix rather than `INV-`, because some live ids
carry no dash (`INV63316`) and an `INV-%` scan would renumber straight into one.

No invoice collision appears anywhere in the audit history — the INV range moves fast and invoices
are minted-then-saved in a single burst, so the window is narrow. The guard is there because the hole
was structurally identical, not because it had fired yet.

**Tests:** `src/__tests__/soIdCollision.test.js` — 9 cases driving the real `_dbSaveSOInner` and
`_dbSaveInvoiceInner` through a mocked Supabase client and asserting on the actual insert/upsert
calls issued. The no-false-positive cases are the load-bearing ones (matching `created_at`; null
`created_at`; the same instant in two formats; an unparseable date): a guard that blocks ordinary
saves would be worse than the bug. One case reads the outbox back to prove a blocked save preserves
what was typed. Full suite: **154 suites, 3114 tests, all passing.**

*Bug found while adding the invoice guard, now fixed:* the first cut of the SO guard returned `false`
without calling `_emitOutboxConflict`, so a blocked save would have **discarded the rep's edit** —
every other blocking guard in that function parks it on the conflict card. The claim that nothing
typed is lost was written before it was true.

**Known residual gap, not fixed here:** after a re-mint the tab's React state still holds the old
id — nothing plumbs a renumber back into `sos`/`eSO`. The pre-existing 23505 path had this too. The
save now says so plainly (*"SO-1507 was already taken by another order — this one saved as SO-1511.
Reload to keep editing it."*) rather than leaving the rep silently editing a number that moved.
Closing it properly means threading an id remap through App state; that is a separate change.

---

## 6. Recommended next step — server-side number allocation

The guard above stops the corruption but does not stop collisions; reps will now occasionally see a
renumber or a blocked save where they previously saw silent damage. The real fix is to stop minting
numbers on the client.

**This repo has already solved this exact problem once.** `supabase_migration_072_po_number_seq.sql`
was written for PO numbers after PO 3476 was issued to two customers on 2026-06-29 — same root
cause, same shape. It creates a sequence with `INCREMENT BY 50` and a `reserve_po_block()` RPC;
each session atomically claims a block and increments locally within it. It is live and working
(`po_number_seq` is at 27200). `webstore_batch_no` and `webstore_order_number_seq` follow the same
principle, and the code comment there says it outright: *"deliberately NOT set here so client
sessions can't race or drift the numbering."*

Applying that pattern to `SO-`/`EST-`/`INV-` numbers is the consistent fix. Two notes for whoever
picks it up:

1. A 50-wide block leaves visible gaps in customer-facing order numbers (SO-1507 → SO-1557). For
   these, `INCREMENT BY 1` with one RPC call per created document is probably the better trade —
   one extra round trip at create time, gaps only from abandoned drafts.
2. `nextSOId`/`nextEstId`/`nextInvId` are synchronous and called from ~14 sites in `App.js` and
   `MobilePortal.js`. Making allocation async is the bulk of the work, not the SQL.

I did not do this here: it touches every document-creation path in the app, and the guard in §5
stops the data loss on its own. It belongs in its own change.

---

## 7. What I could not determine

- **Whether the three "header only" orders are still owed** (Dave Blomquist "Camp Balls", Clovis South
  Girls Golf, Dana Hills "Pracitce Gear", plus Clovis South "JV Uniforms"). No line items were ever
  saved, so nothing can be reconstructed; the reps who own those accounts have to re-enter them.
- **Whether SO-1670's `complete` status is right.** It matches the order's state at destruction, and
  the invoice went out and was opened, but I could not confirm the jersey physically shipped.
- **Whether SO-1514's item list is right.** It currently reads Fresno Pacific Cheer / "Fall Gear" on
  Dana Hills' `created_at` stamp, with 5 items. Someone repaired the header by hand; I confirmed no
  items were lost, but not that the 5 present lines match what Fresno Pacific actually ordered. The
  stale `created_at` is cosmetic and I left it alone — rewriting it would trip the new §5 guard for
  any tab still holding that order.
- **Collisions between two orders for the same customer.** The detector keys on `created_at`, which
  catches those too — but a same-customer, same-memo collision would be nearly invisible on
  inspection. None were obvious in the results; I cannot rule them out.
- **Anything before the audit log's retention.** The oldest collision found is Jun 26.

**Production data was modified** — see §3.1 for exactly what and why. Two orders were repaired
(SO-1507 in place, SO-1502 rebuilt as SO-1670) and one invoice re-pointed (INV-63149). Everything else
in §3 was left untouched.

Note for anyone reading this after the fix in §5 deploys: a session holding a *pre-repair* copy of
SO-1507 will now be **blocked** on save rather than silently re-corrupting it, because its in-memory
`created_at` no longer matches the restored row. That is the guard working as intended — the rep just
needs to reload.

---

## 8. Reproducing the queries

Collision detector — an UPDATE that rewrites `created_at` is a different document taking the id:

```sql
select a.changed_at, a.new_data->>'id' as doc_id, u.email as overwriter,
       a.old_data->>'created_at' old_created_at, a.new_data->>'created_at' new_created_at,
       a.old_data->>'customer_id' old_cust, a.new_data->>'customer_id' new_cust,
       a.old_data->>'memo' old_memo, a.new_data->>'memo' new_memo
from public.audit_log a
left join auth.users u on u.id = a.changed_by
where a.table_name in ('sales_orders','estimates','invoices') and a.op = 'UPDATE'
  and a.old_data->>'created_at' is distinct from a.new_data->>'created_at'
order by a.changed_at desc;
```

Every distinct document that ever held a contested number, and which one holds it now:

```sql
with idents as (
  select a.new_data->>'id' doc_id, a.new_data->>'created_at' created_at,
         a.new_data->>'customer_id' cust, max(a.new_data->>'memo') memo, count(*) writes
  from public.audit_log a
  where a.table_name = 'sales_orders' and a.op in ('INSERT','UPDATE')
    and a.new_data->>'id' in ('SO-1507')   -- ids from the detector above
  group by 1,2,3
)
select i.doc_id, c.name customer, i.memo, i.created_at, i.writes,
       (so.created_at = i.created_at) as currently_holds_the_id
from idents i
left join public.customers c on c.id = i.cust
left join public.sales_orders so on so.id = i.doc_id
order by i.created_at;
```

Note: `audit_log.changed_by` holds the `auth.users` id, which is **not** `team_members.id` — join
through `auth.users.email`. Timestamps in `audit_log.changed_at` are UTC; the `created_at` column on
these tables is a client-generated `toLocaleString()` in local time (UTC-7).
