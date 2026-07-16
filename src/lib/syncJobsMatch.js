/**
 * syncJobs existing-job matching.
 *
 * Jobs are primarily matched by stable decoration signature (`job.key`). When a
 * key changes (regroup / position rename), we fall back to `art_file_id` so
 * workflow fields aren't lost.
 *
 * That fallback is unsafe when multiple jobs share one art file. Copying the
 * first job registered for that art id bleeds `rejections` / `coach_rejected` /
 * `art_status` onto the sibling — approved jobs get shot back to Waiting for Art
 * with another garment's coach comment. (Investigated after SO-1159; that order
 * may also be a coach reject on the wrong job — the bleed class is real either way.)
 *
 * Rules:
 *  1. Prefer exact key match.
 *  2. Art-id fallback only when exactly one non-split existing job owns that art id.
 *  3. Never hand the same existing job to two rebuilt jobs in one sync pass.
 */

/** Count how many non-split jobs reference each art id. */
export function countJobsByArtId(existingJobs) {
  const counts = {};
  (existingJobs || []).forEach((j) => {
    if (!j || j.split_from) return;
    const ids = j._art_ids || [j.art_file_id].filter(Boolean);
    ids.forEach((aid) => {
      if (!aid) return;
      counts[aid] = (counts[aid] || 0) + 1;
    });
  });
  return counts;
}

/**
 * Build lookup maps for syncJobs.
 * `existingByArtId` only indexes art ids owned by exactly one non-split job.
 */
export function buildExistingJobLookups(existingJobs) {
  const existingJobMap = {};
  const existingByArtId = {};
  const artIdCounts = countJobsByArtId(existingJobs);
  (existingJobs || []).forEach((j) => {
    if (!j || j.split_from) return;
    existingJobMap[j.key || j.id] = j;
    const ids = j._art_ids || [j.art_file_id].filter(Boolean);
    ids.forEach((aid) => {
      if (!aid || artIdCounts[aid] !== 1) return;
      if (!existingByArtId[aid]) existingByArtId[aid] = j;
    });
  });
  return { existingJobMap, existingByArtId, artIdCounts };
}

/**
 * Resolve which existing job a rebuilt job should inherit workflow state from.
 * @param {{key?:string, art_file_id?:string|null}} built
 * @param {{existingJobMap:object, existingByArtId:object}} lookups
 * @param {Set<string>} claimedIds — existing job ids already matched this pass
 * @returns {{existing: object|null, matchedBy: 'key'|'art_file_id'|null}}
 */
export function matchExistingJob(built, lookups, claimedIds = new Set()) {
  const { existingJobMap, existingByArtId } = lookups || {};
  if (!built) return { existing: null, matchedBy: null };

  const byKey = built.key != null ? existingJobMap?.[built.key] : null;
  if (byKey) {
    if (byKey.id) claimedIds.add(byKey.id);
    return { existing: byKey, matchedBy: 'key' };
  }

  const aid = built.art_file_id;
  if (!aid) return { existing: null, matchedBy: null };

  const byArt = existingByArtId?.[aid];
  if (!byArt) return { existing: null, matchedBy: null };
  if (byArt.id && claimedIds.has(byArt.id)) return { existing: null, matchedBy: null };

  if (byArt.id) claimedIds.add(byArt.id);
  return { existing: byArt, matchedBy: 'art_file_id' };
}

/**
 * Drop frozen-job decoration claims whose LIVE decoration is a different method.
 *
 * Released/merged jobs claim decorations positionally (item_idx + deco_idx). If those
 * indexes drift — a line deleted through a client that didn't remap (SO-1468: a stale
 * pre-2cad58a tab), or a decoration's method changed after release — the frozen job keeps
 * claiming decorations that now belong to another method. syncJobs then skips them when
 * grouping, so the REAL job for that method is never rebuilt and gets deleted (SO-1468:
 * the polo's embroidery job vanished because a released screen-print job claimed its
 * embroidery decorations).
 *
 * A claim whose live decoration resolves to a DIFFERENT deco type than the job cannot be
 * legitimate — release it. A claim with no live item/decoration behind it is kept: that is
 * the existing deleted-line preservation semantics (snapshot rows survive so released work
 * doesn't go blank on a bad save).
 *
 * @param {object} job — a released/merged job (has deco_type and items[] with deco claims)
 * @param {(itemIdx:number, decoIdx:number) => string|null} resolveLiveDecoType — returns the
 *   live decoration's resolved method at that position, or null when item/deco doesn't exist
 * @returns {{job: object, changed: boolean}} — job with stale claims removed (rows whose
 *   every claim mismatched are dropped entirely); `changed` false returns the original ref
 */
export function dropMismatchedFrozenClaims(job, resolveLiveDecoType) {
  const jobType = job?.deco_type || null;
  if (!jobType) return { job, changed: false };
  let changed = false;
  const items = [];
  (job.items || []).forEach((gi) => {
    const dis = Array.isArray(gi.deco_idxs) && gi.deco_idxs.length
      ? gi.deco_idxs
      : (gi.deco_idx != null ? [gi.deco_idx] : []);
    const kept = dis.filter((di) => {
      const liveType = resolveLiveDecoType(gi.item_idx, di);
      return liveType == null || liveType === jobType;
    });
    if (kept.length === dis.length) { items.push(gi); return; }
    changed = true;
    if (kept.length === 0) return; // every claimed deco belongs to another method now
    items.push({ ...gi, deco_idx: kept[0], deco_idxs: kept });
  });
  return { job: changed ? { ...job, items } : job, changed };
}

/**
 * Re-point a frozen job's art identity at the artwork its LIVE decorations now carry.
 *
 * Released/merged jobs freeze art_file_id/_art_ids/positions as a snapshot stamped at
 * release/merge time. When a rep swaps the artwork on a claimed decoration afterward
 * (same method — cross-method drift is dropMismatchedFrozenClaims' job), the snapshot
 * keeps describing art that is no longer on the garment: the job header shows the old
 * design, run-together suggestions match on the old art name (SO-1348: a shorts job kept
 * advertising "5in Wide S Crest Football" after its line was re-pointed at the 2.5in
 * crest, and suggested linking to the real football job on another order), and the art
 * gate tracks the wrong file's approval.
 *
 * Claims resolve via `resolveLiveArtClaim(itemIdx, decoIdx)`:
 *   - {artFileId, position} — live art decoration whose art file is loaded
 *   - null                  — nothing to learn from here (deleted line, non-art deco,
 *                             unassigned/TBD art, outsourced): the claim is skipped,
 *                             preserving the deleted-line snapshot semantics
 *   - 'unresolved'          — an art decoration whose file isn't hydrated yet: ABORTS
 *                             the heal (never re-stamp identity off a half-loaded order)
 *
 * Art ids re-stamp only when the resolved id SET differs from the declared one; positions
 * ride along. art_name is intentionally untouched here — released jobs refresh it from
 * the live files via the existing name heal (which honors _name_locked), and merged jobs
 * keep their hand-picked label. `artChanged` tells the caller to recompute art_status
 * against the new files.
 */
export function healFrozenJobArtDrift(job, resolveLiveArtClaim) {
  const declared = ((job?._art_ids && job._art_ids.length ? job._art_ids : [job?.art_file_id]) || [])
    .filter((id) => id && id !== '__tbd');
  if (!declared.length) return { job, changed: false, artChanged: false };
  const ids = []; const seen = new Set();
  const positions = []; const posSeen = new Set();
  for (const gi of (job.items || [])) {
    const dis = Array.isArray(gi.deco_idxs) && gi.deco_idxs.length
      ? gi.deco_idxs
      : (gi.deco_idx != null ? [gi.deco_idx] : []);
    for (const di of dis) {
      const r = resolveLiveArtClaim(gi.item_idx, di);
      if (r === 'unresolved') return { job, changed: false, artChanged: false };
      if (!r || !r.artFileId) continue;
      if (!seen.has(r.artFileId)) { seen.add(r.artFileId); ids.push(r.artFileId); }
      const p = String(r.position || '').trim();
      if (p && !posSeen.has(p)) { posSeen.add(p); positions.push(p); }
    }
  }
  if (!ids.length) return { job, changed: false, artChanged: false };
  const same = ids.length === declared.length && declared.every((id) => seen.has(id));
  if (same) return { job, changed: false, artChanged: false };
  const healed = { ...job, art_file_id: ids[0], _art_ids: ids };
  if (positions.length) healed.positions = positions.join(', ');
  return { job: healed, changed: true, artChanged: true };
}

/**
 * Workflow fields that must not cross-contaminate across distinct jobs.
 * Copied only when matchExistingJob found a real match (key or unique art id).
 */
export function inheritJobWorkflowFields(existing) {
  if (!existing) {
    return {
      rejections: null,
      coach_rejected: null,
      sent_to_coach_at: null,
      coach_approved_at: null,
      coach_email_opened_at: null,
      art_requests: [],
      art_messages: [],
      assigned_artist: null,
      rep_notes: null,
    };
  }
  return {
    art_requests: existing.art_requests || [],
    art_messages: existing.art_messages || [],
    assigned_artist: existing.assigned_artist || null,
    rep_notes: existing.rep_notes || null,
    rejections: existing.rejections || null,
    sent_to_coach_at: existing.sent_to_coach_at || null,
    coach_approved_at: existing.coach_approved_at || null,
    coach_email_opened_at: existing.coach_email_opened_at || null,
    coach_rejected: existing.coach_rejected || null,
  };
}

/**
 * art_status advancement order, least → most advanced. The three production-files states
 * (dtf/emb/screen) are one tier — an approved design awaiting its production files.
 */
const ART_STATUS_RANK = {
  needs_art: 0, art_requested: 1, art_in_progress: 2, waiting_approval: 3,
  production_files_needed: 4, order_dtf_transfers: 4, upload_emb_files: 4, art_complete: 5,
};
const rankArtStatus = (s) => (ART_STATUS_RANK[s] != null ? ART_STATUS_RANK[s] : 0);

/**
 * Art + approval state for a job formed by merging several jobs.
 *
 * Art and approvals must SURVIVE a merge (the whole point of the Merge Jobs action was
 * losing them — it reset every merge to Needs Art). The merged job therefore carries:
 *   - the UNION of every source design (`_art_ids`), so no design is dropped;
 *   - the LEAST-ADVANCED `art_status` among the sources — a design still needing art keeps
 *     the whole job needing art, so a partial merge can never over-report as approved. This
 *     is the same worst-case `healFrozenJobArtDrift` derives from live decorations, computed
 *     eagerly so approval isn't lost in the window before the next sync. The value is copied
 *     from an ACTUAL source (never synthesized) so the correct production-files variant is kept.
 *   - the UNION of the append-only workflow logs (`art_requests` / `art_messages` /
 *     `sent_history` / `rejections`), so artist requests and rejection reasons survive.
 *
 * Coach approval is reported (`coachApproved`) only when EVERY source was coach-approved and
 * none was rejected; the caller clears the coach columns otherwise so a partial merge can't
 * read as customer-approved. Rejection reasons still survive in the unioned `rejections`.
 *
 * @param {object[]} sources — jobs being merged, TARGET FIRST (its label/artist win ties)
 * @returns {{art_status,art_file_id,_art_ids,assigned_artist,art_requests,art_messages,sent_history,rejections,coachApproved}}
 */
export function mergeJobsArtState(sources) {
  const jobs = (sources || []).filter(Boolean);
  const target = jobs[0] || {};
  let worst = target;
  jobs.forEach((j) => { if (rankArtStatus(j.art_status) < rankArtStatus(worst.art_status)) worst = j; });
  const artIds = [...new Set(
    jobs
      .flatMap((j) => (j._art_ids && j._art_ids.length ? j._art_ids : [j.art_file_id]))
      .filter((id) => id && id !== '__tbd'),
  )];
  const uniqBy = (arr, keyOf) => {
    const seen = new Set(); const out = [];
    (arr || []).forEach((x) => { const k = keyOf(x); if (!seen.has(k)) { seen.add(k); out.push(x); } });
    return out;
  };
  const rkey = (x) => x && String(x.id || x.created_at || JSON.stringify(x));
  const rejections = uniqBy(jobs.flatMap((j) => j.rejections || []), rkey);
  const coachApproved = artIds.length > 0
    && jobs.every((j) => j.coach_approved_at)
    && !jobs.some((j) => j.coach_rejected);
  return {
    art_status: worst.art_status || 'needs_art',
    art_file_id: artIds[0] || target.art_file_id || null,
    _art_ids: artIds,
    assigned_artist: target.assigned_artist || jobs.map((j) => j.assigned_artist).find(Boolean) || null,
    art_requests: uniqBy(jobs.flatMap((j) => j.art_requests || []), rkey),
    art_messages: uniqBy(jobs.flatMap((j) => j.art_messages || []), rkey),
    sent_history: uniqBy(jobs.flatMap((j) => j.sent_history || []), rkey),
    rejections: rejections.length ? rejections : null,
    coachApproved,
  };
}
