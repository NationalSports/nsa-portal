# Sports Inc Bill Entry — Received-vs-Billed Audit (2026-08-31)

**Question asked:** are the things we *receive* also getting *billed* onto the order?

**Answer: no — not reliably.** Roughly **$958K of merchandise sits on portal PO lines with no
supplier bill applied**, about **$622K of it more than 30 days old**. Some of that is normal
billing lag, but three concrete defects (below) mean a meaningful share will never self-correct:
bills are being auto-classified as "not ours," and bills are being marked **approved and applied
when they wrote nothing to the order.**

Nothing in the codebase watches for this. There is **no report, digest, or flag anywhere that
compares received against billed** — the nightly `bill-anomaly-digest` only checks bill-side
anomalies (freight %, sharp prices, doc-total mismatch). The gap is invisible by construction.

**Status.** The audit itself changed nothing. The three defects it found were then fixed in code in
this same PR — see [§8 What was fixed](#8-what-was-fixed). **No production data was modified**: the
backlog of already-mis-filed rows is re-surfaced for a person to work, not rewritten automatically.

---

## 1. The exposure, measured

Source: live Supabase, `so_item_po_lines` (4,915 rows at the time of this query; PO dates
2026-04-24 → 2026-08-26). The table is live and grew from 4,912 to 4,916 rows over the course of
the audit, so counts taken at different moments differ by a handful of rows — none of the
conclusions turn on that.
Value = unbilled units × the line's `unit_cost`.

| Line kind | Lines | Lines with **zero** billed | Unbilled exposure | Of that, >30 days old |
|---|---:|---:|---:|---:|
| **Stock** (received into the warehouse) | 2,119 | 670 | **$242,972** | $199,288 |
| **Drop-ship** (never received; the bill *is* the ship signal) | 2,796 | 1,701 | **$714,639** | $422,598 |
| **Total** | 4,915 | 2,371 | **$957,611** | **$621,886** |

Aging of the stock half (lines whose status is `received`/`partial`, so the goods are physically
here and the cost is knowable):

| PO created | Lines short | Units | Value |
|---|---:|---:|---:|
| Apr–May (90 d+) | 86 | 4,298 | $51,530 |
| Jun (60–90 d) | 205 | 6,108 | $84,273 |
| Jul (30–60 d) | 232 | 5,729 | $64,115 |
| Aug (current — lag is normal) | 200 | 3,447 | $43,684 |
| **Total** | **723** | **19,582** | **$243,602** |

$200K of that is 30+ days past receipt. That is not lag.

By vendor (stock lines only, top 6):

| Vendor | Lines short | Units | Value | Lines never billed at all |
|---|---:|---:|---:|---:|
| Adidas | 236 | 8,935 | $149,242 | 208 |
| *(vendor id `v1777312659133`)* | 44 | 1,072 | $22,533 | 42 |
| SanMar | 194 | 4,319 | $20,266 | 189 |
| Momentec | 132 | 1,436 | $11,893 | 60 |
| S&S Activewear | 67 | 586 | $8,250 | 64 |
| Under Armour | 40 | 236 | $5,544 | 40 |

**Caveats, stated plainly.** The drop-ship figure uses *ordered* quantity (there is no receipt to
compare against), so it overstates wherever a PO was partly cancelled or never fully shipped —
treat it as an upper bound and a prompt to look, not as a payable. About 80 lines carry no
`unit_cost` at all, so the dollar figures are slightly *under*stated. Both halves exclude
`Customer (supplied)` lines, which correctly cost $0.

---

## 2. Finding A — 222 Sports Inc documents ($162,770) were auto-filed as "not our problem," and they *are* our problem

`si_documents` holds 2,654 documents. 628 sit in `outside_portal` — the bucket meaning *"pre-portal
PO, billed through NetSuite → QuickBooks, never touches portal Billed tracking."*

**222 of them ($162,770) carry a PO whose numeric core *and* customer alpha-tag exactly match a
live portal PO line.** Only 4 ($3,585) are justified by the NetSuite ignore list
(`netsuite_pos`, 4,092 cores). The other **218 ($159,186)** were filed as pre-portal for one reason:
the vendor wrote the PO without a space.

Every one of the 222 was filed by the machine — `resolved_by = 'auto: NetSuite/old-system PO'`.
**No human ever saw them.**

### Why

`siPoOrigin()` (`src/sportsLink.js:85`) is the discriminator: `PO 3545` = portal, `PO3454` =
pre-portal. `_siTriage` (`src/App.js:25173`) is supposed to let a high-confidence portal match
override that rule — and `scoreSiPoMatch` gives PO-core 50 + customer-tag 35 = 85, comfortably over
the 70 "high" threshold. So these should have matched.

They didn't, because the match runs against candidates built from **whatever orders happen to be
loaded in the browser at that moment**:

```js
// src/App.js:25301
const cands=_siBuildCandidates();          // built from `sos` + `cust` in React state
let rows=(data||[]).map(row=>({...row,_t:_siTriage(row,cands)}));
rows=await _autoCaptureOutside(rows);      // writes status='outside_portal' to the shared DB
```

and the effect that fires it has no dependency on the order book being loaded:

```js
// src/App.js:25259
useEffect(()=>{
  if(supabase&&pg==='import'&&!siQueue.length&&!siQueueLoading)loadSiQueue();
},[pg,billView]);
```

With `sos`/`cust` empty or partial, every candidate score is 0, the space rule fires, and
`_autoCaptureOutside` writes the park **to the shared database for every user**.

**It is never revisited.** The first line of `_siTriage` short-circuits parked rows forever:

```js
// src/App.js:25176
if(['approved','manual_done','outside_portal','ignored'].includes(row.status))
  return{bucket:'captured',parsed,match:null};
```

The high-confidence override was added 2026-08-11 (commit `025caea`). It did not heal the backlog,
and it did not stop the bleeding: **188 docs ($132,169) were parked before that date and 34 more
($30,601) after it — the most recent on 2026-08-28, the latest sync.**

### The other half of the same defect: our *own* PO numbers break the space rule

82 portal POs are stored with no space after `PO` — `PO6465CUMLax GP BK`, `PO6581 FPUBB SP`,
`PO6690 OLUFB`. `siPoOrigin` calls the portal's own POs pre-portal. Those 82 POs are 4% of the
book and carry **51% of the received-but-unbilled dollars**:

| PO id shape | POs | Received | Billed | Received-not-billed |
|---|---:|---:|---:|---:|
| `PO 1234 TAG` (space — matcher OK) | 1,796 | 28,264 | 46,059 | $106,570 |
| **`PO1234TAG` (no space — matcher says pre-portal)** | **82** | **6,956** | **1,690** | **$109,313** |
| other / no `PO` prefix | 56 | 1,905 | 1,445 | $23,523 |
| `NSA`/`TS` prefixed | 44 | 290 | 2,161 | $4,196 |

Space-form POs are billed *ahead* of receipt in aggregate (46,059 billed vs 28,264 received — normal,
bills arrive before goods land). The no-space POs are billed at **24%** of what was received.

Worst offenders:

| PO | Vendor | Created | Received | Billed | Unbilled |
|---|---|---|---:|---:|---:|
| PO6465CUMLax GP BK | Adidas | 7/21 | 719 | 0 | $12,880 |
| PO6581 FPUBB SP | Adidas | 8/7 | 767 | 0 | $11,558 |
| PO6690 CSMFBSS SP | Adidas | 6/26 | 286 | 6 | $7,611 |
| PO6690 OLUFB | Adidas | 5/23 | 628 | 23 | $7,343 |
| PO6645 OLUFBSS | Adidas | 7/14 | 387 | 337 | $7,054 |
| PO6615 SBBJVSS SP | Adidas | 6/9 | 348 | 15 | $6,751 |
| PO6403 WVC SP | Adidas | 5/1 | 447 | 0 | $6,048 |

(For `PO6465CUMLax GP BK` there is no Sports Inc document at all under core 6465 — the only related
docs are under `6736CUMLAX GP D`, a different core for the same customer. That $12,880 has no bill
in the queue to apply.)

Note also that core `6690` is used by **two different customers** (`PO6690 CSMFBSS` and
`PO6690 OLUFB`), so PO-core matching alone is genuinely unsafe here — the customer tag is doing
real work and must not be dropped.

---

## 3. Finding B — 120 bills ($51,098) are marked "approved and applied" but wrote nothing to any order

Ground truth for "did this bill reach the order" is the doc number appearing in a PO line's
`_bill_details` (or a deco PO's). Checking every `si_documents` row against that:

| Queue status | Docs | Never landed on any order | Dollars |
|---|---:|---:|---:|
| `approved` (EDI) | 1,503 | **120** | **$51,098** |
| `manual_done` (scanned) | 285 | 209 | $103,593 |
| `new` (unworked) | 238 | 221 | $118,671 |
| `outside_portal` | 628 | 558 | $360,774 |

The `approved` row is the alarming one: those 120 were approved **by a named person**, carry an
`applied_doc_number`, and the portal shows no trace of them.

### Worked example — Adidas `PO6690 CSMFBSS`

| SI doc | Invoice | Total | Status | Landed on the order? |
|---|---|---:|---|---|
| 24700321 | 6165969883 | $176.79 | approved (Andrea Jung) | ✅ yes — line 254691, `sizes: {L:6}`, cost $168.72 |
| 24708436 | 6165987777 | **$7,803.82** | approved (Andrea Jung, 2026-08-06) | ❌ **no** — appears in no `_bill_details` anywhere |

The order has received 286 units at ~$27; it carries $168.72 of cost. Line 254693 (141 units
received) has `billed: {}` and `_bill_cost: null`.

### Why

Two gaps compound:

**1. A bill that applies to nothing is recorded as a success.** In `_applyBillsToPortal`
(`src/App.js:29341`), `applyBillToSO(p)` doesn't throw when it matches nothing, so
`portalStatus='success'` is set. The save gate that is supposed to catch failures then skips any
bill that dispatched no saves — which is exactly the wrote-nothing case:

```js
// src/App.js:29369-29380
for(const b of bills){
  if(b.portalStatus!=='success')continue;
  const _ps=_collect.filter(e=>e.key===b.id).map(e=>e.p);
  if(!_ps.length)continue;                    // ← wrote nothing ⇒ gate skipped ⇒ still "success"
  ...
}
```

The bill is then written to `applied_bills` (unique on doc #) and the SI row is flipped to
`approved`. Because the ledger is the cross-machine dedup set, **the doc can never be re-applied** —
the failure is permanent and silent.

**2. Validation can be waived.** `_validateBillForPush` does catch the case
("Billed quantities would not update — none of the bill's line SKUs match this PO's items"), but
`_pushAllOverride` (`src/App.js:29494`) pushes the flagged bills anyway, and they land in gap 1.

Separately, partial misses are silent by design: if one line on a bill matches and a sibling line
doesn't, the bill pushes, the unmatched line's dollars are never written, and nothing blocks or
logs it (it renders as a red "✗ no match" in the review card — a human has to notice).

---

## 4. Finding C — 238 documents ($123,517) have never been worked, the oldest since 2026-05-18

`status='new'`: 164 EDI ($89,080) + 74 scanned ($34,437). Per the SOP these are the daily worklist;
the oldest has been sitting 3½ months. 17 of the scanned ones *have* landed on orders — i.e. the
bill was applied but the queue row was never checked off, so they'll be re-worked or re-grabbed.

## 5. Finding D — the over-billing side

Not asked, but it falls out of the same query. **220 lines are billed above what was ordered:
5,253 units, $52,097.** 102 of them carry `_qty_corrections` — the accepted-overage path that
rewrites the *ordered* quantity up to match the bill. That is the exact mechanism documented in
`NEA200_RECEIVED_MISMATCH_2026-07-29.md`, where a mis-assigned bill line inflated a line from 30 to
51 ordered. The residual risk flagged in that write-up ("warn when an overage correction would push
a line's ordered above the SO item's total quantity") is still unguarded.

## 6. Finding E — the queue's own match columns are empty, so none of this is auditable from the database

`si_documents` has `matched_po_id`, `match_confidence`, `match_method`, `discrepancy`,
`has_discrepancy` precisely so the shared queue is reviewable. Across 2,654 rows:
**`matched_po_id` is populated on 1. `has_discrepancy` is true on 0.** Triage is computed in the
browser and thrown away; only the terminal `status` is persisted. There is no way to ask the
database *why* a document was filed the way it was — which is why Finding A took a reconstruction
rather than a lookup.

---

## 6b. Re-verified 2026-09-01

Every headline claim was re-run against live data the next day. Nothing had been fixed, and two
numbers had grown — the leak was still live:

| Finding | 2026-08-31 | 2026-09-01 |
|---|---:|---:|
| Auto-parked docs matching a live portal PO | 222 · $162,770 | 222 · $162,770 (unchanged) |
| Approved EDI docs that never landed | 120 · $51,098 | **125 · $52,412** |
| Total unbilled exposure | $957,611 | **$967,999** |
| No-space portal POs / their stock exposure | 82 · $109,313 | 82 · $109,313 (unchanged) |

## 7. What to do, in priority order

1. **Stop the auto-park.** Do not let `_autoCaptureOutside` write when the candidate set is empty
   or the order book isn't loaded — gate `loadSiQueue` on `sos.length && cust.length`. A park
   written from an empty candidate list is a guess recorded as a decision.
2. **Make the park re-triageable.** Re-run triage on `outside_portal` rows that were parked by
   `auto:` (not by a human) and surface any that now match a portal PO. This is what recovers the
   222 docs / $162,770 already on the floor.
3. **Fail honestly when a bill writes nothing.** In `_applyBillsToPortal`, treat "collected zero SO
   saves" as an error for `so_po`-matched bills rather than a pass — today it is recorded as
   applied and permanently deduped. Re-check the 120 approved-not-landed docs; they will need the
   ledger row cleared to be re-appliable.
4. **Fix the PO-id shape at the source.** 82 POs are stored as `PO1234TAG`. Either normalize them
   to `PO 1234 TAG` or stop using the space as a portal/pre-portal discriminator (the core+tag
   match is the stronger signal and is already implemented).
5. **Add the missing monitor.** A daily "received but not billed, aged >30 days" digest — grouped
   by vendor and PO — alongside `bill-anomaly-digest`. Every finding here would have surfaced in
   week one had it existed.
6. **Persist the match columns** (`matched_po_id`, `match_confidence`, `match_method`,
   `match_reason`) when triage runs, so the queue can be audited from SQL.
7. **Work the 238 `new` docs**, oldest first.

---

## 8. What was fixed

Items 1–3 above are implemented in this PR (`src/App.js`). Items 4–7 are **not** done.

### 8.1 The auto-park can no longer fire from an unloaded page (item 1)

`_autoCaptureOutside` now takes the candidate set and refuses to write when it — or the customer
list the alpha-tag match depends on — is empty. An empty candidate list means the page hasn't
loaded, not that a bill isn't ours; previously that state wrote `outside_portal` to the *shared*
queue for every user.

```js
const _autoCaptureOutside=async(rows,cands)=>{
  if(!(cands||[]).length||!(cust||[]).length)return rows;
```

Both call sites (`loadSiQueue` and `pullAllBills`) pass `cands`. `cust` defaults to `[]`
(`constants.js: D_C=[]`), so the guard genuinely blocks the pre-load window.

### 8.2 Auto-parked rows are re-checked instead of parked forever (item 2)

`_siTriage` short-circuited every `outside_portal` row to `captured`, so a machine's guess was
never revisited. Now a row a **person** resolved still stays resolved, but one the **machine**
parked (`resolved_by` starts with `auto:`) is re-scored on every load and re-surfaced when the PO
number *and* customer tag match a live portal order:

```js
const autoParked=row.status==='outside_portal'&&String(row.resolved_by||'').startsWith('auto:');
if(!autoParked&&['approved','manual_done','outside_portal','ignored'].includes(row.status))
  return{bucket:'captured',parsed,match:null};
```

Recovered rows land in **Needs Review**, not Ready-to-Approve, so "Approve all high-confidence"
cannot sweep a 222-row backlog in one click — each is confirmed by a person. Genuinely old-system
parks still score low and stay `captured`, so the exceptions drawer does not fill with noise.

### 8.3 A bill that writes nothing is no longer recorded as applied (item 3)

The save gate skipped any bill that dispatched zero SO saves — exactly the wrote-nothing case. It
now distinguishes the two reasons for zero saves:

```js
if(!_ps.length){
  if(b.parsed?.matchedPOSource==='so_po'&&b.parsed?.kind!=='decoration'){
    b.portalStatus='error';
    b.portalMsg='Nothing was written to the order — no SO save was dispatched. …';
    applied--;
  }
  continue;
}
```

Batch-record and inventory-PO bills legitimately dispatch no SO save and are unaffected. An
`so_po`-matched bill that dispatched none now fails loudly instead of flipping its SI row to
`approved` and burning its doc number in `applied_bills`' unique index — which is what made those
125 documents permanently un-re-appliable.

### Verification

- `npx react-scripts test --watchAll=false` → **237/237 suites, 4,185 tests passing**.
- `eslint --no-eslintrc -c .eslintrc.undef.json src/App.js` → 8 errors, **identical to the
  pre-edit baseline** (`_soSeq`, `_estSeq`, `_invSeq`, `getRunLabels` — all pre-existing and
  unrelated); no new errors introduced.
- `@babel/parser` full JSX parse of `src/App.js` → clean.

### Deliberately not done

- **Item 4 (normalize the 82 no-space PO ids)** — rewriting live `po_id` values touches the join
  key every bill match depends on; it needs its own change with a data-repair plan.
- **Item 5 (received-not-billed digest)** — new monitoring, additive; the audit's whole point is
  that this gap was invisible, so it is worth doing next.
- **Items 6–7 (persist match columns, work the 238 `new` docs)** — untouched.
- **The existing backlog is not auto-repaired.** 8.2 makes the 222 rows *visible* again; a person
  still applies each bill. The 125 already-approved-but-not-landed docs need their `applied_bills`
  rows cleared before they can be re-applied — a data change, not made here.

---

## Appendix — how the numbers were derived

All figures come from read-only queries against production Supabase on 2026-08-31. Size maps are
summed excluding non-size keys (`unit_cost`, `drop_ship`, `api_order_id`, `vendor_keys`,
`ship_to_deco_id`, `preexisting`, `attention`, `batch_queue_id`, `batch_po_number`, `shipping`,
`received_at`, `received_by`, and any `_`-prefixed key).

```sql
-- Received-but-unbilled exposure, split stock vs drop-ship
create or replace function pg_temp.qsum(j jsonb) returns numeric language sql immutable as $$
  select coalesce(sum(v::numeric),0)
  from jsonb_each_text(coalesce(j,'{}'::jsonb)) e(k,v)
  where left(k,1) <> '_'
    and k not in ('unit_cost','drop_ship','api_ordered_at','api_order_id','vendor_keys',
                  'ship_to_deco_id','preexisting','attention','batch_queue_id',
                  'batch_po_number','shipping','received_at','received_by')
    and v ~ '^-?[0-9]+(\.[0-9]+)?$'
$$;
with l as (
  select (sizes->>'drop_ship')::boolean ds,
    to_date(nullif(regexp_replace(coalesce(created_at,''),'[T ].*$',''),''),'FMMM/FMDD/YYYY') cdate,
    pg_temp.qsum(sizes) ord, pg_temp.qsum(received) rcv, pg_temp.qsum(billed) bil,
    coalesce((sizes->>'unit_cost')::numeric,0) uc
  from so_item_po_lines
)
select coalesce(ds,false) drop_ship, count(*) lines,
  round(sum(case when coalesce(ds,false) then greatest(ord-bil,0)
                 else greatest(rcv-bil,0) end * uc),2) exposure
from l group by 1;

-- Documents parked "outside portal" that match a live portal PO (core + customer tag)
with od as (
  select si_doc_number, po_number, doc_total, resolved_by,
    (regexp_match(upper(po_number),'^\s*(?:PO\s*)?([0-9]{3,6})\s*([A-Z0-9]*)\s*$'))[1] core,
    (regexp_match(upper(po_number),'^\s*(?:PO\s*)?([0-9]{3,6})\s*([A-Z0-9]*)\s*$'))[2] tag
  from si_documents where status='outside_portal'
), pl as (
  select distinct
    (regexp_match(upper(po_id),'^\s*(?:D?PO|NSA|TS)\s+([0-9]{3,6})\s*([A-Z0-9]*)\s*$'))[1] core,
    (regexp_match(upper(po_id),'^\s*(?:D?PO|NSA|TS)\s+([0-9]{3,6})\s*([A-Z0-9]*)\s*$'))[2] tag
  from so_item_po_lines where po_id ~* '^\s*(D?PO|NSA|TS)\s+[0-9]{3,6}'
)
select count(*), round(sum(od.doc_total),2), od.resolved_by
from od join pl on pl.core=od.core and pl.tag=od.tag and od.tag<>''
left join netsuite_pos n on n.core=od.core
where n.core is null group by 3;

-- Documents whose doc # never reached any order
with docs as (
  select lower(trim(dd->>'doc')) doc
  from so_item_po_lines p, lateral jsonb_array_elements(p.sizes->'_bill_details') dd
  where jsonb_typeof(p.sizes->'_bill_details')='array'
  union
  select lower(trim(dd->>'doc'))
  from sales_orders so, lateral jsonb_array_elements(coalesce(so.deco_pos,'[]'::jsonb)) dp,
       lateral jsonb_array_elements(
         case when jsonb_typeof(dp->'_bill_details')='array' then dp->'_bill_details' else '[]'::jsonb end) dd
)
select status, source_type, count(*) n,
  count(*) filter (where lower(trim(coalesce(supplier_doc_number,'~'))) not in (select doc from docs where doc is not null)
                     and lower(trim(coalesce(applied_doc_number,'~'))) not in (select doc from docs where doc is not null)
                     and lower(si_doc_number::text) not in (select doc from docs where doc is not null)) not_landed
from si_documents group by 1,2;
```

**Code read for root cause:** `src/App.js` (`_siTriage` 25173, `_autoCaptureOutside` 25228,
`loadSiQueue` 25244, `_applyBillsToPortal` 29341 incl. the save gate at 29369-29380,
`_validateBillForPush` 29016, `_pushAllOverride` 29494), `src/sportsLink.js`
(`siPoOrigin` 85, `scoreSiPoMatch` 95, `rankSiPoCandidates` 161),
`netlify/functions/bill-anomaly-digest.js`, `supabase/migrations/00147_si_documents_queue.sql`,
`00178`/`00184` (applied_bills), `00222_netsuite_pos.sql`.
