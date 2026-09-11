// ─── Poll-merge recency, and why it must never eat _version ───
//
// The two sides of a poll merge carry `updated_at` in DIFFERENT formats:
//   • DB     — written by the `set_updated_at` trigger, ISO:  '2026-09-11 13:44:52.177736+00'
//   • client — written by `new Date().toLocaleString()`, US locale: '9/11/2026, 6:39:18 AM'
//              (321 such assignments across src/)
//
// Compared as STRINGS those sort by first character, so '9' > '2' made the local copy win
// unconditionally for every month 3–9, regardless of the real times. (Dormant Oct–Feb, when the
// local month starts '1'.) That is the trigger behind the EST-2522 loss on 2026-09-11.
//
// Parse both sides to epoch ms instead. `toLocaleString` round-trips through `Date.parse` in the
// tab's own timezone — the same tab that produced it — so both sides land on the correct instant.

export const rowTimeMs = v => {
  if (!v) return NaN;
  const t = Date.parse(v);
  return isNaN(t) ? NaN : t;
};

// Strictly-newer, and only when BOTH sides parse. An unparseable value means "don't know" → the DB
// row wins → _version heals. Failing toward healing is the safe direction: the field-level guards
// inside the merge already protect local content, but a stranded _version cannot recover without a
// full page reload.
export const localRowIsNewer = (localTs, dbTs) => {
  const a = rowTimeMs(localTs), b = rowTimeMs(dbTs);
  return !isNaN(a) && !isNaN(b) && a > b;
};

// Keeping the local copy must NOT also keep its stale _version.
//
// _version is optimistic-concurrency bookkeeping owned by the DB, not user content. `save_estimate`
// refuses any write whose base _version is behind, so a merge that returns the local row wholesale
// strands the tab one version back — and it stays stranded, because the very next poll makes the
// same decision for the same reason. The rep keeps working into a document that can no longer be
// saved, with no error. That deadlock silently discarded 6 garments and 11 decorations from EST-2522
// (18 rejected saves over 9 minutes; base_version still 3 at the last one).
//
// Adopt the DB row's _version; keep local content.
//
// `updated_at` deliberately stays the local (newer) value: it is the very signal `localRowIsNewer`
// reads, so overwriting it with the DB's older timestamp would make the NEXT poll judge the local
// copy stale and drop the rep's unsaved lines — trading a save deadlock for visible content loss.
// A successful save refreshes both fields from the server anyway.
export const keepLocalAdoptVersion = (local, dbRow) => {
  // nothing to adopt — keep object identity so the caller's `changed()` comparison stays cheap
  if (!dbRow || dbRow._version == null || local._version === dbRow._version) return local;
  return { ...local, _version: dbRow._version };
};
