# Artwork — Implementation Spec: Phase 0 (Persistence) + REUSE-6 (Correctness)

**Date:** 2026-06-26
**Companion to:** `ARTWORK_RECOMMENDATIONS.md` (the plan), `ARTWORK_WORKFLOW_MAP.md` (the map)
**Scope of this spec:** the first implementation PR — stop the verified data-loss/integrity bugs. **No new features.** LOGO-1 (required canonical image + `design_id`) is specced separately at the end as the next PR.
**Guiding rule:** every write goes through a result-checked save; no new field ships without surviving the conflict + echo merges (Part 1.3 of the recommendations).

---

## 0. Wiring facts this spec is built on (verified)

| Helper | File | Returns | Persists |
|---|---|---|---|
| `savSO(s)` | `App.js:6727` | the SO object, **synchronously** | full SO later via the `[sos]` effect → `_dbSaveSO` — **fire-and-forget, no result** |
| `savArtFiles(so)` | `App.js:6787` | a **promise → true/false** | `so_art_files` **only** (not `so_jobs`) |
| `saveArtFilesNow(arts,label)` | `OrderEditor.js:2141` | promise → ok | calls `onSaveArtFiles` (= `savArtFiles`), checks `ok`, warns on failure |
| `applyPriorMock(d,toCoach)` | `OrderEditor.js:255` | — | changes **art_files AND a job's `art_status`**, then fire-and-forget `onSave` |

**Consequence:** a reuse mutation that changes both art and a job status has **no** result-checked path today. PG-1 adds one.

---

## 1. PG-1 — Result-checked saves for reuse/forward mutations

### 1.1 New: `savSONow` (App.js) — an awaitable full save
Model it on `savArtFiles` (`App.js:6787`), which already returns a truthful promise and does the snapshot-sync + `_dbSavePendingIds` dance. `savSONow` does the same for the **whole** SO (jobs included):

```
const savSONow = (s, opts) => {
  const sl = savSO(s, opts);            // existing local-state update + all its data-loss guards
  if (sl === <the refused-prev sentinel>) return Promise.resolve(false); // savSO blocked the write
  _dbSnap.current.sos = <sync sl into snapshot>;   // suppress the [sos] effect's duplicate full save
  _dbSavePendingIds.add(sl.id);                    // protect from mid-write poll merge (same as savArtFiles)
  const p = _dbSaveSO(sl);                          // the queued full persist; resolves true/false
  Promise.resolve(p).then(ok => { if (ok !== false) _markRecentlyPulled(sl.id); })
                    .finally(() => _dbSavePendingIds.delete(sl.id));
  return p;
};
```

Notes:
- Reuse `savSO`'s existing guards verbatim — do **not** bypass the empty-items refusal (`:6733`) or history snapshot.
- Mirror `savArtFiles`' snapshot-sync (`:6794-6795`) so the `[sos]` effect sees "no change" and doesn't double-persist.
- `_dbSaveSO` already goes through `_queuedEntitySave` (`App.js:1947`), so concurrent calls serialize.
- Pass to the editor as a new prop `onSaveNow` alongside the existing `onSave`/`onSaveArtFiles`.

### 1.2 New: `saveSONow` wrapper in OrderEditor (mirror of `saveArtFilesNow`)
```
const saveSONow = async (updated, label) => {
  setO(updated);
  if (onSaveNow) {
    nf('Saving ' + (label||'changes') + '...');
    const ok = await onSaveNow(updated);
    if (ok) { setSaved(true); setDirty(false); nf('✅ ' + (label||'Changes') + ' saved'); }
    else   { setDirty(true);  nf('⚠️ ' + (label||'Change') + ' applied but NOT saved — sign in again and click Save. Do NOT reload; your work is still here.','error'); }
    return ok;
  }
  onSave(updated); setSaved(true); setDirty(false); return true;   // fallback = today's behavior
};
```
This is the **exact** failure-surfacing contract `saveArtFilesNow` already uses (`OrderEditor.js:2144`).

### 1.3 Convert the reuse/forward sites to `saveSONow`
Replace the trailing `setO(u); onSave(u); setDirty(false)` with `await saveSONow(u, '<label>')` at:
- `applyPriorMock` — `OrderEditor.js:273` → label `"Reused mock"`.
- `_completeEmb` / `_orderDtf` (prod-file completion) — `OrderEditor.js:8320-8321` → `"Production files"`.
- `_autoCompleteEmbAfterUpload` — `OrderEditor.js:2149` → `"Art complete"` (already changes jobs+art; today fire-and-forget).
- The wizard release handler (the `newJobs`/`updArtFiles` commit after `OrderEditor.js:9151+`) → `"Released for art"`.
- The rep approve/reject sites that change job + art (`_approveArtTo`, the Request-Update handler `OrderEditor.js:8310-8316`).

**Out of scope (flagged, not done here):** the broader ~30-site `setDirty(false)`-regardless cleanup (06-09 audit rec #7). This PR converts only the artwork reuse/forward writes.

### 1.4 Acceptance
- A simulated `_dbSaveSO`→false (e.g., forced auth error) leaves the editor **dirty** and shows the "NOT saved — do not reload" warning; never a false "saved."
- Job `art_status` changes from reuse **persist** (regression: today they ride the fire-and-forget path).

---

## 2. PG-2 — Make `mock_links` persist (stop the silent loss)

**Decision:** persist it properly now (small, contained, reversible when LOGO-2 retires garment links). This makes a feature reps actively use actually survive reload.

### 2.1 Migration (timestamped, in `supabase/migrations/` per the hygiene rule)
```
ALTER TABLE so_art_files       ADD COLUMN IF NOT EXISTS mock_links jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE estimate_art_files ADD COLUMN IF NOT EXISTS mock_links jsonb NOT NULL DEFAULT '{}'::jsonb;
```
(Both tables — art carries over estimate→SO.)

### 2.2 Column allowlist — `src/constants.js:26-28`
- Add `'mock_links'` to `_artCols`.
- Add `'mock_links'` to `_artExtraCols` (so the schema-fallback path at `App.js:1534/1966` drops it gracefully if the column is somehow absent, instead of failing the whole upsert).

### 2.3 Conflict merge — `_mergeArtConflict`, `App.js:1167`
`mock_links` is a small `{garmentKey → sourceKey}` map. Merge like `item_mockups` but **key-level last-writer**, preferring the client's links while keeping others':
```
merged.mock_links = { ...(dbRow.mock_links||{}), ...(clientArt.mock_links||{}) };
```
Add right after the `item_mockups` block (`:1173`).

### 2.4 Echo merge — `mergeArtGroupFiles`, `utils.js:184`
Same shallow-merge so a stale poll/realtime snapshot can't drop a just-made link:
```
const ml = { ...(ext.mock_links||{}), ...(loc.mock_links||{}) };
// include ml in the change-detection short-circuit and the returned object
```
Update the `if (mf===… && !imCh) return ext` guard to also compare `ml`.

### 2.5 Test — `src/__tests__/artMerge.test.js`
- `mergeArtGroupFiles` preserves a local-only `mock_links` entry the incoming copy lacks.
- `_mergeArtConflict` (if unit-testable, else an integration note) keeps both sides' links.

### 2.6 Acceptance
- Link garment B → A, reload → link persists, B still shows A's mock, the approval gate stays satisfied (the verified bug is fixed).

---

## 3. REUSE-6 — Correctness guards (all verified bugs)

### 3.1 `applyPriorMock` must not strand `coach_rejected` — `OrderEditor.js:255-276`
At the job patch (`:272`), when moving forward:
- If `jb.coach_rejected` is true, **confirm** first (reuse the existing `_confirmResendIfRejected(jb)` helper so the message matches the rest of the app).
- Add `coach_rejected:false` to the patch: `{...jj, art_status:newJobStatus, coach_rejected:false}`.
- Applies to **both** branches (already-approved and send-to-coach).

### 3.2 Skip-Artist must not complete with zero mocks — `OrderEditor.js:9111` + `9169-9178`
Before forcing `artStatus='art_complete'` (`:9111`), compute whether each released art has a usable mock (`mockup_files`/`item_mockups`, or rep `repFiles` being promoted at `:9174`):
- If a mock exists (or `repFiles.length>0`): proceed to `art_complete` as today.
- If **none**: do **not** force complete — fall to `'waiting_approval'` and `nf('Add a mock or sample before skipping the artist — sent for approval instead.')`. (Keeps the rep moving; never lands a blank `art_complete`.)

### 3.3 Clone "+ Add" must sanitize inherited data — `OrderEditor.js:4765-4771`
On clone:
- **Production files:** keep them but set `prod_files_attached:false` and surface the existing count in the toast as a *review* prompt (it already shows the count at `:4770`); don't silently treat them as confirmed.
- **Mock links:** now that `mock_links` persists (Part 2), strip cloned `mock_links` whose source garment key isn't present on this order (prevents dangling links): `mock_links: Object.fromEntries(Object.entries(newArt.mock_links||{}).filter(([m,src]) => <both keys map to a garment on this order>))`.

### 3.4 Acceptance
- Reuse an approved-then-coach-rejected job via "already approved" → prompted; on confirm, `coach_rejected` clears and no stranded flag remains.
- Skip-Artist on art with no mock and no sample → lands `waiting_approval`, not `art_complete`.
- Clone art with prod files → they arrive **unconfirmed**; dangling mock links are dropped.

---

## 4. Test & rollout

- **Unit:** the `artMerge.test.js` additions (2.5). Run the existing suite — note 4 known-red tests on `main` (06-09 audit §E) are unrelated to art; don't let them mask new failures.
- **Manual (deploy preview), persistence-focused:**
  1. Link garments, reload → links persist (PG-2).
  2. Apply a reused mock with the network forced to fail → "NOT saved" warning, editor stays dirty (PG-1).
  3. Skip-Artist with no mock → `waiting_approval` (3.2).
  4. Reuse a coach-rejected job → confirm prompt, flag cleared (3.1).
- **Migration:** land the SQL (Part 2.1) as a timestamped file **in the same PR** as the code that uses it (hygiene rule). Verify the column exists before the allowlist change deploys, or rely on the `_artExtraCols` fallback during the window.

### Suggested commit breakdown (one PR)
1. migration + `_artCols`/`_artExtraCols` (PG-2 schema).
2. `_mergeArtConflict` + `mergeArtGroupFiles` + tests (PG-2 merges).
3. `savSONow` + `saveSONow` + reuse-site conversions (PG-1).
4. REUSE-6 guards (3.1–3.3).

---

## 5. Next PR — LOGO-1 spec (foundation for logo-based reuse)

Specced now so the foundation is clear; **build after Phase 0 is green.**

### 5.1 `design_id`
- Migration: `ADD COLUMN IF NOT EXISTS design_id text` on `so_art_files` + `estimate_art_files`.
- `constants.js`: add `'design_id'` to `_artCols` (it's a stable scalar — also add to `_ART_CONTENT_FIELDS` in `App.js:1156` so the conflict merge keeps the client's value; **not** in `_artExtraCols` unless you want fallback-drop).
- Stamp on art creation (`addArt`, `OrderEditor.js:2133`) and carry through clone (`:4766`), estimate→SO convert (`App.js:1520`), and reuse.
- Backfill migration: set `design_id` from a hash of `lower(name)||deco_type` where null.
- `priorMocks` fetch (`OrderEditor.js:222`): match on `design_id` when present, else fall back to the current `name||deco_type` key (no breakage mid-rollout).
- Test: a version-conflict merge preserves `design_id` (PG-4).

### 5.2 Required canonical image (`preview_url`)
- `preview_url` already persists and is merge-protected (`App.js:1174`) — **no schema change**.
- Gate "mark ready / send for approval / skip artist" on `preview_url` being set; if absent, prompt the rep to add the logo image (the upload already exists at `OrderEditor.js:4587`).
- This is the +1 click at creation that makes every design carry a durable, reusable visual.

### 5.3 Acceptance
- New art can't advance without a canonical image; `design_id` is present on every art row and survives reload + concurrent save; reuse matching keys off `design_id`.

> LOGO-2 (the unified "Reuse logo" picker that retires garment `mock_links`) is a later PR; once it lands, the Part 2 persistence work can be revisited to drop `mock_links` entirely.
