# Tier 2A — Durable Edit Outbox: Design (reviewed)

**Date:** 2026-07-08 · **Status:** design approved, implementation blocked on prerequisites.
**Parent plan:** `DATA_PERSISTENCE_TIER2_PLAN.md` (merged to main in PR #1604).
**Blocked on:** the `claude/persistence-tier1` and workflow-leaks-sprint PRs merging —
both touch the same `src/lib/dbEngine.js` / `src/App.js` hydration and merge code this
feature lands in. Neither branch is on the remote yet as of this writing.

This document is the "design review at top tier" the parent plan requires before
implementing item A. Everything in *Grounding* was re-verified against current main
this session (line numbers are current-main references). Two design corrections to the
parent plan came out of that reading — see *Corrections* below.

---

## Grounding (verified this session)

- Failure paths persist **IDs only**: every `_dbSaveFailedIds.add(id)` site
  (`dbEngine.js` — estimates ~891/948/957, SOs ~1389/1525/1530, invoices ~1609–1681,
  customers ~1802/1825, products ~1971–1992, messages ~2033–2044) records the ID and an
  error message, never the payload. `nsa_save_failed_ids` is in `_LS_ESSENTIAL`
  (dbEngine.js:2150) so it survives quota pressure; the content doesn't exist anywhere
  outside React memory.
- The entity caches `nsa_sos`/`nsa_ests`/`nsa_invs`/`nsa_msgs` are written only inside
  the one-time bad-ID migration (`App.js:2040–2043`). Boot state seeds from them
  (`App.js:2048–2060`), so after a normal reload they're stale-or-empty and the
  boot merge (`App.js:2316–2324`) falls through to the DB row for a failed ID —
  `prev.find(p=>p.id===c.id)` finds nothing fresher.
- Retry machinery is state-driven: both the visibility-change retry (`App.js:3787`)
  and the backoff retry (`App.js:3814`) poke `_dbSnap.current` + `setter(prev=>[...prev])`
  and let the diff-save effects re-save **from React state**. So rehydrating a payload
  into state + leaving the ID in `_dbSaveFailedIds` is sufficient to reuse the whole
  existing retry path unchanged.
- `_forceReauth` (registered `App.js:5140–5145`, fired from `dbEngine.js:1744`)
  synchronously dispatches `nsa:version-reload-pending`, then `setCu(null)`. The
  editors' flush listeners (`OrderEditor.js:1148–1161`) run synchronously and call
  `onSave(cur)` with the full draft — but the resulting `setState` is **batched**, so
  the draft is not yet visible in committed state (`_visFlushRefs`, `App.js:3770`)
  when the next synchronous line of `_forceReauth` runs. See Correction 1.
- The recovery button (`src/index.js:133`) runs `localStorage.clear()` — wiping the
  failed-ID ledger and (today) any future outbox with it.
- Save entry points are already funneled: `_queuedEntitySave(id, entity, inner)` wraps
  estimates (dbEngine.js:959), SOs (:1548), art-file saves (:1596), and invoices
  (:1685); customers/products/messages are plain async functions with in-scope
  payloads. Inner functions resolve `true` (saved), `false` (failed), or `'stale'`
  (superseded by a newer server copy — estimates only, ~872–904).
- Base version is available at failure time for free: `est._version` / `so._version`
  are incremented only **after** a successful save (dbEngine.js:955, :1398), so at any
  failure site `payload._version` **is** the base version the edit was made against.

## Corrections to the parent plan

**1. Session-death capture cannot be a snapshot inside `_forceReauth` alone.**
The plan says "synchronously snapshot every dirty entity in `_forceReauth` before
`setCu(null)`". That snapshot can read committed state (`_visFlushRefs.current`) for
entities already in `_dbSaveFailedIds`/`_dbSavePendingIds` — but the open editor's
draft, flushed by the event one line earlier, lives in a **batched, uncommitted**
setState at that moment and is invisible to the snapshot. Fix: capture at the save
*entry* seam instead. The flush event already delivers the full draft synchronously
into the App-level save wrappers (`onSave(cur)` → `upSO`/equivalents); those wrappers
write the payload to the outbox immediately when `_sessionDead` is set (a tiny exported
check), before/regardless of the doomed async DB attempt. `_forceReauth` then only
snapshots the failed/pending sets from committed state — which is exactly what
committed state is authoritative for.

**2. The version gate needs a same-content fast path.**
The most common "conflict" will be a save that actually committed but whose response
was lost (network died after the DB write; client recorded failure). On reload: outbox
base = v, DB = v+1, contents identical → the plan's rule raises a conflict card for a
non-conflict, training users to distrust the card. Rule addition: before gating on
versions, deep-compare outbox payload vs DB row ignoring `_version`/timestamps/
transient `_retry` fields; if equal, silently drop the outbox entry (the save
succeeded). Only then apply the version gate.

## The version-gate rule (final, load-bearing)

On boot, after `_dbLoad` delivers `d`, per outbox entry keyed `table:id`:

1. **DB row absent** → if the entry has no `baseVersion` (a never-inserted new entity),
   re-apply payload to state, keep ID in `_dbSaveFailedIds`, let the normal retry save
   it. If the entry HAS a base version, the row existed on the server and was deleted
   there — silently resurrecting it would undo a deliberate delete, so that's a
   conflict card, not an auto-apply.
2. **Content-equal** (ignoring `_version`, `updated_at`, transient fields) → drop the
   entry silently; the save actually landed.
3. **DB `_version` ≤ `baseVersion`** → re-apply payload into state ahead of the DB
   copy; keep ID failed; normal retry flow persists it. (`≤`, not `<`: equal means no
   other writer advanced the row; `<` is a restored-backup oddity — re-apply is still
   the right call, the outbox edit is the newest known state.)
4. **DB `_version` > `baseVersion`** → do **not** apply. Keep the DB copy in state,
   mark the outbox entry `conflict: true`, surface the conflict card ("unsaved edit
   from <ts>; the server has newer changes — view / apply anyway / discard").
   Apply-anyway re-applies to state and re-saves on the *current* base (estimates:
   the server-side `save_estimate` stale guard still arbitrates — we never bypass it).
5. **No `_version` on the entity** (customers, products, messages; invoices until the
   Tier-1 `_version` migration is live) → steps 1–2 as above, then conflict-card-always
   (step 4) — never silent overwrite. In practice step 2 clears most of these.

Never silently overwrite a newer server row with a stale outbox payload. A lost edit
is a bounded, visible failure; a stale clobber of another user's newer work is an
unbounded, invisible one. Every ambiguity above resolves toward "show the card."

### Interaction with the estimate stale-write guard
A `'stale'` save result today deletes the failed-ID and lets realtime heal the local
copy (dbEngine.js:872–880). Outbox parity: on `'stale'`, also remove the outbox entry.
The server-side guard already rejected the content; keeping it would re-raise a
conflict card for an edit the system has, by existing design, declared superseded.
(If we later want stale edits recoverable, that's a deliberate UX change — out of
scope here.)

## Design (final shape)

**Storage.** `nsa_outbox` in localStorage:
`{ "<table>:<id>": { table, id, payload, baseVersion, ts, attempts } }`.
- Added to `_LS_ESSENTIAL` so the 1 MB/key + 4 MB budget logic can't drop it.
- Because essential keys bypass the size caps, the outbox enforces its **own** cap
  (~1.5 MB serialized). Overflow evicts oldest-first with a loud toast + console error
  ("an unsaved edit was dropped to make room — <entity> from <ts>"). Payloads are
  stripped of known-transient fields (`_retry`) before writing.
- Every mutation is read-modify-write against localStorage (not a cached in-memory
  blob), so two tabs failing saves concurrently merge rather than clobber each other's
  entries. Last-writer still wins per-key, which is correct (same entity, newer edit).

**Write points** (all in dbEngine, one shared `_outboxAdd`/`_outboxRemove` pair):
1. On failure: at the wrapper seam, not the ~25 interior `add(id)` sites —
   `_queuedEntitySave` callers resolve `false` → `_outboxAdd(table, entity)`; resolve
   `true` → `_outboxRemove`; `'stale'` → `_outboxRemove`. Customers/products/messages:
   same logic wrapped around their three exported functions. (≈7 wrap points total,
   zero interior edits — keeps the diff small against the two in-flight branches.)
2. On session death: App-level save wrappers call `_outboxAdd` synchronously when
   `_sessionDead` (captures the flush-event draft, per Correction 1); `_forceReauth`
   additionally snapshots `_dbSaveFailedIds ∪ _dbSavePendingIds` from
   `_visFlushRefs.current` before `setCu(null)`.
3. `_handleAuthSaveFailure` gains an optional entity param from the sites that have
   the payload in scope (they all do — it's the function argument).

**Boot rehydrate.** In the `_dbLoad` completion handler (App.js ~2300), before the
existing failed-ID merge: run the gate above, apply qualifying payloads into the
initial arrays, collect conflicts into a `conflicts` state list rendered by the
existing failed-save banner UI (extended with the three actions). Discard removes the
outbox entry + failed ID; apply-anyway applies to state and lets retry save.

**Guardrails.**
- Recovery button (`index.js`): preserve `nsa_outbox`, `nsa_save_failed_ids`, and
  `nsa_save_failed_errors` across the clear (read → clear → restore).
- `beforeunload` warning (App.js:3777) extends its condition to
  `outbox non-empty || _dbSavePendingIds.size`.
- `attempts` increments per retry cycle; surfaced in the banner so a permanently
  failing entity is visible rather than silently retried forever.

## Acceptance (from the parent plan, plus the corrections)

1. Kill network → edit SO → reload → edit is back in state, banner names it, retry
   saves when network returns.
2. Advance `_version` server-side between failure and reload → conflict card, no
   silent overwrite; apply-anyway goes through the server stale guard.
3. Save commits but response lost (simulate: block only the response) → reload →
   **no** conflict card, outbox entry silently cleared (Correction 2).
4. Session death mid-edit with an open dirty editor → after re-login the draft is
   restored (Correction 1 path).
5. Recovery button preserves outbox + ledger; everything else clears.
6. Two tabs, different entities failing → both outbox entries survive (RMW check).

## Non-goals

Offline-first sync, merge UI beyond the three-action card, extending the outbox to
app_state keys (that's Tier-2C's CAS work), and recovering `'stale'`-rejected estimate
edits (existing semantics preserved).
