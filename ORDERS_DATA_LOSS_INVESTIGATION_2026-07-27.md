# Orders Data-Loss Investigation — 2026-07-27

**Trigger:** Jered Hunt reported losing "a bunch of stuff from orders over the weekend."
Follow-up pointer: **OLU tennis, SO-1468**.

**Method:** forensic reconstruction from `public.audit_log` (append-only, 645k rows) plus a
read of the SO save path in `src/lib/dbEngine.js`. Every claim below that is marked
CONFIRMED has a specific audit row or a quoted line of code behind it. Claims that are
inference are marked as such.

---

## 1. Executive summary

**The loss did not happen over the weekend, and it is not one incident.** SO-1468
(Orange Lutheran Girl's Tennis) lost two garment lines on **July 13 and July 14** and sat
in that state for eleven days. Nothing touched SO-1468 between Fri Jul 24 18:59 UTC and
Mon Jul 27 15:27 UTC — the weekend is when Jered *noticed*, not when the data went.

Jered has already rebuilt both lines himself this morning (Jul 27, 15:27–15:45 UTC).
Sizes and decorations came back correct. **What did not come back are the vendor PO
lines** — see §3, this is the one item needing action today.

The mechanism is a real defect, not user error: the SO save performs a full
delete-and-reinsert of `so_items` on every save, and **the guard that is supposed to stop
a short client list from deleting real rows explicitly waves the write through whenever
the session loaded items cleanly** (`dbEngine.js:1276`). "Loaded cleanly at some point"
is not the same as "is still complete at save time," and the code treats them as
equivalent. A second, independent hole means some of these losses cannot even be
*detected* by the count guard (§4.2).

Same-shaped losses are visible across at least 12 other orders and 8 different users,
including two artist accounts that have no business editing garment lines at all.

---

## 2. What actually happened to SO-1468

Reconstructed from `audit_log` (`table_name='so_items'`, `so_id='SO-1468'`). The SO row's
`_version` trail is unbroken across all of it — **144 → 172, no gaps, no conflicts** —
which is itself the tell: not one of these writes was flagged as a concurrent edit.

| When (UTC) | Who | Role | DB had | Client wrote | Result |
|---|---|---|---|---|---|
| Jul 13 18:13 | Jered | rep | 12 rows / 6 items | 6 | Healed a duplicate-row state. Correct. |
| **Jul 13 21:13:27** | **Jered** | rep | **6 items** | **5** | **`JN1969` Adidas CLUB SKIRT / White — deleted** |
| **Jul 14 00:54:54** | **Erik Nagashima** | **artist** | **5 items** | **4** | **`JW4303` Adidas M Fleece Crew / Heather Grey — deleted** |
| Jul 14 – Jul 24 | various | | 4 items | 4 | Order operated on as a 4-line order |
| Jul 27 15:27–15:45 | Jered | rep | 4 → 6 | 6 | Rebuilt both lines by hand |

Detail on the two losses:

- **JN1969 CLUB SKIRT** was at `item_index` 2 of 6. Jered's client wrote a 5-item list
  re-indexed 0–4 with the skirt absent. The six deleted rows carried distinct indexes
  0–5, so this was *not* the duplicate-collapse bug (§4.2) — his session's list was
  simply short. Whether he removed it deliberately and then wanted it back cannot be
  determined from the audit log. **Not proven either way.**
- **JW4303 M Fleece Crew** was deleted by **Erik Nagashima's artist session**. This one is
  hard to read as intentional: artists work the art/proof queue, and the deleted rows again
  carried distinct indexes, so his loaded list was short by one before he ever saved. His
  session then wrote its whole item list over the DB's. **CONFIRMED defect-shaped.**

---

## 3. Open operational gap on SO-1468 — needs action

The two rebuilt lines are back with correct sizes and decorations, but they are **not on
order with the vendor**:

| Line | Sizes | Decorations | **PO lines** |
|---|---|---|---|
| IN1181 ADIZERO E Tank | ✅ | 2 | **1** |
| KF0972 CLUB DRESS | ✅ | 2 | **1** |
| JX4499 W SS Pregame | ✅ | 2 | **1** |
| A592-50 Space Dyed Polo | ✅ | 2 | **1** |
| **JW4303 M Fleece Crew** | ✅ | 2 | **0 ← missing** |
| **JN1969 CLUB SKIRT** | ✅ | 1 (matches pre-loss) | **0 ← missing** |

SO-1468 status is `need_order`, expected date **2026-08-04** — eight days out. Someone
needs to raise the vendor PO for those two garments. This is the only item on this
investigation that is time-critical.

---

## 4. Root cause

### 4.1 The hydrated-session trust fallthrough — CONFIRMED

Every SO save deletes the order's `so_items` rows and reinserts the client's list
(`dbEngine.js:1717–1722`). The count-mismatch guard at `dbEngine.js:1274` is the thing
standing between a short client list and permanent deletion. Its first branch:

```js
if(oldItemIds.length>0 && _clientSoItemCount!==_oldDistinctItemIndexCount){
  if(so._itemsHydrated||_everHydratedItems.has(so.id)){
    console.warn('[DB] SO',so.id,'saving with',_clientSoItemCount,'item(s) (DB had',…,
                 ') — items were hydrated, treating as intentional edit');
  }
```

The guard **notices** the discrepancy and proceeds anyway, on a `console.warn`. No block,
no user-visible warning, no `_dataLossAlert`, no `stale_save_log` row. `_itemsHydrated` is
set at load time (`dbEngine.js:513`) and only records that the load did not time out — it
carries no information about whether the list is still complete when the save fires.

This is exactly what happened to Erik's Jul 14 save: DB 5, client 4, session hydrated,
line deleted silently.

The only thing that can catch a stale-but-hydrated tab is the stale-content guard at
`dbEngine.js:1206`, and it is gated on `_versionConflict` being set — see 4.3.

### 4.2 `item_index` dedup can hide the loss from the guard entirely — CONFIRMED

On load, `dbEngine.js:494` collapses `so_items` rows that share an `item_index`, keeping
the one with the most children:

```js
_soItemsRaw.forEach(it=>{const cur=_itemByIdx.get(it.item_index); …});
```

It was written for phantom rows left by an interrupted save swap, and for that case it is
correct. But it collapses **any** index collision, including two genuinely different
products — and there is **no unique constraint on `(so_id, item_index)`** to prevent that
state. Verified against `pg_indexes`: `so_items` has only `so_items_pkey`,
`idx_so_items_so_id`, `idx_so_items_product_id`.

The compounding problem is that the guard counts the same way. `_oldDistinctItemIndexCount`
(`dbEngine.js:1179`) is a count of **distinct `item_index` values**, so when the loader
drops a colliding row, client count and DB distinct-index count agree and
`_clientSoItemCount !== _oldDistinctItemIndexCount` is **false**. The guard never fires at
all — not even the `console.warn`. The row is deleted with no trace anywhere.

### 4.3 The version check has a 60-second blind spot — CONFIRMED

`_checkVersion` (`dbEngine.js:661`):

```js
if(_dbRecentSaves[id]&&Date.now()-_dbRecentSaves[id]<60000)return true;
```

For 60 seconds after this client's own successful save, the version check is skipped
entirely and returns "no conflict." `_versionConflict` stays `null`, which disarms both
the deco-PO restore (`:1113`) and the stale-content guard (`:1206`).

This is intended as own-echo suppression, but it does not distinguish this client's echo
from *another user's write that landed in the same window*. On a busy order — SO-1468 saw
14 saves from two users inside five minutes on Jul 24 (v195→v207, Jered and Erik
interleaving) — saves land inside each other's 60-second windows routinely. The unbroken
version trail across that burst is the evidence: two users, ten writes, zero conflicts
detected.

**Note:** on Jul 24 no items were lost on SO-1468 (insert and delete counts match
throughout). This blind spot is a live hazard on that order, not the proven cause of its
two losses. Stated as a distinct finding, not folded into the incident.

---

## 5. Scope beyond SO-1468

A detector pairing each `so_items` INSERT batch with the DELETE batch that follows it
within 20 seconds (this is what a save looks like in the audit log) finds these net-item-loss
saves. Between Jul 6 and Jul 27 the same shape appears on **at least 12 orders across 8
users**, including:

| SO | When (UTC) | Who | Role | Lost |
|---|---|---|---|---|
| SO-1218 | Jul 16 14:01 | Mo | **artist** | 5 |
| SO-1268 | Jul 14 07:45 | Mo | **artist** | 1 |
| SO-1468 | Jul 14 00:54 | Erik Nagashima | **artist** | 1 |
| SO-1482 | Jul 10 17:20 | Erik Nagashima | **artist** | 1 |
| SO-1131 | Jul 10 21:35 | Mo | **artist** | 1 |
| SO-1348 | Jul 14 15:30 | Irving Santos | **warehouse** | 1 |
| SO-1031 | Jul 14 14:31 | Irving Santos | **warehouse** | 1 |
| SO-1288 | Jul 13 20:24 | Dylan Aassness | **prod_manager** | 1 |
| SO-1598 | Jul 20 17:09, 17:21 | Vic Damian | csr | 1 each |
| SO-1607 | Jul 20 20:54 | Sharon Day-Monroe | csr | 1 |
| SO-1573 | Jul 17 14:38 | Steve Peterson | admin | 6 |
| SO-1531 | Jul 24 19:14 | Steve Peterson | admin | 1 |

**Read this table carefully.** For reps, CSRs and admins, deleting a line is a normal
thing to do and the audit log cannot distinguish a deliberate removal from a silent
overwrite. The rows worth treating as presumptive defects are the ones by **artist,
warehouse and prod_manager accounts** — those roles have no workflow reason to remove a
garment line, and each of their sessions still rewrote the entire item set.

A companion query listing SKUs that appear in `so_items` history since Jun 1 but are absent
from the live table returns ~60 candidate lines across ~35 orders. That list is **a
starting point for review, not a list of confirmed losses** — most are ordinary deletions.
Both queries are reproduced in §8 so anyone can re-run them.

---

## 6. What I could not determine

- **Why the short client lists were short in the first place.** For both SO-1468 losses
  the DB rows carried distinct `item_index` values, which rules out the §4.2
  duplicate-collapse for those two specific events. Something upstream handed those
  sessions an incomplete item list while `_itemsHydrated` was still `true`. Candidates
  worth checking next: whether the art dashboard builds its own filtered item list before
  saving, and the paging path in `_safeQuery` (`dbEngine.js:115`), which only sets
  `_lastLoadTimedOut` on an actual page *error* — a load that returns short for any other
  reason still reports itself as hydrated. **Unproven; I did not chase it to ground.**
- **Whether Jered's Jul 13 removal of the CLUB SKIRT was deliberate.** The audit log
  records what changed, not intent.
- **Whether any of the ~60 candidate lines in §5 are real losses.** That needs someone
  who knows the orders to eyeball them.

---

## 7. Recommended fixes, in priority order

1. **Raise the vendor PO for JW4303 and JN1969 on SO-1468.** Ship date is Aug 4. (Ops, today.)
2. **Add a unique constraint on `(so_id, item_index)`** to `so_items`. This removes the
   precondition for §4.2 outright. Requires cleaning existing duplicates first.
3. **Make the hydrated branch at `dbEngine.js:1276` fail loud instead of silent.** A save
   that reduces the item count should at minimum emit `_dataLossAlert` and a
   `stale_save_log` row so these stop being invisible. Ideally it should require the
   removed lines to match a session-local tombstone set (the editor knows which lines the
   user actually deleted — the same pattern `_deletedDecoPoIds` already uses for deco POs
   at `:1116`).
4. **Narrow the `_dbRecentSaves` echo suppression** so it keys on this client's own
   expected version rather than a 60-second wall-clock window — e.g. skip only when the
   server version equals the version this client's last save produced.
5. **Stop non-sales roles from rewriting `so_items` at all.** An artist saving a proof
   should not be able to delete a garment line. This is the cheapest fix with the broadest
   blast-radius reduction, and it would have prevented five of the twelve incidents in §5.

Items 2–5 are code/schema changes and are **not** implemented in this commit — this
document is the investigation only.

---

## 8. Reproducing the queries

Net-item-loss detector (pairs each INSERT batch with the DELETE batch that follows it):

```sql
select w.so_id, w.changed_at, u.email, tm.role,
       w.prev_n as client_wrote, w.n as db_had, w.n - w.prev_n as lost
from (
  select so_id, op, changed_at, changed_by, n,
         lag(n)          over (partition by so_id order by changed_at) prev_n,
         lag(op)         over (partition by so_id order by changed_at) prev_op,
         lag(changed_at) over (partition by so_id order by changed_at) prev_at
  from (
    select coalesce(new_data->>'so_id', old_data->>'so_id') so_id,
           op, changed_at, changed_by, count(*) n
    from public.audit_log
    where table_name='so_items' and changed_at >= '2026-07-06'
    group by 1,2,3,4
  ) g
) w
left join auth.users u on u.id = w.changed_by
left join public.team_members tm on lower(tm.email) = lower(u.email)
where w.op='DELETE' and w.prev_op='INSERT'
  and w.changed_at - w.prev_at < interval '20 seconds'
  and w.n > w.prev_n
order by w.changed_at desc;
```

Candidate-loss list (SKUs seen in history but absent from the live table):

```sql
with hist as (
  select coalesce(new_data->>'so_id', old_data->>'so_id') so_id,
         lower(coalesce(new_data->>'sku',   old_data->>'sku',''))   sku,
         lower(coalesce(new_data->>'color', old_data->>'color','')) color,
         max(coalesce(new_data->>'name', old_data->>'name')) nm,
         max(changed_at) last_seen
  from public.audit_log
  where table_name='so_items' and changed_at >= '2026-06-01'
  group by 1,2,3
),
cur as (
  select so_id, lower(coalesce(sku,'')) sku, lower(coalesce(color,'')) color
  from public.so_items
)
select h.so_id, h.nm, h.sku, h.color, h.last_seen
from hist h
left join cur c on c.so_id=h.so_id and c.sku=h.sku and c.color=h.color
where c.so_id is null and h.so_id is not null
  and exists (select 1 from public.sales_orders s where s.id=h.so_id and s.deleted_at is null)
order by h.last_seen desc;
```

Note: `audit_log.changed_by` holds the `auth.users` id, which is **not** the same as
`team_members.id`. Join through `auth.users.email` as above.

Timestamps throughout this document are UTC. Local time is UTC-7.
