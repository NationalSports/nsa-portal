import { stableStringify } from './staleRowMerge';

// ─── Route art/job-only order saves to the light path ───
//
// The Art Dashboard (mockup/seps uploads, production-files confirmation, status moves, artist
// assignment) saved through savSO, which persists the WHOLE order: header, and every line item
// with its decorations, picks and PO lines deleted and re-inserted. One seps upload on SO-2444
// (2026-10-12) produced 6 such rewrites in 20 seconds and 6 order-version bumps, which then
// rejected a rep's next edit in a tab left open overnight.
//
// When a save changes nothing but art files and/or jobs, it can go through _dbSaveArtJobs, which
// writes only those rows and leaves the order header (and its _version) alone. Anything else —
// a changed item, header field, shipment, or a REMOVED job (deletion needs the full save's
// guarded delete path) — keeps the full save.

const ART_JOB_KEYS = new Set(['art_files', 'jobs', 'updated_at']);

const withoutArtJobs = so => {
  const rest = {};
  Object.keys(so || {}).forEach(k => { if (!ART_JOB_KEYS.has(k)) rest[k] = so[k]; });
  return rest;
};

export function isArtJobsOnlyChange(prev, next) {
  if (!prev || !next || prev.id !== next.id) return false;
  if (prev._version == null) return false;                 // never saved: the full save creates it
  if (Array.isArray(next._deleteJobIds) && next._deleteJobIds.length) return false;
  const artChanged = stableStringify(prev.art_files || []) !== stableStringify(next.art_files || []);
  const jobsChanged = stableStringify(prev.jobs || []) !== stableStringify(next.jobs || []);
  if (!artChanged && !jobsChanged) return false;          // nothing to save here; let the normal path decide
  if (jobsChanged) {
    const nextIds = new Set((next.jobs || []).map(j => j && j.id).filter(Boolean));
    if ((prev.jobs || []).some(j => j && j.id && !nextIds.has(j.id))) return false;
  }
  return stableStringify(withoutArtJobs(prev)) === stableStringify(withoutArtJobs(next));
}

// Decide how App should persist an order save. 'full' is the unchanged whole-order save; 'art'
// writes art rows only; 'artJobs' writes art and job rows. `opts` other than `before` (e.g.
// exactAttempt for a reviewed recovery) always force a full save, as does a database without the
// header-touch RPC (touchAvailable false), so the light paths can never silently skip propagation.
export function planOrderSave(before, so, { opts, touchAvailable = true } = {}) {
  const { before: _ignored, ...rest } = opts || {};
  const fullOpts = Object.keys(rest).length ? rest : undefined;
  if (!so || !so.id || fullOpts || !touchAvailable || !isArtJobsOnlyChange(before, so)) return { kind: 'full', fullOpts };
  const jobsChanged = stableStringify(before.jobs || []) !== stableStringify(so.jobs || []);
  return { kind: jobsChanged ? 'artJobs' : 'art' };
}

// Key-order-independent JSON lives with the stale-row merge; re-exported for existing callers.
export { stableStringify };
