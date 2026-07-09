/**
 * syncJobs existing-job matching.
 *
 * Jobs are primarily matched by stable decoration signature (`job.key`). When a
 * key changes (regroup / position rename), we fall back to `art_file_id` so
 * workflow fields aren't lost.
 *
 * That fallback is unsafe when multiple jobs share one art file (hoodie + pants
 * with the same logo). Copying the first job registered for that art id bleeds
 * `rejections` / `coach_rejected` / `art_status` onto the sibling — the SO-1159
 * class ("pants comment on hoodie card", approved job shot back to Waiting for Art).
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
