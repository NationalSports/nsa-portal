// Art-board split families.
//
// Splitting a job (Split Job → by received / by SKU / custom) partitions ONE decoration's units
// across several jobs. Every slice carries the SAME artwork — the split copies art_file_id /
// _art_ids / art_status straight off the parent (_artFields in OrderEditor). On the art dashboard
// each slice still surfaced as its own card, so one design read as two jobs to draw, two mockups
// to send and two approvals to chase, and the halves could drift apart (one approved, the other
// still Waiting for Art) because every art action wrote to a single job id.
//
// These helpers collapse a split family into one card. Grouping is deliberately conservative:
// members must be on the same SO, in the same split family, AND declare the same art. A slice
// whose artwork was later re-pointed at a different design is not the same work and keeps its own
// card — silently merging it would hide a design from the artist.

const _key = (soId, id) => String(soId || '') + '|' + String(id || '');

/**
 * The design set a job declares, as a stable string. Multi-design jobs carry `_art_ids`;
 * single-design jobs carry `art_file_id`. The TBD placeholder is not a design.
 */
export function jobArtKey(j) {
  const src = (j && Array.isArray(j._art_ids) && j._art_ids.length) ? j._art_ids : [j && j.art_file_id];
  const ids = [...new Set(src.filter((id) => id && id !== '__tbd'))].sort();
  return ids.length ? ids.join('+') : '__none__';
}

/**
 * Root job id of a split family, walking `split_from` (cycle-guarded).
 *
 * When an ancestor isn't in the supplied set — it was filtered off this board, or the chain
 * predates it — the walk stops and returns the missing ancestor's ID rather than the current
 * job's. Siblings that all point at that same absent parent still land on one key, which is the
 * whole point: a family must not fragment just because its root isn't on screen.
 */
export function splitFamilyRoot(job, byId) {
  let cur = job;
  const seen = new Set();
  for (let guard = 0; cur && cur.split_from && guard < 64; guard++) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    const parent = byId && byId.get(_key(cur.soId, cur.split_from));
    if (!parent) return cur.split_from;
    cur = parent;
  }
  return (cur && cur.id) || (job && job.id) || '';
}

/** Grouping key: same order + same split family + same declared artwork. */
export function artFamilyKey(job, byId) {
  return _key(job && job.soId, splitFamilyRoot(job, byId)) + '|' + jobArtKey(job);
}

/**
 * Collapse split families in `jobs` into one entry each.
 *
 * `rankOf(job)` orders board progress (lower = less advanced). The LEAST-advanced member
 * represents its family, mirroring the worst-case rule mergeJobsArtState already uses for merges:
 * the card has to land in the column that still has work left and offer the buttons that work
 * needs, so a family can never over-report as approved while a slice still needs art.
 *
 * The representative is returned as a copy carrying `_famIds` / `_famMembers` / `_famUnits`;
 * ungrouped jobs are returned untouched (no marker), so callers can treat a missing `_famIds` as
 * "just this job". Input order is preserved by first appearance of each family.
 */
export function consolidateArtFamilies(jobs, rankOf) {
  const list = (jobs || []).filter(Boolean);
  const byId = new Map();
  list.forEach((j) => { if (j.id) byId.set(_key(j.soId, j.id), j); });

  const groups = new Map();
  list.forEach((j) => {
    const k = artFamilyKey(j, byId);
    const g = groups.get(k);
    if (g) g.push(j); else groups.set(k, [j]);
  });

  const rank = typeof rankOf === 'function' ? rankOf : () => 0;
  const out = [];
  groups.forEach((members) => {
    if (members.length === 1) { out.push(members[0]); return; }
    let rep = members[0];
    members.forEach((m) => {
      if (rank(m) < rank(rep)) { rep = m; return; }
      // Tie: the family root speaks for the family — it's the job number the rep knows.
      if (rank(m) === rank(rep) && !m.split_from && rep.split_from) rep = m;
    });
    out.push({
      ...rep,
      _famIds: members.map((m) => m.id),
      _famMembers: members,
      _famUnits: members.reduce((a, m) => a + (Number(m.total_units) || 0), 0),
    });
  });
  return out;
}

/** Job ids an art action taken on `job`'s card must write to. */
export function artFamilyIds(job) {
  const ids = (job && Array.isArray(job._famIds) && job._famIds.length) ? job._famIds : [job && job.id];
  return ids.filter(Boolean);
}
