# Supabase Items/Estimates/Sales Orders Sync — Detailed Problem & Fix Reference

> Feed this document to Claude Code or any AI assistant when the sync issue reappears.

---

## The Core Problem

The NSA Portal uses a **delete-and-reinsert** strategy to save estimates and sales orders to Supabase. When a user edits an estimate or SO, the app:

1. **UPSERTS** the parent row (`estimates` or `sales_orders`)
2. **DELETES all child rows** (`estimate_items`, `so_items`, and their grandchildren like decorations, pick_lines, po_lines)
3. **RE-INSERTS** fresh child rows from React state

This creates a **race condition window** where:
- The child rows are deleted but not yet re-inserted
- A concurrent poll (every 30s) or Supabase realtime event triggers `_dbLoad()`
- `_dbLoad()` reads the estimate/SO and finds **zero items** (they were just deleted)
- That empty-items version replaces the React state
- The `useEffect` watcher on `ests`/`sos` fires, sees a "change" (items are now empty), and calls `_diffSave`
- `_diffSave` compares against `_dbSnap` and writes the **empty items** back to Supabase permanently
- The items are now lost

### Why It's Intermittent

The `_dbSaving` boolean guard (line 297 of App.js) is supposed to prevent this:
```javascript
let _dbSaving = false;
const _dbSavingGuard = async (fn) => { _dbSaving = true; try { await fn() } finally { _dbSaving = false } };
```

And `_dbLoad` checks it:
```javascript
if (_dbSaving) { console.log('[DB] Skipping load — save in progress'); return null; }
```

**But `_dbSaving` is a plain JavaScript variable, not React state.** It works most of the time because:
- The 30s poll checks `_dbSaving` before loading
- Realtime events are debounced by 2 seconds

It **fails** when:
- The save takes longer than expected (slow network, many items, large PO lines)
- Multiple saves fire in rapid succession (the guard only protects one at a time)
- A browser tab was backgrounded and the poll fires immediately on refocus
- The 2-second debounce on realtime events aligns perfectly with the save completion

---

## Architecture Overview

### Tables Involved

```
estimates (TEXT PK)
  ├── estimate_items (SERIAL PK, FK estimate_id)
  │     └── estimate_item_decorations (SERIAL PK, FK estimate_item_id)
  └── estimate_art_files (FK estimate_id)

sales_orders (TEXT PK)
  ├── so_items (SERIAL PK, FK so_id)
  │     ├── so_item_decorations (SERIAL PK, FK so_item_id)
  │     ├── so_item_pick_lines (SERIAL PK, FK so_item_id)
  │     └── so_item_po_lines (SERIAL PK, FK so_item_id)
  ├── so_art_files (FK so_id)
  ├── so_jobs (FK so_id)
  └── so_firm_dates (FK so_id)
```

### The Save Flow

```
User edits estimate/SO in UI
        ↓
React state updates (setEsts / setSos)
        ↓
useEffect fires (App.js line ~5673-5674)
        ↓
localStorage backup + _diffSave()
        ↓
_diffSave compares JSON.stringify(item) vs _dbSnap
        ↓ (only if changed)
_dbSaveEstimate(est) or _dbSaveSO(so)
        ↓
_dbSavingGuard sets _dbSaving = true
        ↓
UPSERT parent → DELETE children → RE-INSERT children
        ↓
_dbSaving = false
```

### The Load Flow

```
30s poll timer fires  ──OR──  Realtime event (debounced 2s)
        ↓
_dbLoad()
        ↓
Checks: if (_dbSaving) return null  ← THE GUARD
        ↓
Fetches all 27 tables via Promise.all
        ↓
Nests items under estimates/SOs via .filter()
        ↓
Returns { estimates, sales_orders, ... }
        ↓
setState(newEstimates), setState(newSOs)
        ↓
useEffect fires → _diffSave → compares against _dbSnap
```

---

## Specific Failure Scenarios

### Scenario 1: Race Between Save and Poll

```
T=0s    User saves SO with 10 items
T=0.1s  _dbSaveSO starts, _dbSaving = true
T=0.2s  UPSERT sales_orders row ✓
T=0.3s  DELETE all so_items ← items gone from DB
T=0.5s  INSERT item 1 of 10
...
T=2.0s  30s poll fires, checks _dbSaving (still true) → skip ✓ GOOD
...
T=3.5s  INSERT item 10 of 10
T=3.6s  _dbSaving = false
T=3.8s  30s poll fires again (or realtime debounce fires)
T=3.9s  _dbLoad() runs, reads 10 items ✓ GOOD (usually works)
```

**But if save is slow:**
```
T=0s    User saves SO with 20 items + pick_lines + po_lines
T=0.1s  _dbSaveSO starts, _dbSaving = true
T=0.2s  DELETE grandchildren (decorations, picks, POs)
T=0.5s  DELETE so_items
T=1.0s  INSERT items one-by-one (slow: each INSERT → .select('id') → INSERT decos → INSERT picks → INSERT POs)
...
T=8.0s  _dbSaving = false
T=8.0s  Realtime event fires for each inserted row → debounce starts
T=10.0s Debounced _dbLoad fires → reads complete data ✓

BUT if user edits AGAIN before the 10s mark:
T=9.0s  User makes another edit while realtime load is pending
T=9.1s  _diffSave fires for user edit, starts new _dbSaveSO
T=10.0s Debounced _dbLoad fires, _dbSaving is true → skip ✓
T=10.0s ...but the debounce from the NEW save's realtime events will fire at T=12s
         and by then _dbSaving may be false → loads partial data
```

### Scenario 2: Two Browsers Editing Same SO

```
Browser A edits SO-123, saves items [A,B,C]
Browser B edits SO-123, saves items [A,B,D]

T=0s   A: DELETE so_items WHERE so_id='SO-123' → removes all
T=0s   B: DELETE so_items WHERE so_id='SO-123' → removes all (already empty)
T=0.1s A: INSERT item A
T=0.1s B: INSERT item A  ← DUPLICATE
T=0.2s A: INSERT item B
T=0.2s B: INSERT item B  ← DUPLICATE
T=0.3s A: INSERT item C
T=0.3s B: INSERT item D
Result: SO-123 has items [A, A, B, B, C, D] — duplicates!
```

### Scenario 3: Column Mismatch (400 Error)

When a new UI field gets added to items in React state but NOT to the database schema or the `_itemCols` whitelist:

```javascript
// UI adds a field like `vendor_id` to an item
item.vendor_id = 'V-001';

// _dbSaveEstimate tries to insert it
// _pick(itemData, _itemCols) strips `vendor_id` because it's not in _itemCols
// This is fine — _pick prevents the error

// BUT if someone bypasses _pick or adds to _itemCols without adding the DB column:
// Supabase returns: 400 "Could not find column 'vendor_id' in table 'estimate_items'"
```

### Scenario 4: Foreign Key Violation (409 Error)

```
estimate_items.product_id → products.id

If an item references a product_id that doesn't exist in the products table:
409 "insert or update on table 'estimate_items' violates foreign key constraint"

This happens when:
- A product was deleted but the estimate still references it
- Product sync hasn't completed yet when estimate sync runs
- localStorage has stale product references
```

---

## The Fixes

### Fix 1: Increase the _dbSaving Guard to Cover Realtime Debounce

**Problem:** `_dbSaving` only covers the save duration, but realtime events from the save trigger a load AFTER the guard is released.

**Fix in `App.js`:**

```javascript
// BEFORE (current code, line ~297-298):
let _dbSaving = false;
const _dbSavingGuard = async (fn) => { _dbSaving = true; try { await fn() } finally { _dbSaving = false } };

// AFTER (add a cooldown after save completes):
let _dbSaving = false;
let _dbSaveCooldown = false;
const _dbSavingGuard = async (fn) => {
  _dbSaving = true;
  _dbSaveCooldown = true;
  try {
    await fn();
  } finally {
    _dbSaving = false;
    // Keep cooldown active for 3 seconds after save to block realtime reload
    setTimeout(() => { _dbSaveCooldown = false; }, 3000);
  }
};

// Then update _dbLoad check (line ~23):
// BEFORE:
if (_dbSaving) { console.log('[DB] Skipping load — save in progress'); return null; }
// AFTER:
if (_dbSaving || _dbSaveCooldown) { console.log('[DB] Skipping load — save in progress or cooling down'); return null; }
```

### Fix 2: Use Database Transactions (Preferred Long-Term Fix)

Instead of separate DELETE + INSERT calls that leave a window of inconsistency, wrap the entire save in a Supabase RPC (stored procedure):

**SQL migration to add:**

```sql
CREATE OR REPLACE FUNCTION save_estimate_atomic(
  p_estimate JSONB,
  p_items JSONB,
  p_decorations JSONB,
  p_art_files JSONB
) RETURNS void AS $$
BEGIN
  -- Upsert estimate
  INSERT INTO estimates
    SELECT * FROM jsonb_populate_record(null::estimates, p_estimate)
    ON CONFLICT (id) DO UPDATE SET
      customer_id = EXCLUDED.customer_id,
      memo = EXCLUDED.memo,
      status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at;
      -- ... all columns

  -- Delete old children (inside same transaction)
  DELETE FROM estimate_item_decorations
    WHERE estimate_item_id IN (
      SELECT id FROM estimate_items WHERE estimate_id = (p_estimate->>'id')
    );
  DELETE FROM estimate_items WHERE estimate_id = (p_estimate->>'id');

  -- Insert new items
  INSERT INTO estimate_items
    SELECT * FROM jsonb_populate_recordset(null::estimate_items, p_items);

  -- Insert new decorations
  IF p_decorations IS NOT NULL AND jsonb_array_length(p_decorations) > 0 THEN
    INSERT INTO estimate_item_decorations
      SELECT * FROM jsonb_populate_recordset(null::estimate_item_decorations, p_decorations);
  END IF;

  -- Upsert art files
  IF p_art_files IS NOT NULL AND jsonb_array_length(p_art_files) > 0 THEN
    INSERT INTO estimate_art_files
      SELECT * FROM jsonb_populate_recordset(null::estimate_art_files, p_art_files)
      ON CONFLICT (estimate_id, id) DO UPDATE SET
        url = EXCLUDED.url, name = EXCLUDED.name;
  END IF;
END;
$$ LANGUAGE plpgsql;
```

**JS call:**
```javascript
await supabase.rpc('save_estimate_atomic', {
  p_estimate: estRow,
  p_items: items.map((item, idx) => ({ ..._pick(item, _itemCols), estimate_id: est.id, item_index: idx })),
  p_decorations: allDecorations,
  p_art_files: art_files
});
```

This makes the delete-and-reinsert **atomic** — no window where items are missing.

### Fix 3: Validate Before Overwriting State (Quick Safety Net)

Add a guard in the poll/realtime reload to never overwrite a local SO/estimate with a version that has fewer items (unless the user explicitly deleted them):

```javascript
// In the poll/realtime reload handler, before setState:
const mergedEsts = d.estimates.map(newEst => {
  const current = ests.find(e => e.id === newEst.id);
  // If DB version has 0 items but local has items, keep local (likely mid-save race)
  if (current && current.items?.length > 0 && (!newEst.items || newEst.items.length === 0)) {
    console.warn(`[DB] Refusing to overwrite estimate ${newEst.id} — DB has 0 items but local has ${current.items.length}`);
    return current;
  }
  return newEst;
});
setEsts(mergedEsts);
```

### Fix 4: Add Missing Column to Whitelist (For "Could not find column" Errors)

When you add a new field to the UI that should persist to Supabase:

1. **Add the column to the database:**
```sql
ALTER TABLE estimate_items ADD COLUMN new_field_name TEXT;
-- or for so_items:
ALTER TABLE so_items ADD COLUMN new_field_name TEXT;
```

2. **Add to the whitelist in App.js (line ~303):**
```javascript
const _itemCols = ['product_id','sku','name','brand','color','nsa_cost','retail_price',
  'unit_sell','sizes','available_sizes','_colors','no_deco','is_custom',
  'custom_desc','custom_cost','custom_sell',
  'new_field_name'  // ← ADD HERE
];
```

3. **If it's a top-level estimate/SO field instead of an item field, add to `_estCols` or `_soCols` instead.**

### Fix 5: Handle FK Violations Gracefully

When `product_id` references a product that doesn't exist:

```javascript
// In _dbSaveEstimate, before inserting items:
for (let idx = 0; idx < items.length; idx++) {
  const { decorations, ...itemData } = items[idx];
  // Null out product_id if the product doesn't exist in current state
  if (itemData.product_id && !prod.find(p => p.id === itemData.product_id)) {
    console.warn(`[DB] Item references missing product ${itemData.product_id}, nulling FK`);
    itemData.product_id = null;
  }
  const { data: inserted } = await supabase.from('estimate_items')
    .insert({ ..._pick(itemData, _itemCols), estimate_id: est.id, item_index: idx })
    .select('id').single();
  // ... rest of insert
}
```

---

## Column Whitelists Reference

These are the columns the app is allowed to send to Supabase. If the DB schema changes, these MUST be updated in `App.js`:

| Whitelist | Table(s) | Location in App.js |
|-----------|----------|-------------------|
| `_estCols` | `estimates` | Line ~301 |
| `_soCols` | `sales_orders` | Line ~302 |
| `_itemCols` | `estimate_items`, `so_items` | Line ~303 |
| `_decoCols` | `estimate_item_decorations`, `so_item_decorations` | Line ~304 |
| `_custCols` | `customers` | (defined nearby) |

---

## Key Code Locations in App.js

| What | Line(s) |
|------|---------|
| Supabase client init | ~14-19 |
| `_dbLoad` (full data fetch) | ~21-150 |
| `_dbSaveEstimate` | ~155-174 |
| `_dbSaveSO` | ~175-218 |
| `_dbSaveInvoice` | ~219-231 |
| `_dbSaveCustomer` | ~232-240 |
| `_dbSaveProduct` | ~241-252 |
| `_dbDeleteEstimate` | ~265-273 |
| `_dbDeleteSO` | ~274-287 |
| `_dbSaving` guard | ~297-298 |
| `_pick` + column whitelists | ~300-304 |
| Seed lock logic | ~5491-5593 |
| `_diffSave` | ~5668 |
| `useEffect` auto-save hooks | ~5670-5676 |
| Realtime subscriptions | ~5624-5632 |
| 30s poll fallback | Nearby (search `setInterval` + `_dbLoad`) |

---

## Diagnostic Checklist

When items disappear or sync breaks, check these in order:

1. **Browser console** — Look for `[DB]` prefixed messages:
   - `[DB] Skipping load — save in progress` = guard is working
   - `[DB] so_items insert failed:` = insert error (check details)
   - `[DB] save SO:` = unhandled exception in save

2. **Supabase Dashboard → Logs → PostgREST** — Look for 4xx errors:
   - `400` = column mismatch (update whitelist)
   - `409` = FK violation (check product/customer references)
   - `403` = RLS policy blocking (shouldn't happen with allow_all, but check)

3. **Supabase Table Editor** — Check row counts:
   - `estimate_items` should have rows matching your estimates
   - `so_items` should have rows matching your SOs
   - If either is empty but parent table has rows → race condition happened

4. **localStorage** — Check `nsa_ests` and `nsa_sos`:
   - If localStorage has items but DB doesn't → save failed silently
   - If localStorage is empty → state was overwritten by empty DB read

5. **app_state → _seed_lock** — If stuck in "seeding", delete the row

---

## Emergency Recovery

If items are lost from the database but exist in a browser's localStorage:

```javascript
// Run in browser console:
const ests = JSON.parse(localStorage.getItem('nsa_ests'));
const sos = JSON.parse(localStorage.getItem('nsa_sos'));
console.log('Estimates with items:', ests?.filter(e => e.items?.length > 0).length);
console.log('SOs with items:', sos?.filter(s => s.items?.length > 0).length);
// If these have data, the app's auto-save will push them back to Supabase on next edit
// Or trigger a manual save by making a tiny edit to each affected estimate/SO
```

If all browsers lost the data, check Supabase's **Point in Time Recovery** (if on Pro plan) to restore from before the data loss.
