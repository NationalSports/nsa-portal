/**
 * syncJobs existing-job matching.
 *
 * Jobs are primarily matched by stable decoration signature (`job.key`). When a
 * key changes (regroup / position rename / assigning real art to an unassigned
 * decoration), we fall back to the live item+decoration claims and then to
 * `art_file_id` so workflow fields and split lineage aren't lost.
 *
 * That fallback is unsafe when multiple jobs share one art file. Copying the
 * first job registered for that art id bleeds `rejections` / `coach_rejected` /
 * `art_status` onto the sibling — approved jobs get shot back to Waiting for Art
 * with another garment's coach comment. (Investigated after SO-1159; that order
 * may also be a coach reject on the wrong job — the bleed class is real either way.)
 *
 * Rules:
 *  1. Prefer exact key match.
 *  2. Claim fallback only when every overlapping claim points to one non-split job.
 *  3. Art-id fallback only when exactly one non-split existing job owns that art id.
 *  4. Never hand the same existing job to two rebuilt jobs in one sync pass.
 */

/** Stable item+decoration claims carried by a job snapshot. */
export function jobDecoClaimKeys(job) {
  const keys = new Set();
  (job?.items || []).forEach((gi) => {
    if (!gi || gi.item_idx == null) return;
    const dis = Array.isArray(gi.deco_idxs) && gi.deco_idxs.length
      ? gi.deco_idxs
      : (gi.deco_idx != null ? [gi.deco_idx] : []);
    dis.forEach((di) => keys.add(String(gi.item_idx) + '::' + String(di)));
  });
  return [...keys];
}

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
 *
 * `preservedIds` — ids of jobs the caller is preserving verbatim this pass
 * (released/merged snapshots). Those jobs are excluded from BOTH lookups: a
 * rebuilt job necessarily covers decorations the frozen job does NOT claim, so
 * matching one would hand the frozen job's id to the rebuilt job and the final
 * dedupe-by-id would silently drop the preserved snapshot — approval history,
 * coach send, and the frozen garment claims with it (SO-1664: a qty edit added
 * a line sharing a merged job's logo; the one-line rebuild stole JOB-1664-01
 * via the art-id fallback and every garment got shot back to Waiting Approval).
 * A released job that RETIRED this pass (dead claims / all outsourced) is not
 * in `preservedIds`, so its rebuilt successor still inherits workflow state.
 */
export function buildExistingJobLookups(existingJobs, preservedIds) {
  const pool = (existingJobs || []).filter(
    (j) => j && !(preservedIds && j.id && preservedIds.has(j.id)),
  );
  const existingJobMap = {};
  const existingByArtId = {};
  const existingByDecoClaim = {};
  const artIdCounts = countJobsByArtId(pool);
  const claimOwners = {};
  pool.forEach((j) => {
    if (!j || j.split_from) return;
    jobDecoClaimKeys(j).forEach((claim) => {
      if (!claimOwners[claim]) claimOwners[claim] = [];
      claimOwners[claim].push(j);
    });
  });
  pool.forEach((j) => {
    if (!j || j.split_from) return;
    existingJobMap[j.key || j.id] = j;
    jobDecoClaimKeys(j).forEach((claim) => {
      if (claimOwners[claim]?.length === 1) existingByDecoClaim[claim] = j;
    });
    const ids = j._art_ids || [j.art_file_id].filter(Boolean);
    ids.forEach((aid) => {
      if (!aid || artIdCounts[aid] !== 1) return;
      if (!existingByArtId[aid]) existingByArtId[aid] = j;
    });
  });
  return { existingJobMap, existingByArtId, existingByDecoClaim, artIdCounts };
}

/**
 * Resolve which existing job a rebuilt job should inherit workflow state from.
 * @param {{key?:string, art_file_id?:string|null}} built
 * @param {{existingJobMap:object, existingByArtId:object}} lookups
 * @param {Set<string>} claimedIds — existing job ids already matched this pass
 * @returns {{existing: object|null, matchedBy: 'key'|'deco_claim'|'art_file_id'|null}}
 */
export function matchExistingJob(built, lookups, claimedIds = new Set()) {
  const { existingJobMap, existingByArtId, existingByDecoClaim } = lookups || {};
  if (!built) return { existing: null, matchedBy: null };

  const byKey = built.key != null ? existingJobMap?.[built.key] : null;
  if (byKey) {
    if (byKey.id) claimedIds.add(byKey.id);
    return { existing: byKey, matchedBy: 'key' };
  }

  // Assigning artwork changes the signature from an unassigned token to the real art id.
  // The item_idx+deco_idx claim does not change, so it is the safest identity fallback. Only
  // accept one unambiguous owner: a newly consolidated build can overlap several old jobs,
  // and arbitrarily stealing one of those ids would lose the others' workflow history.
  const claimMatches = [...new Set(jobDecoClaimKeys(built)
    .map((claim) => existingByDecoClaim?.[claim])
    .filter(Boolean))];
  if (claimMatches.length === 1) {
    const byClaim = claimMatches[0];
    if (!byClaim.id || !claimedIds.has(byClaim.id)) {
      if (byClaim.id) claimedIds.add(byClaim.id);
      return { existing: byClaim, matchedBy: 'deco_claim' };
    }
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
 * Repair a split child whose stored parent id no longer exists.
 *
 * A regroup used to mint a new root id when art was assigned after a by-SKU split. The
 * child kept pointing at the retired root, so the rebuilt root reclaimed the child's
 * garment at full quantity and Merge Back failed with "Parent job ... not found". When
 * exactly one current root covers every decoration claim carried by the orphan, that root
 * is the displaced parent. Re-point the child; ambiguous/no-claim cases remain untouched.
 */
export function reparentOrphanSplitJobs(jobs) {
  const list = (jobs || []).filter(Boolean);
  const ids = new Set(list.map((j) => j.id).filter(Boolean));
  const roots = list.filter((j) => j.id && !j.split_from);
  const rootClaims = new Map(roots.map((j) => [j.id, new Set(jobDecoClaimKeys(j))]));
  let changed = false;
  const repaired = list.map((j) => {
    if (!j?.split_from || ids.has(j.split_from)) return j;
    const claims = jobDecoClaimKeys(j);
    if (!claims.length) return j;
    const candidates = roots.filter((root) => {
      const owned = rootClaims.get(root.id);
      return claims.every((claim) => owned.has(claim));
    });
    if (candidates.length !== 1) return j;
    changed = true;
    return { ...j, split_from: candidates[0].id };
  });
  return changed ? repaired : list;
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
 * @param {Iterable<string>=} expectedTypes — the method set this job may legitimately claim.
 *   Defaults to [job.deco_type] (released/auto jobs are single-method by construction). A
 *   merged job passes the deco types of its DECLARED designs, so a legit cross-type merge
 *   keeps both methods' claims while a claim drifting onto a method the job never declared
 *   is still recognized as stale (SO-1023: a merged embroidery job's claims drifted onto
 *   screen-print decos and the art heal adopted the foreign designs into the job).
 * @returns {{job: object, changed: boolean}} — job with stale claims removed (rows whose
 *   every claim mismatched are dropped entirely); `changed` false returns the original ref
 */
export function dropMismatchedFrozenClaims(job, resolveLiveDecoType, expectedTypes) {
  const expected = new Set(expectedTypes || []);
  if (!expected.size && job?.deco_type) expected.add(job.deco_type);
  if (!expected.size) return { job, changed: false };
  let changed = false;
  const items = [];
  (job.items || []).forEach((gi) => {
    const dis = Array.isArray(gi.deco_idxs) && gi.deco_idxs.length
      ? gi.deco_idxs
      : (gi.deco_idx != null ? [gi.deco_idx] : []);
    const kept = dis.filter((di) => {
      const liveType = resolveLiveDecoType(gi.item_idx, di);
      return liveType == null || expected.has(liveType);
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
 * True when the healed art-id set kept EVERY previously-declared design and only ADDED ids —
 * a new print location placed on garments that already carried the old design(s) (e.g. a
 * "Back Marketing" print added to shirts that already had the approved front logo).
 *
 * On a pure expansion the existing designs' art_status must be preserved. The heal's caller
 * otherwise recomputes the job's status as the WORST per-file state across all ids, so a freshly
 * added location sitting at 'uploaded' dragged a submitted (waiting_approval) job all the way back
 * to needs_art — and that regressed status was SAVED, hiding a submitted proof from the order page
 * (SO-1625 / JOB-1625-01). A real art-identity change (a declared design removed or swapped) is NOT
 * an expansion and still recomputes, which is what the heal exists for.
 */
export function isPureArtExpansion(declaredIds, healedIds) {
  const declared = (declaredIds || []).filter(Boolean);
  const healed = new Set((healedIds || []).filter(Boolean));
  return declared.length > 0 && healed.size > declared.length && declared.every((id) => healed.has(id));
}

/**
 * Prod statuses meaning a job's press run is CLOSED — the work came off the floor. Deliberately
 * narrower than DECO_OR_LATER_STATUSES (which also counts staging/in_process): a job still in line
 * or on press can legitimately absorb another garment, a finished one cannot.
 */
export const CLOSED_PROD_STATUSES = ['completed', 'shipped'];

export const isClosedJob = (job) => !!job && CLOSED_PROD_STATUSES.includes(job.prod_status);

/**
 * Partition a rebuilt job's garment rows against the run its CLOSED predecessor committed to.
 *
 * The auto-builder groups every live decoration sharing a signature into one job, so a garment
 * added to the SO after that job finished — a reprint for misprinted pieces, a late add-on — lands
 * on the finished job and re-opens it: SO-1514's JOB-1514-02 went from 26/26 Items Received and
 * shipped back to 26/35 Partially Received when 9 replacement tees were added, and the whole
 * design re-billed at the new qty tier. Added garments are a NEW press run and belong in their
 * own job (what a rep does by hand with ✂️ Split).
 *
 * Rows match on (item_idx, sku) — the identity the split/merge paths already key on. Only WHOLE
 * rows move: a quantity bump on a garment the closed run already printed is left alone, because a
 * plain auto job stores no per-size record of what that run committed to, so any share we carved
 * off it would be a guess.
 *
 * @param {object[]} rebuiltItems — the freshly built job's rows
 * @param {object[]} committedItems — the closed job's saved rows
 * @returns {{keep: object[], added: object[]}}
 */
export function splitClosedJobAdditions(rebuiltItems, committedItems) {
  const committed = new Set();
  (committedItems || []).forEach((gi) => { if (gi) committed.add(gi.item_idx + '-' + gi.sku); });
  const keep = []; const added = [];
  (rebuiltItems || []).forEach((gi) => {
    if (!gi) return;
    (committed.has(gi.item_idx + '-' + gi.sku) ? keep : added).push(gi);
  });
  return { keep, added };
}

/**
 * Prod statuses at which a frozen job may still be re-shaped by the consolidation below. A job
 * that is staging/in_process (in line, on press, clocked in) or finished has committed to the
 * run it was printed for — its garment/decoration set must not change underneath the floor.
 */
const CONSOLIDATABLE_PROD_STATUSES = new Set(['', 'draft', 'hold', 'ready']);

/** True when a frozen job hasn't started and can safely absorb / claim more decorations. */
const isOpenForConsolidation = (j) => !!j
  && CONSOLIDATABLE_PROD_STATUSES.has(j.prod_status || '')
  && !j.decorated_at && !j.packed_at && !j.run1_done && !j.run2_done
  && !j.split_from && !j.split_group
  && !(j.items || []).some((gi) => gi && (gi._artSplit || gi.split_group));

const decoIdxsOf = (gi) => (Array.isArray(gi?.deco_idxs) && gi.deco_idxs.length
  ? gi.deco_idxs
  : (gi?.deco_idx != null ? [gi.deco_idx] : []));

const rowKeyOf = (gi) => gi.item_idx + '-' + (gi.sku || '');
const jobRowSig = (j) => (j.items || []).map(rowKeyOf).sort().join('|');

/** Union of a job's declared methods — deco_type plus every entry of deco_types. */
const methodsOf = (j) => [j?.deco_type, ...(Array.isArray(j?.deco_types) ? j.deco_types : [])].filter(Boolean);

const joinUnique = (parts) => [...new Set(parts.map((p) => String(p || '').trim()).filter(Boolean))].join(', ');

/**
 * ── Frozen-job decoration consolidation ──
 *
 * A garment carrying several in-house decorations belongs on ONE production job — one sheet, one
 * unit count. The auto-builder already groups that way (`__combined`), but it CANNOT touch a
 * decoration a released/merged job froze. So the moment one decoration on a garment is released
 * for art, every other decoration on that same garment is locked out of the frozen job and forms a
 * second job: the floor gets one sheet per decoration type for the same physical garments, and the
 * board's Total Units counts those garments once per sheet (SO-1605: 18 jerseys → an 18-unit patch
 * job plus an 18-unit numbers job = 36; SO-1774 / SO-1766 / SO-1598 / SO-1777 / SO-1905 the same).
 *
 * Two passes, both restricted to frozen jobs that have not started (isOpenForConsolidation):
 *
 *   1. ABSORB — frozen siblings covering the SAME garment rows with DISJOINT decoration claims are
 *      one job that got split; fold them into the first. Skipped when the sources disagree on coach
 *      state, so a merge can never invent (or destroy) a customer approval.
 *   2. EXPAND — a frozen job claims any remaining in-house decoration on the garments it already
 *      owns, provided nothing else has claimed it. That is exactly the auto-builder's own rule,
 *      applied to the rows the frozen job holds.
 *
 * art_status is never recomputed by either pass. ABSORB takes the least-advanced status among its
 * sources (mergeJobsArtState), so a merge can only under-report. EXPAND relies on the caller
 * marking any decoration with live art workflow as `consolidatable:false` — a design still being
 * proofed keeps its own job until it settles, so nothing strands a coach approval mid-flight and no
 * job can read further along than the artwork it now carries.
 *
 * @param {object[]} frozenJobs — released + merged jobs, already claim-healed, in stable order
 * @param {(itemIdx:number) => Array<{deco_idx:number,kind:string,method:string,position:string,
 *          art_file_id?:string|null,label:string,consolidatable:boolean}>|null} resolveItemDecos
 *        — the live in-house decorations on that garment line, or null when the line is gone or
 *          not fully hydrated (then the row is left untouched). `consolidatable:false` marks a
 *          decoration that must keep its own job: a split-art share, or artwork not yet finished.
 * @param {Set<string>=} reservedPairs — 'itemIdx::decoIdx' pairs owned by a NON-frozen job that has
 *        already started; never claimed away from it.
 * @returns {{jobs: object[], absorbedIds: string[], changed: boolean}}
 */
export function consolidateFrozenJobDecos(frozenJobs, resolveItemDecos, reservedPairs) {
  const jobs = (frozenJobs || []).filter(Boolean);
  if (jobs.length === 0) return { jobs, absorbedIds: [], changed: false };
  const reserved = reservedPairs || new Set();
  const pairKey = (ii, di) => ii + '::' + di;

  // ── Pass 1: absorb frozen siblings covering identical garment rows ──
  const absorbedIds = [];
  const absorbed = new Set();
  const bySig = new Map();
  jobs.forEach((j, idx) => {
    if (!isOpenForConsolidation(j) || !(j.items || []).length) return;
    const sig = jobRowSig(j);
    if (!bySig.has(sig)) bySig.set(sig, []);
    bySig.get(sig).push(idx);
  });
  const merges = new Map();// target index -> merged job
  bySig.forEach((idxs) => {
    if (idxs.length < 2) return;
    const group = idxs.map((i) => jobs[i]);
    // Disjoint claims only: overlapping decoration claims mean these are size/art SPLITS of the
    // same work, not complementary halves of one garment's decoration set.
    const seen = new Set();
    for (const j of group) {
      for (const gi of (j.items || [])) {
        for (const di of decoIdxsOf(gi)) {
          const k = pairKey(gi.item_idx, di);
          if (seen.has(k)) return;
          seen.add(k);
        }
      }
    }
    // Coach state must agree — otherwise a merge would either strand a rejection or let one
    // design's approval speak for another's. Leave those split (status quo) rather than guess.
    if (group.some((j) => j.coach_rejected)) return;
    const approved = group.filter((j) => j.coach_approved_at).length;
    if (approved !== 0 && approved !== group.length) return;

    const targetIdx = idxs[0];
    const target = jobs[targetIdx];
    const others = idxs.slice(1).map((i) => jobs[i]);
    const art = mergeJobsArtState(group);
    const rowDecos = new Map();
    group.forEach((j) => (j.items || []).forEach((gi) => {
      const k = rowKeyOf(gi);
      if (!rowDecos.has(k)) rowDecos.set(k, new Set());
      decoIdxsOf(gi).forEach((di) => rowDecos.get(k).add(di));
    }));
    const items = (target.items || []).map((gi) => {
      const dis = [...(rowDecos.get(rowKeyOf(gi)) || [])].sort((a, b) => a - b);
      return { ...gi, deco_idx: dis[0] != null ? dis[0] : gi.deco_idx, deco_idxs: dis };
    });
    merges.set(targetIdx, {
      ...target,
      items,
      _art_ids: art._art_ids,
      art_file_id: art.art_file_id,
      art_status: art.art_status,
      assigned_artist: art.assigned_artist,
      art_requests: art.art_requests,
      art_messages: art.art_messages,
      sent_history: art.sent_history,
      rejections: art.rejections,
      // Keep every source's declared methods so the next pass's stale-claim heal recognises the
      // absorbed decorations as legitimate (_declaredMethodSet reads deco_type + deco_types).
      deco_types: [...new Set(group.flatMap(methodsOf))],
      positions: joinUnique(group.flatMap((j) => String(j.positions || '').split(','))),
      prod_status: group.map((j) => j.prod_status).find((s) => s === 'hold' || s === 'ready') || target.prod_status,
      numbers_done: group.map((j) => j.numbers_done).find((n) => n && Object.keys(n).length > 0) || target.numbers_done || null,
      _released: group.some((j) => j._released) || target._released || undefined,
      _merged: true,
    });
    others.forEach((j) => { absorbed.add(j); if (j.id) absorbedIds.push(j.id); });
  });
  let out = jobs.map((j, i) => merges.get(i) || j).filter((j) => !absorbed.has(j));

  // ── Pass 2: claim the remaining in-house decorations on garments a frozen job already owns ──
  const claimed = new Set(reserved);
  out.forEach((j) => (j.items || []).forEach((gi) => decoIdxsOf(gi).forEach((di) => claimed.add(pairKey(gi.item_idx, di)))));
  out = out.map((j) => {
    if (!isOpenForConsolidation(j)) return j;
    const addedArtIds = []; const addedMethods = []; const addedPositions = [];
    let touched = false;
    const items = (j.items || []).map((gi) => {
      const live = resolveItemDecos(gi.item_idx);
      if (!live) return gi;// line gone or not hydrated — leave the snapshot alone
      const dis = decoIdxsOf(gi);
      const add = live.filter((d) => d.consolidatable && !claimed.has(pairKey(gi.item_idx, d.deco_idx)));
      if (!add.length) return gi;
      add.forEach((d) => {
        claimed.add(pairKey(gi.item_idx, d.deco_idx));
        if (d.art_file_id && d.art_file_id !== '__tbd') addedArtIds.push(d.art_file_id);
        if (d.method) addedMethods.push(d.method);
        if (d.position) addedPositions.push(d.position);
      });
      touched = true;
      const next = [...new Set([...dis, ...add.map((d) => d.deco_idx)])].sort((a, b) => a - b);
      return { ...gi, deco_idx: next[0] != null ? next[0] : gi.deco_idx, deco_idxs: next };
    });
    if (!touched) return j;
    const declared = (j._art_ids && j._art_ids.length ? j._art_ids : [j.art_file_id]).filter((id) => id && id !== '__tbd');
    const artIds = [...new Set([...declared, ...addedArtIds])];
    return {
      ...j,
      items,
      ...(artIds.length ? { _art_ids: artIds, art_file_id: j.art_file_id || artIds[0] } : {}),
      deco_types: [...new Set([...methodsOf(j), ...addedMethods])],
      positions: joinUnique([...String(j.positions || '').split(','), ...addedPositions]),
      _merged: true,
    };
  });
  return { jobs: out, absorbedIds, changed: absorbedIds.length > 0 || out.some((j, i) => j !== jobs[i]) };
}

/**
 * Describe one garment line's live IN-HOUSE decorations for the consolidation above.
 *
 * Kept here rather than in the editors because both copies need the identical reading of a
 * decoration, and because the `consolidatable` rule is the load-bearing one: it decides whether a
 * decoration may be folded into a frozen job.
 *
 *   - Anything routed to an outside decorator is not in-house work and is omitted entirely.
 *   - Numbers / names always consolidate — they carry no art workflow to strand.
 *   - Art consolidates only once its file reaches `art_complete`. A design still being proofed
 *     keeps its own job so folding it in can't move garments out from under an open art request or
 *     coach send, and can't leave a job reading further along than the artwork it carries. Judged on
 *     the FILE, not the owning job's stored art_status, which goes stale (SO-1774's patch job still
 *     read waiting_approval long after its file was approved with production files attached).
 *   - Split-art shares carry their own per-size allocation and always keep their own job.
 *
 * Returns null when the caller can't vouch for the line (missing, or art declared but not hydrated)
 * — never reshape a frozen job off a half-loaded order.
 *
 * @param {object[]} decos — the line's decorations, in index order
 * @param {{findArt:(id:string)=>object|undefined, artStatusOf:(art:object|null,fallbackDt:string)=>string,
 *          isOutsourced:(deco:object, method:string)=>boolean}} deps
 */
export function liveItemDecoDescriptors(decos, deps) {
  const { findArt, artStatusOf, isOutsourced } = deps || {};
  const out = [];
  const list = Array.isArray(decos) ? decos : [];
  for (let di = 0; di < list.length; di += 1) {
    const d = list[di];
    if (!d) continue;
    if (d.kind !== 'art' && d.kind !== 'numbers' && d.kind !== 'names') continue;
    let method; let label; let artFileId = null; let consolidatable = true;
    if (d.kind === 'art') {
      const artF = d.art_file_id ? findArt(d.art_file_id) : null;
      if (d.art_file_id && d.art_file_id !== '__tbd' && !artF) return null;// declared art not hydrated
      method = (artF && artF.deco_type) || d.deco_type || 'screen_print';
      label = (artF && artF.name) || ('Unassigned Art (' + String(d.position || '') + ')');
      artFileId = d.art_file_id || null;
      const isSplitShare = !!(d.split_group && d.split_sizes && Object.keys(d.split_sizes).length > 0);
      consolidatable = !isSplitShare && artStatusOf(artF || null, d.deco_type) === 'art_complete';
    } else if (d.kind === 'numbers') {
      method = d.num_method || 'heat_transfer';
      label = 'Numbers — ' + method.replace(/_/g, ' ');
    } else {
      method = d.name_method || 'heat_press';
      label = 'Names — ' + method.replace(/_/g, ' ');
    }
    if (isOutsourced(d, method)) continue;
    out.push({
      deco_idx: di, kind: d.kind, method, position: String(d.position || ''),
      art_file_id: artFileId, label, consolidatable,
    });
  }
  return out;
}

/**
 * Display labels for the non-art decorations a frozen job claims ("Numbers — heat transfer",
 * "Names — embroidery"), in the auto-builder's wording and order.
 *
 * A released job's art_name is refreshed from its linked ART files only, so a job that consolidated
 * a numbers/names decoration would still read as the logo alone on the board and the job sheet.
 * Same resolver as consolidateFrozenJobDecos; deduped because one roster spans many garment lines.
 */
export function frozenJobNonArtLabels(job, resolveItemDecos) {
  const out = []; const seen = new Set();
  (job?.items || []).forEach((gi) => {
    const live = resolveItemDecos(gi.item_idx);
    if (!live) return;
    const dis = new Set(decoIdxsOf(gi));
    live.forEach((d) => {
      if (!dis.has(d.deco_idx) || d.kind === 'art' || !d.label || seen.has(d.label)) return;
      seen.add(d.label); out.push(d.label);
    });
  });
  return out;
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
      sent_history: null,
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
    sent_history: existing.sent_history || null,
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

/**
 * (item_idx-sku) keys of the garments owned by the split slices under `parentId` —
 * TRANSITIVELY across the whole split family, not just direct children.
 *
 * syncJobs uses this to keep the parent's rebuild from re-adding a garment a split
 * carved off. Scanning only direct children (`split_from === parentId`) misses a
 * slice of a slice: SO-1634 split KC4512 off to JOB-1634-01-B, then split it again
 * to JOB-1634-01-B-B — the grandchild's garment matched no direct child, so every
 * sync re-added the full 27-unit line to JOB-1634-01 and the family double-counted
 * the joggers (0/27 on both jobs, 29→56 units on the board).
 *
 * `excludeSlice(job)` marks slices whose claims are preserved elsewhere this pass
 * (released/merged snapshots hold their garments via frozenItemDecos, so those rows
 * never reach the rebuild and must not be treated as slice-owned here). Excluded
 * slices still link the family walk — a slice under a merged slice still owns its
 * garments.
 *
 * The walk is cycle-safe: `fam` only grows, so a corrupted split_from loop simply
 * stops adding members.
 */
export function splitSliceOwnedKeys(jobs, parentId, excludeSlice) {
  const owned = new Set();
  if (!parentId) return owned;
  const list = (jobs || []).filter((j) => j && j.id);
  const fam = new Set([parentId]);
  for (let grew = true; grew;) {
    grew = false;
    list.forEach((j) => {
      if (j.split_from && fam.has(j.split_from) && !fam.has(j.id)) { fam.add(j.id); grew = true; }
    });
  }
  list.forEach((j) => {
    if (j.id === parentId || !fam.has(j.id)) return;
    if (excludeSlice && excludeSlice(j)) return;
    (j.items || []).forEach((gi) => owned.add(gi.item_idx + '-' + gi.sku));
  });
  return owned;
}

/** Ids of every job in `jobId`'s split family — its root and all descendants (cycle-safe). */
export function splitFamilyMembers(jobs, jobId) {
  const list = (jobs || []).filter((j) => j && j.id);
  const byId = new Map(list.map((j) => [j.id, j]));
  let cur = byId.get(jobId);
  const seen = new Set();
  while (cur && cur.split_from && byId.has(cur.split_from) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.split_from);
  }
  const fam = new Set([(cur && cur.id) || jobId]);
  for (let grew = true; grew;) {
    grew = false;
    list.forEach((j) => {
      if (j.split_from && fam.has(j.split_from) && !fam.has(j.id)) { fam.add(j.id); grew = true; }
    });
  }
  return fam;
}

/** Slices quiet enough to prune — nobody has taken them to the floor yet. */
export const SLICE_PRUNE_STATUSES = new Set(['', 'draft', 'hold', 'ready']);

/**
 * Drop stale garment rows from PRESERVED split slices.
 *
 * The parent's rebuild drops rows a slice owns (see `splitSliceOwnedKeys`), but slices
 * themselves are preserved verbatim and never rebuilt — so a row that another member of
 * the family has since taken over sits on the slice forever. SO-1110: JN3647 was carved
 * onto JOB-1110-02-A by the closed-job addition rule while JOB-1110-02-S-S already held
 * it, leaving a 1-unit phantom job on the production board that no sync could clear.
 *
 * The stale signature is narrow on purpose: a row with NO per-size allocation (a
 * whole-line claim, the shape a rebuild produces) for a garment that ANOTHER job in the
 * same split family holds WITH an explicit per-size allocation. Every real split stamps
 * sizes on both halves (splitCustom / splitByReceived) or moves the row outright
 * (splitBySku), so a legitimate partial claim is never sizes-less while a sibling is
 * sized — which is what keeps a genuine size-partitioned split from being pruned.
 *
 * A slice whose every row is stale is a phantom and is dropped entirely. Slices already
 * in production (`SLICE_PRUNE_STATUSES`) are never touched — once work has started, the
 * row stays and a human decides.
 */
export function pruneStaleSliceRows(slices, allJobs) {
  const list = (allJobs || []).filter((j) => j && j.id);
  const num = (v) => (typeof v === 'number' && !isNaN(v) ? v : 0);
  const rowKey = (gi) => gi.item_idx + '-' + gi.sku;
  const isSized = (gi) => !!(gi && gi.sizes && Object.keys(gi.sizes).length > 0);
  const out = [];
  (slices || []).forEach((sj) => {
    if (!sj) return;
    if (!SLICE_PRUNE_STATUSES.has(sj.prod_status || '')) { out.push(sj); return; }
    const rows = sj.items || [];
    if (!rows.some((gi) => gi && !isSized(gi))) { out.push(sj); return; }
    const fam = splitFamilyMembers(list, sj.id);
    const sizedElsewhere = new Set();
    list.forEach((j) => {
      if (!fam.has(j.id) || j.id === sj.id) return;
      (j.items || []).forEach((gi) => { if (isSized(gi)) sizedElsewhere.add(rowKey(gi)); });
    });
    const kept = rows.filter((gi) => isSized(gi) || !sizedElsewhere.has(rowKey(gi)));
    if (kept.length === rows.length) { out.push(sj); return; }
    if (!kept.length) return; // every row was stale — the slice is a phantom
    const total = kept.reduce((a, gi) => a + num(gi.units), 0);
    const ful = kept.reduce((a, gi) => a + num(gi.fulfilled), 0);
    out.push({
      ...sj,
      items: kept,
      total_units: total,
      fulfilled_units: ful,
      item_status: ful >= total && total > 0 ? 'items_received' : ful > 0 ? 'partially_received' : 'need_to_order',
    });
  });
  return out;
}
