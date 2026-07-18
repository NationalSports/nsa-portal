/* eslint-disable */
/**
 * Adversarial gap coverage for the art pipeline's least-tested corners.
 *
 * SAFE: pure helpers only — no DB, no UI, no network. Every test here PINS the
 * CURRENT behavior of the real module under test (none are bug fixes); where the
 * pinned behavior looks surprising, the comment says so explicitly.
 */
const { jobHasUnresolvedArt } = require('../safeHelpers');
const BL = require('../businessLogic');
const { artWriteMatches, prevArtAutoWireTargets } = require('../lib/artIdentity');
const { mergeJobsArtState, dropMismatchedFrozenClaims } = require('../lib/syncJobsMatch');
const { hydrateStoreArt } = require('../lib/artGrid');

// ─────────────────────────────────────────────────────────────────────────
// 1. safeHelpers.jobHasUnresolvedArt
// ─────────────────────────────────────────────────────────────────────────
describe('jobHasUnresolvedArt', () => {
  test('archived declared art resolves as live by default, but unresolved with archivedIsUnresolved:true', () => {
    const o = {
      art_files: [{ id: 'af1', archived: true }],
      items: [{ decorations: [{ kind: 'art', art_file_id: 'af1' }] }],
    };
    const j = { art_file_id: 'af1', items: [{ item_idx: 0, deco_idxs: [0] }] };
    // Default: archived counts as a live design, so declared art resolves and the job
    // is NOT unresolved — even though its only owned deco points at the same archived file.
    expect(jobHasUnresolvedArt(j, o)).toBe(false);
    // Passive-heal guards pass archivedIsUnresolved:true: archived no longer shields the
    // job, so the owned deco (also pointing at the archived file) now IS unresolved.
    expect(jobHasUnresolvedArt(j, o, { archivedIsUnresolved: true })).toBe(true);
  });

  test('legacy numbers-only job on a shared line is not tainted by a sibling job\'s __tbd art deco', () => {
    const o = {
      art_files: [],
      // Shared SO line: a numbers deco (this job's) and a sibling's TBD art deco.
      items: [{ decorations: [{ kind: 'numbers', position: 'back' }, { kind: 'art', art_file_id: '__tbd' }] }],
    };
    // Legacy job item: no deco_idxs, and the job declares no art of its own.
    const j = { items: [{ item_idx: 0 }] };
    expect(jobHasUnresolvedArt(j, o)).toBe(false);
  });

  test('a job whose OWNED art deco has no live file behind it is unresolved', () => {
    const o = {
      art_files: [], // the referenced file doesn't exist at all
      items: [{ decorations: [{ kind: 'art', art_file_id: 'af_missing' }] }],
    };
    const j = { art_file_id: null, items: [{ item_idx: 0, deco_idxs: [0] }] };
    expect(jobHasUnresolvedArt(j, o)).toBe(true);
  });

  test('a live declared design shields the job even when an owned deco is TBD', () => {
    const o = {
      art_files: [{ id: 'af_live' }],
      items: [{ decorations: [{ kind: 'art', art_file_id: '__tbd' }] }],
    };
    const j = { art_file_id: 'af_live', items: [{ item_idx: 0, deco_idxs: [0] }] };
    expect(jobHasUnresolvedArt(j, o)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. businessLogic.buildJobs
// ─────────────────────────────────────────────────────────────────────────
describe('buildJobs — gap coverage', () => {
  test('stale needs_approval status with 0 mockups falls to needs_art (SO-1038 variant for needs_approval)', () => {
    // The existing SO-1038 regression test only proves this for status 'uploaded'; the
    // art_status branch treats 'needs_approval' identically, so pin it explicitly too.
    const o = {
      id: 'SO-100',
      items: [{ sizes: { S: 5 }, decorations: [{ kind: 'art', art_file_id: 'a1', position: 'front' }] }],
      art_files: [{ id: 'a1', name: 'Logo', deco_type: 'screen_print', status: 'needs_approval', mockup_files: [] }],
    };
    expect(BL.buildJobs(o)[0].art_status).toBe('needs_art');
  });

  test('a names/numbers-only job (no art deco) reports art_status art_complete — default means "no art gate", not "art reviewed"', () => {
    // worstArtSt starts at 'art_complete' and is only ever downgraded inside the art
    // branches. A job with zero art decorations never enters those branches, so it comes
    // out reading as "complete" purely because there is no art to gate on — NOT because
    // any art was reviewed/approved. Callers must not read this as an approval signal.
    const o = {
      id: 'SO-100',
      items: [{ sizes: { S: 5 }, decorations: [{ kind: 'numbers', num_method: 'heat_transfer', position: 'back' }] }],
      art_files: [],
    };
    const jobs = BL.buildJobs(o);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].art_status).toBe('art_complete');
  });

  test('two items with IDENTICAL art decos group into ONE job whose art_status reflects the shared art', () => {
    const o = {
      id: 'SO-100',
      items: [
        { sizes: { S: 5 }, decorations: [{ kind: 'art', art_file_id: 'a1', position: 'front' }] },
        { sizes: { M: 5 }, decorations: [{ kind: 'art', art_file_id: 'a1', position: 'front' }] },
      ],
      art_files: [{ id: 'a1', name: 'Logo', deco_type: 'screen_print', status: 'approved', prod_files_attached: true }],
    };
    const jobs = BL.buildJobs(o);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].items).toHaveLength(2);
    expect(jobs[0].art_status).toBe('art_complete');
  });

  test('one real-art item and one TBD-art item at the same position land in DIFFERENT groups', () => {
    // Signature includes the part ('art_<id>' vs 'unassigned@<position>'), so first-item-only
    // status computation (worstArtSt is derived from grp.items[0] only) is safe by
    // construction: no group can ever mix a resolved design with an unassigned one.
    const o = {
      id: 'SO-100',
      items: [
        { sizes: { S: 5 }, decorations: [{ kind: 'art', art_file_id: 'a1', position: 'front' }] },
        { sizes: { M: 5 }, decorations: [{ kind: 'art', art_file_id: null, position: 'front' }] },
      ],
      art_files: [{ id: 'a1', name: 'Logo', deco_type: 'screen_print', status: 'approved', prod_files_attached: true }],
    };
    const jobs = BL.buildJobs(o);
    expect(jobs).toHaveLength(2);
    const resolved = jobs.find((j) => j.art_status === 'art_complete');
    const unassigned = jobs.find((j) => j.art_status === 'needs_art');
    expect(resolved).toBeTruthy();
    expect(unassigned).toBeTruthy();
    expect(resolved.items).toHaveLength(1);
    expect(unassigned.items).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. artIdentity.artWriteMatches — legacy escape hatch
// ─────────────────────────────────────────────────────────────────────────
describe('artWriteMatches — legacy art with no srcCustId', () => {
  test('name+deco match is ALLOWED across customers when the art row carries no srcCustId', () => {
    // srcCustId is only checked `if (srcCustId && soCustomerId && ...)` — pre-source-tracking
    // art (srcCustId falsy) skips the customer-scope guard entirely and matches on name+deco
    // alone. This is a deliberate escape hatch for legacy rows, but it is also exactly the
    // cross-customer contamination vector (SO-1057-class: identically-named art on an
    // unrelated customer's SO) for any art row that predates source tracking.
    expect(artWriteMatches(
      { id: 'af-legacy', name: 'Front Logo', deco_type: 'screen_print' },
      { artId: 'af-other', name: 'Front Logo', decoType: 'screen_print', soCustomerId: 'unrelated-customer', srcCustId: undefined },
    )).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. syncJobsMatch.mergeJobsArtState — shared art split-decision merge
// ─────────────────────────────────────────────────────────────────────────
describe('mergeJobsArtState — same shared art approved on one job, coach_rejected on a sibling', () => {
  test('merges to coachApproved:false with the rejection preserved', () => {
    const approved = {
      art_status: 'art_complete', art_file_id: 'artShared', _art_ids: ['artShared'],
      coach_approved_at: '2026-07-01', coach_rejected: false, rejections: null,
      art_requests: [], art_messages: [], sent_history: [], assigned_artist: null,
    };
    const rejected = {
      art_status: 'art_complete', art_file_id: 'artShared', _art_ids: ['artShared'],
      coach_approved_at: '2026-07-02', coach_rejected: true,
      rejections: [{ id: 'r1', reason: 'wrong color' }],
      art_requests: [], art_messages: [], sent_history: [], assigned_artist: null,
    };
    const m = mergeJobsArtState([approved, rejected]);
    expect(m._art_ids).toEqual(['artShared']); // one shared design, not doubled
    expect(m.coachApproved).toBe(false);
    expect(m.rejections.map((r) => r.id)).toEqual(['r1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. artIdentity.prevArtAutoWireTargets — orphaned art_file_id
// ─────────────────────────────────────────────────────────────────────────
describe('prevArtAutoWireTargets — decoration pointing at a deleted/orphaned art file', () => {
  test('is neither auto-wired nor treated as an empty slot', () => {
    const clone = { id: 'af-new', name: 'Football Logo', deco_type: 'screen_print', design_id: 'd1' };
    // The decoration carries a non-empty, non-__tbd art_file_id, but existingArt no longer
    // has a record for it (deleted from the library after the deco was created).
    const items = [{ decorations: [{ kind: 'art', art_file_id: 'af_deleted' }] }];
    expect(prevArtAutoWireTargets(items, [], clone)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. syncJobsMatch.dropMismatchedFrozenClaims — undefined resolver result
// ─────────────────────────────────────────────────────────────────────────
describe('dropMismatchedFrozenClaims — resolver returning undefined', () => {
  test('undefined (not just null) is treated as no-live-decoration; the claim is kept', () => {
    // The guard is `liveType == null` (loose equality), which catches undefined too — a
    // resolver that forgets to return an explicit null for a not-found position still
    // behaves safely.
    const job = { deco_type: 'screen_print', items: [{ item_idx: 0, deco_idx: 0, deco_idxs: [0], units: 10 }] };
    const resolveUndefined = () => undefined;
    const { job: out, changed } = dropMismatchedFrozenClaims(job, resolveUndefined);
    expect(changed).toBe(false);
    expect(out).toBe(job);
    expect(out.items).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 7. artGrid.hydrateStoreArt — unscoped name match
// ─────────────────────────────────────────────────────────────────────────
describe('hydrateStoreArt — libraryArt must be pre-scoped by the caller (audit-flagged gap)', () => {
  test('a same-normalized-name record in libraryArt is accepted regardless of team/customer', () => {
    // hydrateStoreArt takes no team/customer/source id — it matches purely on id, then
    // name+deco_type, then size-normalized name+deco_type. Nothing here stops a same-named
    // design from an UNRELATED customer's library from overlaying this store's art record.
    // Callers (Webstores Art tab) MUST pre-scope the libraryArt array to the right
    // team/customer before calling this — this test pins that the function itself performs
    // no such scoping.
    const storeArt = [{ id: 'store1', name: 'Wildcats Logo', deco_type: 'screen_print', color_ways: [] }];
    const unrelatedCustomerArt = {
      id: 'lib-other-customer',
      name: 'Wildcats Logo',
      deco_type: 'screen_print',
      _srcCustId: 'totally-unrelated-customer',
      web_logos: [{ url: 'other-customers-logo.png', color_way: '', is_default: true }],
      color_ways: [{ id: 'cw1', garment_color: 'Navy' }],
    };
    const [out] = hydrateStoreArt(storeArt, [unrelatedCustomerArt]);
    expect(out.web_logos).toEqual(unrelatedCustomerArt.web_logos);
    expect(out.color_ways).toEqual(unrelatedCustomerArt.color_ways);
  });
});
