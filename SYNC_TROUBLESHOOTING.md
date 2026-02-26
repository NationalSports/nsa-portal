# NSA Portal — Supabase Sync Troubleshooting Guide

## How Data Sync Works

1. **On page load**: The app checks Supabase for existing data. If data exists, it loads it.
2. **Seed lock**: If Supabase tables are empty, the first browser to load will "seed" the database with sample data. A `_seed_lock` row in the `app_state` table prevents multiple browsers from seeding at the same time.
3. **Auto-save**: When you edit an estimate, SO, customer, etc., the app compares against a snapshot of the last DB state and only writes changed records to Supabase.
4. **Realtime subscriptions**: The app listens for Supabase realtime events so changes from one browser show up in others.
5. **Polling fallback**: Every 30 seconds, the app re-fetches all data from Supabase as a safety net.

## Common Issues & Fixes

### Issue: Different data across browsers (e.g., 5 estimates in Chrome, 10 in Firefox)

**Cause**: The seed lock got stuck. One browser started seeding but failed partway through. Other browsers see the lock, skip seeding, and fall back to their own stale localStorage data.

**Fix**:
1. Open Supabase Dashboard → Table Editor → `app_state`
2. Find the row with `key = '_seed_lock'`
3. Delete that row (or set `value` to `{"status":"failed"}`)
4. Refresh all browsers — the first one will re-seed

### Issue: Console shows `[DB] Another browser is seeding — waiting to reload`

**Cause**: The `_seed_lock` row in `app_state` has `status: "seeding"` but the seeding browser crashed or closed.

**Fix**: Same as above — delete or reset the `_seed_lock` row in `app_state`.

### Issue: Supabase tables are completely empty (0 rows)

**Cause**: A previous seed attempt failed (FK constraint violations, column mismatches, etc.) and the lock got stuck in "seeding" or "done" state with no actual data.

**Fix**:
1. Delete the `_seed_lock` row from `app_state`
2. Clear localStorage in ALL browsers (DevTools → Application → Local Storage → Clear)
3. Refresh one browser and let it seed successfully
4. Then refresh others

### Issue: 409 Conflict errors during seeding

**Cause**: Foreign key constraint violations. For example:
- `customers.primary_rep_id` references a `team_members` row that wasn't inserted yet
- `customers.parent_id` references a customer not yet inserted (child inserted before parent)

**Fix**: The app now handles this automatically by:
- Nulling out invalid FK references before insert
- Inserting parent-less customers before children
- If you still see 409s, check the Supabase logs for which FK is failing

### Issue: 400 "Could not find column" errors

**Cause**: The app's UI adds extra properties to objects (like `vendor_id` on estimate items) that don't exist in the database table.

**Fix**: The app now uses column whitelists (`_pick()` helper) to strip unknown columns before sending to Supabase. If you add new columns to the DB schema, you also need to update the corresponding whitelist array in `App.js`:
- `_estCols` — estimate columns
- `_soCols` — sales order columns
- `_itemCols` — item columns (shared by estimate_items and so_items)
- `_decoCols` — decoration columns
- `_custCols` — customer columns

### Issue: Auto-save writing too many records / feedback loops

**Cause**: Without snapshot-based diffing, every state change would re-save ALL records. If browser A and B both save, they can overwrite each other in a loop.

**Fix**: The app now uses `_dbSnap` (a ref holding the last known DB state) and `_diffSave` (a function that only writes records that differ from the snapshot). This is automatic — no manual intervention needed.

## Nuclear Reset (Last Resort)

If sync is completely broken and you want to start fresh:

1. **Supabase**: Delete all rows from ALL tables (or just the ones with bad data). Be careful with `app_state` and `app_settings` — only delete the `_seed_lock` row.
2. **All browsers**: Clear localStorage (DevTools → Application → Local Storage → Clear for the app's domain)
3. **Refresh one browser**: Let it seed the database
4. **Refresh other browsers**: They'll pick up the seeded data

## Checking Supabase Health

- **Table Editor**: Check row counts in key tables (estimates, sales_orders, customers, team_members)
- **app_state table**: Look for `_seed_lock` row — if it exists with `status: "seeding"`, that's the lock
- **SQL Editor**: Run `SELECT key, value FROM app_state WHERE key = '_seed_lock';` to check lock status
- **Logs**: Check Supabase Dashboard → Logs → PostgREST for any 4xx/5xx errors
