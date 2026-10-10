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

// Strictly-newer, and only when BOTH sides parse. An unparseable value means "don't know" and lets
// the normal DB merge run. We never use timestamp uncertainty as permission to overwrite the DB.
export const localRowIsNewer = (localTs, dbTs) => {
  const a = rowTimeMs(localTs), b = rowTimeMs(dbTs);
  return !isNaN(a) && !isNaN(b) && a > b;
};

const finiteVersion = value => value != null && isFinite(Number(value)) ? Number(value) : null;

// Decide only the wholesale-local fast path. `merge-db` deliberately falls through to App's
// existing field-level merge guards.
//
// A newer local timestamp does NOT prove its content was authored against the newest DB version.
// `_obBaseVersion` is the authoritative pre-auto-heal base: dbEngine sets it before changing
// `_version` after a version precheck. Adopting the DB version while retaining that stale content
// would defeat the optimistic lock and allow the next save to overwrite somebody else's changes.
// In that case the rejected draft must be preserved for explicit review and the cloud row loaded.
export const estimatePollRecencyDecision = (local, dbRow) => {
  if (!local || !dbRow || !localRowIsNewer(local.updated_at, dbRow.updated_at)) return 'merge-db';

  const localBase = finiteVersion(local._obBaseVersion ?? local._version);
  const dbVersion = finiteVersion(dbRow._version);
  if (localBase == null || dbVersion == null || dbVersion > localBase) return 'conflict';

  return 'keep-local';
};
