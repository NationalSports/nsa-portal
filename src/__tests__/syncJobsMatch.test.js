/**
 * Regression: syncJobs must not copy rejections/coach_rejected across sibling
 * jobs that share a logo (art_file_id). Prompted by SO-1159 (hoodie card showed
 * a pants coach comment); the shared-art bleed is the class under test.
 */
import {
  buildExistingJobLookups,
  countJobsByArtId,
  dropMismatchedFrozenClaims,
  healFrozenJobArtDrift,
  inheritJobWorkflowFields,
  isClosedJob,
  isPureArtExpansion,
  jobDecoClaimKeys,
  matchExistingJob,
  reparentOrphanSplitJobs,
  splitClosedJobAdditions,
  splitSliceOwnedKeys,
  splitFamilyMembers,
  pruneStaleSliceRows,
} from '../lib/syncJobsMatch';

const pantsRejection = {
  reason: 'Remove logo.... pants will be blank',
  by: 'Coach',
  at: '2026-06-10T12:00:00.000Z',
  rejected_at: '2026-06-10T12:00:00.000Z',
};

describe('countJobsByArtId', () => {
  test('counts shared art across sibling jobs', () => {
    const jobs = [
      { id: 'JOB-1159-08', key: 'screen_print::Left Leg', art_file_id: 'af-logo', coach_rejected: true },
      { id: 'JOB-1159-09', key: 'screen_print::Front Center', art_file_id: 'af-logo', art_status: 'art_complete' },
      { id: 'JOB-1159-10', key: 'embroidery::Left Chest', art_file_id: 'af-other' },
    ];
    expect(countJobsByArtId(jobs)).toEqual({ 'af-logo': 2, 'af-other': 1 });
  });

  test('ignores split-off slices', () => {
    const jobs = [
      { id: 'JOB-1', key: 'a', art_file_id: 'af1' },
      { id: 'JOB-1B', key: 'a__split__B', art_file_id: 'af1', split_from: 'JOB-1' },
    ];
    expect(countJobsByArtId(jobs)).toEqual({ af1: 1 });
  });
});

describe('buildExistingJobLookups / matchExistingJob', () => {
  const pants = {
    id: 'JOB-1159-08',
    key: 'screen_print::Left Leg',
    art_file_id: 'af-logo',
    _art_ids: ['af-logo'],
    art_status: 'art_requested',
    coach_rejected: true,
    rejections: [pantsRejection],
  };
  const hoodie = {
    id: 'JOB-1159-09',
    key: 'screen_print::Front Center',
    art_file_id: 'af-logo',
    _art_ids: ['af-logo'],
    art_status: 'art_complete',
    coach_rejected: false,
    rejections: null,
    coach_approved_at: '2026-06-01T00:00:00.000Z',
  };

  test('key match still wins when art is shared', () => {
    const lookups = buildExistingJobLookups([pants, hoodie]);
    const claimed = new Set();
    const { existing, matchedBy } = matchExistingJob(
      { key: 'screen_print::Front Center', art_file_id: 'af-logo' },
      lookups,
      claimed,
    );
    expect(matchedBy).toBe('key');
    expect(existing.id).toBe('JOB-1159-09');
    expect(existing.coach_rejected).toBe(false);
    expect(existing.rejections).toBeNull();
  });

  test('shared art_file_id must NOT fall back when two jobs own the logo', () => {
    // Simulate a key change on the hoodie rebuild so key lookup misses — the old
    // bug then grabbed pants via existingByArtId['af-logo'] = first registered job.
    const lookups = buildExistingJobLookups([pants, hoodie]);
    expect(lookups.existingByArtId['af-logo']).toBeUndefined();

    const claimed = new Set();
    const { existing, matchedBy } = matchExistingJob(
      { key: 'screen_print::Chest|changed', art_file_id: 'af-logo' },
      lookups,
      claimed,
    );
    expect(matchedBy).toBeNull();
    expect(existing).toBeNull();

    const inherited = inheritJobWorkflowFields(existing);
    expect(inherited.coach_rejected).toBeNull();
    expect(inherited.rejections).toBeNull();
  });

  test('unique art_file_id fallback still preserves workflow on key rename', () => {
    const solo = {
      id: 'JOB-2000-01',
      key: 'screen_print::Old Position',
      art_file_id: 'af-solo',
      art_status: 'waiting_approval',
      coach_rejected: false,
      rejections: null,
      assigned_artist: 'artist-1',
      sent_to_coach_at: '2026-07-01T00:00:00.000Z',
      sent_history: [{ sent_at: '2026-07-01T00:00:00.000Z', sent_by: 'Rep', methods: ['email'] }],
    };
    const lookups = buildExistingJobLookups([solo]);
    expect(lookups.existingByArtId['af-solo']).toBe(solo);

    const claimed = new Set();
    const { existing, matchedBy } = matchExistingJob(
      { key: 'screen_print::New Position', art_file_id: 'af-solo' },
      lookups,
      claimed,
    );
    expect(matchedBy).toBe('art_file_id');
    expect(existing.id).toBe('JOB-2000-01');
    expect(inheritJobWorkflowFields(existing).assigned_artist).toBe('artist-1');
    expect(inheritJobWorkflowFields(existing).sent_to_coach_at).toBe('2026-07-01T00:00:00.000Z');
    expect(inheritJobWorkflowFields(existing).sent_history).toEqual(solo.sent_history);
  });

  test('SO-2106: assigning art after a split keeps the original parent via decoration claims', () => {
    const parent = {
      id: 'JOB-2106-01',
      key: 'screen_print::art_unassigned@Front Center',
      art_file_id: null,
      items: [{ item_idx: 1, sku: 'IW2442', deco_idx: 0, deco_idxs: [0] }],
    };
    const child = {
      id: 'JOB-2106-01-B',
      key: 'screen_print::art_unassigned@Front Center__split__B',
      art_file_id: null,
      split_from: 'JOB-2106-01',
      items: [{ item_idx: 0, sku: 'IM9857', deco_idx: 0, deco_idxs: [0] }],
    };
    const built = {
      key: 'screen_print::art_af-clark@Front Center',
      art_file_id: 'af-clark',
      items: [
        { item_idx: 0, sku: 'IM9857', deco_idx: 0, deco_idxs: [0] },
        { item_idx: 1, sku: 'IW2442', deco_idx: 0, deco_idxs: [0] },
      ],
    };
    const { existing, matchedBy } = matchExistingJob(
      built,
      buildExistingJobLookups([parent, child]),
      new Set(),
    );
    expect(matchedBy).toBe('deco_claim');
    expect(existing).toBe(parent);
    expect(jobDecoClaimKeys(built)).toEqual(['0::0', '1::0']);
  });

  test('decoration-claim fallback refuses a build spanning multiple old root jobs', () => {
    const first = { id: 'J1', key: 'old-1', items: [{ item_idx: 0, deco_idx: 0 }] };
    const second = { id: 'J2', key: 'old-2', items: [{ item_idx: 1, deco_idx: 0 }] };
    const built = { key: 'consolidated', items: [{ item_idx: 0, deco_idx: 0 }, { item_idx: 1, deco_idx: 0 }] };
    const { existing, matchedBy } = matchExistingJob(
      built,
      buildExistingJobLookups([first, second]),
      new Set(),
    );
    expect(matchedBy).toBeNull();
    expect(existing).toBeNull();
  });

  test('decoration-claim fallback refuses a partly ambiguous claim set', () => {
    const first = {
      id: 'J1', key: 'old-1',
      items: [{ item_idx: 0, deco_idx: 0 }, { item_idx: 1, deco_idx: 0 }],
    };
    const duplicate = { id: 'J2', key: 'old-2', items: [{ item_idx: 1, deco_idx: 0 }] };
    const built = {
      key: 'rebuilt',
      items: [{ item_idx: 0, deco_idx: 0 }, { item_idx: 1, deco_idx: 0 }],
    };
    const lookups = buildExistingJobLookups([first, duplicate]);
    expect(lookups.existingByDecoClaim['0::0']).toBe(first);
    expect(lookups.ambiguousDecoClaims.has('1::0')).toBe(true);
    const { existing, matchedBy } = matchExistingJob(built, lookups, new Set());
    expect(matchedBy).toBeNull();
    expect(existing).toBeNull();
  });

  test('art-id fallback refuses an already-claimed job in the same pass', () => {
    const a = { id: 'JOB-A', key: 'k-a', art_file_id: 'af-unique' };
    const lookups = buildExistingJobLookups([a]);
    const claimed = new Set(['JOB-A']);
    const { existing, matchedBy } = matchExistingJob(
      { key: 'k-renamed', art_file_id: 'af-unique' },
      lookups,
      claimed,
    );
    expect(matchedBy).toBeNull();
    expect(existing).toBeNull();
  });

  test('SO-1664: a preserved frozen job is never matchable — by art id or key', () => {
    // Released+merged job carrying the whole order's approval history; it is preserved
    // verbatim by syncJobs. A qty edit added a new line sharing its Louisville logo, and
    // the one-line rebuild used to steal this job via the unique-art-id fallback — the
    // dedupe-by-id then dropped the preserved snapshot (claims + coach send + approvals).
    const frozen = {
      id: 'JOB-1664-01',
      key: 'released_screen_print_JOB-1664-01',
      _merged: true,
      art_file_id: 'af-kansas',
      _art_ids: ['af-kansas', 'af-louisville', 'af-football'],
      art_status: 'art_complete',
      sent_to_coach_at: '2026-07-29T15:56:35.047Z',
    };
    const lookups = buildExistingJobLookups([frozen], new Set(['JOB-1664-01']));
    expect(lookups.existingByArtId['af-louisville']).toBeUndefined();
    expect(lookups.existingJobMap['released_screen_print_JOB-1664-01']).toBeUndefined();

    const { existing, matchedBy } = matchExistingJob(
      { key: 'screen_print::art_af-louisville', art_file_id: 'af-louisville' },
      lookups,
      new Set(),
    );
    expect(matchedBy).toBeNull();
    expect(existing).toBeNull();
  });

  test('a released job that RETIRED this pass (not preserved) still hands over workflow state', () => {
    const retired = {
      id: 'JOB-3000-01',
      key: 'screen_print::Old',
      art_file_id: 'af-x',
      sent_to_coach_at: '2026-07-01T00:00:00.000Z',
    };
    // Not in preservedIds — its claims died, so the rebuilt successor may inherit.
    const lookups = buildExistingJobLookups([retired], new Set());
    const { existing, matchedBy } = matchExistingJob(
      { key: 'screen_print::New', art_file_id: 'af-x' },
      lookups,
      new Set(),
    );
    expect(matchedBy).toBe('art_file_id');
    expect(existing.id).toBe('JOB-3000-01');
  });

  test('pants rejection stays on pants when both keys match', () => {
    const lookups = buildExistingJobLookups([pants, hoodie]);
    const claimed = new Set();
    const pantsMatch = matchExistingJob(
      { key: 'screen_print::Left Leg', art_file_id: 'af-logo' },
      lookups,
      claimed,
    );
    const hoodieMatch = matchExistingJob(
      { key: 'screen_print::Front Center', art_file_id: 'af-logo' },
      lookups,
      claimed,
    );
    expect(pantsMatch.existing.rejections[0].reason).toMatch(/pants will be blank/i);
    expect(hoodieMatch.existing.rejections).toBeNull();
    expect(hoodieMatch.existing.art_status).toBe('art_complete');
  });
});

describe('reparentOrphanSplitJobs (SO-2106 merge-back repair)', () => {
  test('re-points an orphaned split child to the one root that covers its decoration claim', () => {
    const root = {
      id: 'JOB-2106-02',
      items: [
        { item_idx: 0, sku: 'IM9857', deco_idx: 0 },
        { item_idx: 1, sku: 'IW2442', deco_idx: 0 },
      ],
    };
    const child = {
      id: 'JOB-2106-01-B',
      split_from: 'JOB-2106-01',
      items: [{ item_idx: 0, sku: 'IM9857', deco_idx: 0 }],
    };
    const repaired = reparentOrphanSplitJobs([root, child]);
    expect(repaired.find((j) => j.id === child.id).split_from).toBe(root.id);
  });

  test('leaves a valid parent link unchanged', () => {
    const parent = { id: 'P', items: [{ item_idx: 0, deco_idx: 0 }] };
    const child = { id: 'P-B', split_from: 'P', items: [{ item_idx: 0, deco_idx: 0 }] };
    const repaired = reparentOrphanSplitJobs([parent, child]);
    expect(repaired[1]).toBe(child);
  });

  test('does not guess when two roots cover the orphan claim', () => {
    const roots = [
      { id: 'A', items: [{ item_idx: 0, deco_idx: 0 }] },
      { id: 'B', items: [{ item_idx: 0, deco_idx: 0 }] },
    ];
    const child = { id: 'OLD-B', split_from: 'OLD', items: [{ item_idx: 0, deco_idx: 0 }] };
    const repaired = reparentOrphanSplitJobs([...roots, child]);
    expect(repaired[2]).toBe(child);
    expect(repaired[2].split_from).toBe('OLD');
  });
});

/**
 * Regression: SO-1468. A line delete through a stale client (no frozen-snapshot remap)
 * drifts released/merged jobs' positional (item_idx, deco_idx) claims onto the wrong
 * lines. The released screen-print job ended up claiming the polo's embroidery
 * decorations, so syncJobs skipped them and deleted the real embroidery job.
 * dropMismatchedFrozenClaims releases claims whose live decoration is a different
 * method, while keeping claims with no live decoration behind them (deleted-line
 * snapshot preservation).
 */
describe('dropMismatchedFrozenClaims', () => {
  // live layout after the unremapped delete: 0/1 screen garments, 2 screen pregame,
  // 3 the embroidered polo; type resolution mirrors syncJobs' classification
  const liveTypes = {
    '0:0': 'screen_print', '0:1': 'screen_print',
    '1:0': 'screen_print', '1:1': 'screen_print',
    '2:0': 'screen_print', '2:1': 'screen_print',
    '3:0': 'embroidery', '3:1': 'embroidery',
  };
  const resolve = (ii, di) => liveTypes[ii + ':' + di] ?? null;

  const so1468Job = {
    id: 'JOB-1468-03', deco_type: 'screen_print', _merged: true,
    items: [
      { sku: 'IN1181', item_idx: 0, deco_idx: 0, deco_idxs: [0, 1], units: 31 },
      { sku: 'KF0972', item_idx: 1, deco_idx: 0, deco_idxs: [0, 1], units: 31 },
      // drifted rows: 3 now points at the embroidered polo, 4 at nothing
      { sku: 'JX4499', item_idx: 3, deco_idx: 0, deco_idxs: [0, 1], units: 31 },
      { sku: 'A592-50', item_idx: 4, deco_idx: 0, deco_idxs: [0, 1], units: 31 },
      { sku: 'JW4303', item_idx: 2, deco_idx: 0, deco_idxs: [0], units: 31 },
    ],
  };

  test('releases claims on decorations of another method (the SO-1468 row)', () => {
    const { job, changed } = dropMismatchedFrozenClaims(so1468Job, resolve);
    expect(changed).toBe(true);
    // the row squatting on the polo's embroidery decos is fully released
    expect(job.items.find((gi) => gi.item_idx === 3)).toBeUndefined();
    // matching-method rows survive untouched
    expect(job.items.find((gi) => gi.item_idx === 0).deco_idxs).toEqual([0, 1]);
    expect(job.items.find((gi) => gi.item_idx === 2).deco_idxs).toEqual([0]);
  });

  test('keeps rows with no live decoration behind them (deleted-line snapshots)', () => {
    const { job } = dropMismatchedFrozenClaims(so1468Job, resolve);
    expect(job.items.find((gi) => gi.item_idx === 4)).toBeDefined();
  });

  test('drops only the mismatched deco index when a row mixes methods', () => {
    const mixed = {
      deco_type: 'screen_print',
      items: [{ item_idx: 2, deco_idx: 0, deco_idxs: [0, 1], units: 31 }],
    };
    const resolveMixed = (ii, di) => (di === 1 ? 'embroidery' : 'screen_print');
    const { job, changed } = dropMismatchedFrozenClaims(mixed, resolveMixed);
    expect(changed).toBe(true);
    expect(job.items[0].deco_idxs).toEqual([0]);
    expect(job.items[0].deco_idx).toBe(0);
  });

  test('returns the original reference when nothing mismatches', () => {
    const clean = {
      deco_type: 'embroidery',
      items: [{ item_idx: 3, deco_idx: 0, deco_idxs: [0, 1], units: 31 }],
    };
    const { job, changed } = dropMismatchedFrozenClaims(clean, resolve);
    expect(changed).toBe(false);
    expect(job).toBe(clean);
  });

  test('legacy single deco_idx rows (no deco_idxs array) are validated too', () => {
    const legacy = {
      deco_type: 'screen_print',
      items: [{ item_idx: 3, deco_idx: 0, units: 31 }],
    };
    const { job, changed } = dropMismatchedFrozenClaims(legacy, resolve);
    expect(changed).toBe(true);
    expect(job.items).toHaveLength(0);
  });

  test('a job without deco_type is left alone', () => {
    const untyped = { items: [{ item_idx: 3, deco_idx: 0, deco_idxs: [0] }] };
    const { job, changed } = dropMismatchedFrozenClaims(untyped, resolve);
    expect(changed).toBe(false);
    expect(job).toBe(untyped);
  });

  // Hydration safety: single-method jobs now run this heal unconditionally (not only when an index
  // is out of bounds), so a resolver that can't yet resolve a claim's method — art file not loaded —
  // MUST report null and the claim MUST be kept, or an embroidery claim would be dropped mid-load.
  test('a claim whose method is unresolved (null) is always kept, never dropped', () => {
    const job = {
      deco_type: 'screen_print',
      items: [
        { item_idx: 0, deco_idx: 0, deco_idxs: [0], units: 31 }, // resolves screen — kept
        { item_idx: 3, deco_idx: 0, deco_idxs: [0], units: 31 }, // resolves null (unloaded) — kept
      ],
    };
    const resolveUnloaded = (ii) => (ii === 0 ? 'screen_print' : null);
    const { job: out, changed } = dropMismatchedFrozenClaims(job, resolveUnloaded);
    expect(changed).toBe(false);
    expect(out.items).toHaveLength(2);
  });

  // SO-1023: a merged embroidery job's frozen claims drifted onto screen-print decos, and the
  // old blanket merged-job exemption let the art heal ADOPT the foreign screen designs into the
  // job. Merged jobs now pass the deco types of their DECLARED designs as expectedTypes.
  describe('expectedTypes (merged jobs judged against their declared designs)', () => {
    const so1023Job = {
      id: 'JOB-1023-02', deco_type: 'embroidery', _merged: true,
      items: [
        { sku: 'KD5434', item_idx: 3, deco_idx: 0, deco_idxs: [0], units: 22 }, // still embroidery
        { sku: 'JX4467', item_idx: 0, deco_idx: 0, deco_idxs: [0], units: 20 }, // drifted → screen
        { sku: 'JP2920', item_idx: 1, deco_idx: 0, deco_idxs: [0], units: 20 }, // drifted → screen
      ],
    };

    test('single-declared-method merged job releases claims that drifted to another method', () => {
      const { job, changed } = dropMismatchedFrozenClaims(so1023Job, resolve, ['embroidery']);
      expect(changed).toBe(true);
      expect(job.items.map((gi) => gi.sku)).toEqual(['KD5434']);
    });

    test('a legit cross-type merge keeps both declared methods’ claims', () => {
      const { job, changed } = dropMismatchedFrozenClaims(so1023Job, resolve, ['embroidery', 'screen_print']);
      expect(changed).toBe(false);
      expect(job.items).toHaveLength(3);
    });

    test('expectedTypes overrides the job’s own deco_type label', () => {
      // Merged under an "embroidery" label but declaring only a screen design: the
      // embroidery claim is the stale one.
      const { job } = dropMismatchedFrozenClaims(so1023Job, resolve, ['screen_print']);
      expect(job.items.map((gi) => gi.sku)).toEqual(['JX4467', 'JP2920']);
    });
  });
});

/**
 * Regression: SO-1348 / JOB-1348-02. A released job froze art_file_id/art_name/positions
 * ("5in Wide S Crest Football", Front Center) while the rep re-pointed the claimed line's
 * decoration at different artwork ("2.5in tall S Crest Shorts", Left Leg). The job header
 * showed the old design and the run-together suggestion matched the OLD art name against
 * the real football job on SO-1101. healFrozenJobArtDrift re-stamps the frozen art
 * identity from the live decorations.
 */
describe('healFrozenJobArtDrift', () => {
  // live layout mirroring SO-1348: item 2's deco 0 now carries the 2.5in crest on Left Leg
  const live = {
    '2:0': { artFileId: 'af_crest25', position: 'Left Leg' },
    '3:0': { artFileId: 'af_helmet6', position: 'Front Center' },
  };
  const resolve = (ii, di) => live[ii + ':' + di] ?? null;

  const so1348Job = {
    id: 'JOB-1348-02', _released: true, deco_type: 'screen_print',
    art_file_id: 'af_football5', _art_ids: ['af_football5'],
    art_name: '5in Wide S Crest Football', positions: 'Front Center',
    items: [{ sku: 'IS1111', item_idx: 2, deco_idx: 0, deco_idxs: [0], units: 68 }],
  };

  test('re-points a released job at the art its live decoration now carries (SO-1348)', () => {
    const { job, changed, artChanged } = healFrozenJobArtDrift(so1348Job, resolve);
    expect(changed).toBe(true);
    expect(artChanged).toBe(true);
    expect(job.art_file_id).toBe('af_crest25');
    expect(job._art_ids).toEqual(['af_crest25']);
    expect(job.positions).toBe('Left Leg');
    // art_name is deliberately untouched here — the released-name heal owns it
    expect(job.art_name).toBe('5in Wide S Crest Football');
  });

  test('returns the original reference when the live art matches the declared set', () => {
    const clean = { ...so1348Job, art_file_id: 'af_crest25', _art_ids: ['af_crest25'] };
    const { job, changed, artChanged } = healFrozenJobArtDrift(clean, resolve);
    expect(changed).toBe(false);
    expect(artChanged).toBe(false);
    expect(job).toBe(clean);
  });

  test('aborts on an unresolved claim (art file not hydrated yet)', () => {
    const resolveUnloaded = () => 'unresolved';
    const { job, changed } = healFrozenJobArtDrift(so1348Job, resolveUnloaded);
    expect(changed).toBe(false);
    expect(job).toBe(so1348Job);
  });

  test('an unresolved claim anywhere aborts even when another claim differs', () => {
    const twoClaims = {
      ...so1348Job,
      items: [
        { item_idx: 2, deco_idx: 0, deco_idxs: [0], units: 34 },
        { item_idx: 9, deco_idx: 0, deco_idxs: [0], units: 34 },
      ],
    };
    const resolveMixed = (ii, di) => (ii === 9 ? 'unresolved' : resolve(ii, di));
    const { job, changed } = healFrozenJobArtDrift(twoClaims, resolveMixed);
    expect(changed).toBe(false);
    expect(job).toBe(twoClaims);
  });

  test('null claims are skipped; a job with only null claims stays frozen (deleted-line snapshot)', () => {
    const deletedLine = { ...so1348Job, items: [{ item_idx: 7, deco_idx: 0, deco_idxs: [0], units: 68 }] };
    const { job, changed } = healFrozenJobArtDrift(deletedLine, resolve);
    expect(changed).toBe(false);
    expect(job).toBe(deletedLine);
  });

  test('a job declaring no real art (numbers-only, or ART TBD) is left alone', () => {
    const numbersJob = { id: 'J1', art_file_id: null, items: [{ item_idx: 2, deco_idx: 0, deco_idxs: [0] }] };
    expect(healFrozenJobArtDrift(numbersJob, resolve).changed).toBe(false);
    const tbdJob = { id: 'J2', art_file_id: '__tbd', items: [{ item_idx: 2, deco_idx: 0, deco_idxs: [0] }] };
    expect(healFrozenJobArtDrift(tbdJob, resolve).changed).toBe(false);
  });

  test('multi-art consolidated claims re-stamp ids in claim order with every position', () => {
    const consolidated = {
      ...so1348Job,
      items: [
        { item_idx: 2, deco_idx: 0, deco_idxs: [0], units: 34 },
        { item_idx: 3, deco_idx: 0, deco_idxs: [0], units: 34 },
      ],
    };
    const { job, changed } = healFrozenJobArtDrift(consolidated, resolve);
    expect(changed).toBe(true);
    expect(job._art_ids).toEqual(['af_crest25', 'af_helmet6']);
    expect(job.art_file_id).toBe('af_crest25');
    expect(job.positions).toBe('Left Leg, Front Center');
  });

  test('same set in a different claim order is NOT drift (no churn)', () => {
    const twoArt = {
      ...so1348Job,
      art_file_id: 'af_helmet6', _art_ids: ['af_helmet6', 'af_crest25'],
      items: [
        { item_idx: 2, deco_idx: 0, deco_idxs: [0], units: 34 },
        { item_idx: 3, deco_idx: 0, deco_idxs: [0], units: 34 },
      ],
    };
    const { job, changed } = healFrozenJobArtDrift(twoArt, resolve);
    expect(changed).toBe(false);
    expect(job).toBe(twoArt);
  });
});

// A multi-location job (front logo + a later-added "Back Marketing" print) must not lose its
// approval status when syncJobs heals its art-id set to include the added location. The heal's
// status recompute takes the WORST per-file state, so an added 'uploaded' location dragged a
// submitted job to needs_art and SAVED it (SO-1625 / JOB-1625-01). isPureArtExpansion is the guard.
describe('isPureArtExpansion — added location must not wipe approval status', () => {
  test('true when every declared id is kept and a new id is added (the SO-1625 shape)', () => {
    expect(isPureArtExpansion(['afFront'], ['afFront', 'afBack'])).toBe(true);
  });
  test('false when a declared design was removed (real identity change → recompute allowed)', () => {
    expect(isPureArtExpansion(['afOld'], ['afNew'])).toBe(false);
    expect(isPureArtExpansion(['afA', 'afB'], ['afA'])).toBe(false); // shrink
  });
  test('false when the set is unchanged (nothing added)', () => {
    expect(isPureArtExpansion(['afA'], ['afA'])).toBe(false);
    expect(isPureArtExpansion(['afA', 'afB'], ['afB', 'afA'])).toBe(false); // reorder only
  });
  test('false when there was no declared art to preserve', () => {
    expect(isPureArtExpansion([], ['afNew'])).toBe(false);
    expect(isPureArtExpansion(null, ['afNew'])).toBe(false);
  });
  test('true for a 2→3 expansion that keeps both originals', () => {
    expect(isPureArtExpansion(['afA', 'afB'], ['afA', 'afB', 'afC'])).toBe(true);
  });
  test('false when the "expansion" replaced one original even though the count grew', () => {
    expect(isPureArtExpansion(['afA', 'afB'], ['afA', 'afC', 'afD'])).toBe(false); // afB dropped
  });
});

/**
 * Garments added to a CLOSED job (SO-1514 / JOB-1514-02).
 *
 * The auto-builder groups every live decoration sharing a signature into one job, so 9 replacement
 * tees added after the job shipped landed on it: 26/26 Items Received became 26/35 Partially
 * Received. Added garments are a new press run — splitClosedJobAdditions is the rule syncJobs uses
 * to carve them off.
 */
describe('isClosedJob', () => {
  test('completed and shipped runs are closed', () => {
    expect(isClosedJob({ prod_status: 'completed' })).toBe(true);
    expect(isClosedJob({ prod_status: 'shipped' })).toBe(true);
  });
  test('a job still in line or on press is NOT closed — the floor can still add to that run', () => {
    ['hold', 'draft', 'staging', 'in_process'].forEach((s) => {
      expect(isClosedJob({ prod_status: s })).toBe(false);
    });
    expect(isClosedJob({})).toBe(false);
    expect(isClosedJob(null)).toBe(false);
  });
});

describe('splitClosedJobAdditions', () => {
  // JOB-1514-02: 26 Gildan 5000 shipped on line 0; line 2 is the 9-piece misprint reprint.
  const shipped = [{ item_idx: 0, sku: '5000', units: 26, fulfilled: 26 }];
  const reprint = { item_idx: 2, sku: '5000', units: 9, fulfilled: 0 };

  test('a garment the closed run never held is an addition — same sku, different line', () => {
    const { keep, added } = splitClosedJobAdditions([...shipped, reprint], shipped);
    expect(keep).toEqual(shipped);
    expect(added).toEqual([reprint]);
  });

  test('nothing added when the rebuild matches the closed run', () => {
    expect(splitClosedJobAdditions(shipped, shipped).added).toEqual([]);
  });

  test('converges: once the slice owns the row, the parent rebuild has nothing left to carve', () => {
    // Next sync — sliceOwned drops the carved row before this rule runs.
    const { keep, added } = splitClosedJobAdditions(shipped, shipped);
    expect(added).toEqual([]);
    expect(keep).toEqual(shipped);
  });

  test('a quantity bump on a garment the run already printed is NOT carved (no per-size baseline)', () => {
    const grown = [{ item_idx: 0, sku: '5000', units: 35, fulfilled: 26 }];
    const { keep, added } = splitClosedJobAdditions(grown, shipped);
    expect(added).toEqual([]);
    expect(keep).toEqual(grown);
  });

  test('rows are matched on line AND sku — a swapped garment on the same line is an addition', () => {
    const swapped = { item_idx: 0, sku: 'JX4461', units: 12, fulfilled: 0 };
    const { keep, added } = splitClosedJobAdditions([...shipped, swapped], shipped);
    expect(added).toEqual([swapped]);
    expect(keep).toEqual(shipped);
  });

  test('tolerates missing/garbage rows', () => {
    expect(splitClosedJobAdditions(null, null)).toEqual({ keep: [], added: [] });
    expect(splitClosedJobAdditions([null, reprint], undefined).added).toEqual([reprint]);
    expect(splitClosedJobAdditions(shipped, [null]).added).toEqual(shipped);
  });
});

describe('splitSliceOwnedKeys (SO-1634 grandchild double-count)', () => {
  // SO-1634's real shape: KC4512 was split off the parent to -B, then split AGAIN to -B-B.
  // The grandchild owns the garment; the parent's rebuild must not re-add it.
  const isRel = (j) => !!j._released || (j.key || '').startsWith('released_');
  const exclude = (j) => j._merged || isRel(j);
  const family = [
    { id: 'JOB-1634-01', split_from: null, items: [{ item_idx: 1, sku: 'KB9091' }] },
    { id: 'JOB-1634-01-B', split_from: 'JOB-1634-01', items: [{ item_idx: 12, sku: 'JW6595' }] },
    { id: 'JOB-1634-01-B-B', split_from: 'JOB-1634-01-B', items: [{ item_idx: 7, sku: 'KC4512' }] },
    { id: 'JOB-1634-01-C2', split_from: 'JOB-1634-01', items: [{ item_idx: 1, sku: 'KB9091' }] },
  ];

  test('a direct child owns its garments', () => {
    const owned = splitSliceOwnedKeys(family, 'JOB-1634-01', exclude);
    expect(owned.has('12-JW6595')).toBe(true);
  });

  test('a grandchild slice owns its garments too — the SO-1634 regression', () => {
    const owned = splitSliceOwnedKeys(family, 'JOB-1634-01', exclude);
    expect(owned.has('7-KC4512')).toBe(true);
  });

  test('the parent job itself contributes nothing', () => {
    const owned = splitSliceOwnedKeys(family, 'JOB-1634-01', exclude);
    expect(owned.has('1-KB9091')).toBe(true); // via C2, a slice — not via the parent
    expect(splitSliceOwnedKeys(family.slice(0, 3), 'JOB-1634-01', exclude).has('1-KB9091')).toBe(false);
  });

  test('an unrelated family is not scanned', () => {
    const jobs = [...family, { id: 'JOB-1634-02-C1', split_from: 'JOB-1634-02', items: [{ item_idx: 5, sku: 'JX4472' }] }];
    const owned = splitSliceOwnedKeys(jobs, 'JOB-1634-01', exclude);
    expect(owned.has('5-JX4472')).toBe(false);
  });

  test('merged/released slices are excluded (their claims are frozen elsewhere) but still link deeper slices', () => {
    const jobs = [
      { id: 'P', split_from: null, items: [] },
      { id: 'P-B', split_from: 'P', _merged: true, items: [{ item_idx: 3, sku: 'AAA' }] },
      { id: 'P-B-B', split_from: 'P-B', items: [{ item_idx: 4, sku: 'BBB' }] },
    ];
    const owned = splitSliceOwnedKeys(jobs, 'P', exclude);
    expect(owned.has('3-AAA')).toBe(false); // merged slice: preserved via frozenItemDecos, not here
    expect(owned.has('4-BBB')).toBe(true); // grandchild under the merged slice still owns its row
  });

  test('cycle-safe: a corrupted split_from loop terminates', () => {
    const jobs = [
      { id: 'A', split_from: 'B', items: [{ item_idx: 0, sku: 'X' }] },
      { id: 'B', split_from: 'A', items: [{ item_idx: 1, sku: 'Y' }] },
    ];
    const owned = splitSliceOwnedKeys(jobs, 'A', exclude);
    expect(owned.has('1-Y')).toBe(true);
    expect(owned.has('0-X')).toBe(false);
  });
});

describe('splitSliceOwnedKeys — orphaned slices', () => {
  // An orphaned slice (split_from pointing at a job that no longer exists) is unreachable
  // from the family root, so its garments are NOT counted as slice-owned. This is why the
  // Merge Back handler re-parents the merged slice's children instead of leaving them
  // orphaned — an orphan would get its garments re-added to the parent on the next sync.
  test('a slice whose parent link is broken is not reachable from the root', () => {
    const jobs = [
      { id: 'JOB-1634-01', split_from: null, items: [{ item_idx: 1, sku: 'KB9091' }] },
      // JOB-1634-01-B was merged back and removed; B-B was left pointing at it.
      { id: 'JOB-1634-01-B-B', split_from: 'JOB-1634-01-B', items: [{ item_idx: 7, sku: 'KC4512' }] },
    ];
    const owned = splitSliceOwnedKeys(jobs, 'JOB-1634-01', () => false);
    expect(owned.has('7-KC4512')).toBe(false);
  });

  test('after Merge Back re-parents the child, its garments are owned again', () => {
    const jobs = [
      { id: 'JOB-1634-01', split_from: null, items: [{ item_idx: 1, sku: 'KB9091' }] },
      { id: 'JOB-1634-01-B-B', split_from: 'JOB-1634-01', items: [{ item_idx: 7, sku: 'KC4512' }] },
    ];
    const owned = splitSliceOwnedKeys(jobs, 'JOB-1634-01', () => false);
    expect(owned.has('7-KC4512')).toBe(true);
  });
});

describe('pruneStaleSliceRows (SO-1110 phantom slice)', () => {
  // SO-1110's real shape. JN3647 (a 1-unit line) ended up on TWO slices: JOB-1110-02-A,
  // carved by the closed-job addition rule with a whole-line claim (no sizes), and
  // JOB-1110-02-S-S, which holds it with a real per-size allocation. They are COUSINS —
  // neither is an ancestor of the other — so the parent-side descendant walk never saw it,
  // and neither slice is ever rebuilt. The result was a permanent 1-unit phantom job.
  const so1110 = () => [
    { id: 'JOB-1110-02', split_from: null, prod_status: 'shipped', items: [{ item_idx: 0, sku: 'JM5227', units: 12, sizes: { M: 2, L: 2, XL: 4, '2XL': 3, '3XL': 1 } }] },
    { id: 'JOB-1110-02-A', split_from: 'JOB-1110-02', prod_status: 'hold', items: [{ item_idx: 2, sku: 'JN3647', units: 1 }] },
    { id: 'JOB-1110-02-S', split_from: 'JOB-1110-02', prod_status: 'shipped', items: [{ item_idx: 3, sku: 'KE8804', units: 1, sizes: { M: 1 } }] },
    { id: 'JOB-1110-02-S-S', split_from: 'JOB-1110-02-S', prod_status: 'hold', items: [{ item_idx: 2, sku: 'JN3647', units: 1, sizes: { M: 1 } }] },
  ];

  test('the phantom cousin slice is retired; the real one survives', () => {
    const jobs = so1110();
    const slices = jobs.filter((j) => j.split_from);
    const out = pruneStaleSliceRows(slices, jobs);
    expect(out.map((j) => j.id)).toEqual(['JOB-1110-02-S', 'JOB-1110-02-S-S']);
    expect(out.find((j) => j.id === 'JOB-1110-02-S-S').items).toHaveLength(1);
  });

  test('a genuine size-partitioned split is NOT pruned — both halves are sized', () => {
    const jobs = [
      { id: 'P', split_from: null, prod_status: 'hold', items: [{ item_idx: 0, sku: 'X', units: 6, sizes: { M: 6 } }] },
      { id: 'P-C1', split_from: 'P', prod_status: 'hold', items: [{ item_idx: 0, sku: 'X', units: 4, sizes: { M: 4 } }] },
    ];
    const out = pruneStaleSliceRows(jobs.filter((j) => j.split_from), jobs);
    expect(out).toHaveLength(1);
    expect(out[0].items).toHaveLength(1);
  });

  test('a by-SKU slice keeps its whole-line row when nobody else in the family holds it', () => {
    const jobs = [
      { id: 'P', split_from: null, prod_status: 'hold', items: [{ item_idx: 0, sku: 'X', units: 6 }] },
      { id: 'P-B', split_from: 'P', prod_status: 'hold', items: [{ item_idx: 1, sku: 'Y', units: 4 }] },
    ];
    const out = pruneStaleSliceRows(jobs.filter((j) => j.split_from), jobs);
    expect(out[0].items).toEqual([{ item_idx: 1, sku: 'Y', units: 4 }]);
  });

  test('a slice already in production is never touched', () => {
    const jobs = so1110().map((j) => (j.id === 'JOB-1110-02-A' ? { ...j, prod_status: 'in_process' } : j));
    const out = pruneStaleSliceRows(jobs.filter((j) => j.split_from), jobs);
    expect(out.map((j) => j.id)).toContain('JOB-1110-02-A');
  });

  test('an unrelated family never supplies the sized claim', () => {
    const jobs = [
      { id: 'P', split_from: null, prod_status: 'hold', items: [] },
      { id: 'P-B', split_from: 'P', prod_status: 'hold', items: [{ item_idx: 2, sku: 'JN3647', units: 1 }] },
      { id: 'Q', split_from: null, prod_status: 'hold', items: [] },
      { id: 'Q-B', split_from: 'Q', prod_status: 'hold', items: [{ item_idx: 2, sku: 'JN3647', units: 1, sizes: { M: 1 } }] },
    ];
    const out = pruneStaleSliceRows([jobs[1]], jobs);
    expect(out.map((j) => j.id)).toEqual(['P-B']);
  });

  test('partly-stale slice keeps its good rows and re-totals', () => {
    const jobs = [
      { id: 'P', split_from: null, prod_status: 'hold', items: [] },
      { id: 'P-A', split_from: 'P', prod_status: 'hold', total_units: 9, fulfilled_units: 0,
        items: [{ item_idx: 0, sku: 'STALE', units: 4, fulfilled: 0 }, { item_idx: 1, sku: 'GOOD', units: 5, fulfilled: 2 }] },
      { id: 'P-S', split_from: 'P', prod_status: 'hold', items: [{ item_idx: 0, sku: 'STALE', units: 4, sizes: { M: 4 } }] },
    ];
    const out = pruneStaleSliceRows([jobs[1]], jobs);
    expect(out[0].items.map((g) => g.sku)).toEqual(['GOOD']);
    expect(out[0].total_units).toBe(5);
    expect(out[0].fulfilled_units).toBe(2);
    expect(out[0].item_status).toBe('partially_received');
  });

  test('splitFamilyMembers reaches cousins through the root', () => {
    const fam = splitFamilyMembers(so1110(), 'JOB-1110-02-A');
    expect([...fam].sort()).toEqual(['JOB-1110-02', 'JOB-1110-02-A', 'JOB-1110-02-S', 'JOB-1110-02-S-S']);
  });

  test('tolerates junk and cycles', () => {
    expect(pruneStaleSliceRows(null, null)).toEqual([]);
    const cyc = [{ id: 'A', split_from: 'B', prod_status: 'hold', items: [{ item_idx: 0, sku: 'X', units: 1 }] },
                 { id: 'B', split_from: 'A', prod_status: 'hold', items: [{ item_idx: 0, sku: 'X', units: 1, sizes: { M: 1 } }] }];
    expect(() => pruneStaleSliceRows(cyc, cyc)).not.toThrow();
  });
});

describe('pruneStaleSliceRows — zeroed line (SO-1048 stock swap)', () => {
  // SO-1048: 29 KV2197 tees were swapped to KV4651 on a different line. Item 2 went to all
  // zeros with no PO and no receipts, but JOB-1048-04-S kept its frozen 29-unit claim — a
  // phantom screen-print job for a garment the order no longer carries, while the real 29
  // units ran on JOB-1048-05. Slice quantities are frozen by design, so nothing healed it.
  const so1048 = () => [
    { id: 'JOB-1048-04', split_from: null, prod_status: 'in_process', items: [{ item_idx: 25, sku: 'AT101', units: 6, fulfilled: 6, sizes: { S: 2, M: 2, L: 2 } }] },
    { id: 'JOB-1048-04-S', split_from: 'JOB-1048-04', prod_status: 'hold', total_units: 29, fulfilled_units: 0,
      items: [{ item_idx: 2, sku: 'KV2197', units: 29, fulfilled: 0, sizes: { XS: 1, S: 13, M: 12, L: 1, XL: 2 } }] },
  ];
  // item 2 zeroed, nothing received; the live replacement lives on another line entirely.
  const lines = { 2: { units: 0, received: 0 }, 25: { units: 6, received: 6 } };
  const resolve = (ix) => (Object.prototype.hasOwnProperty.call(lines, ix) ? lines[ix] : null);

  test('the phantom slice is retired once its line is zeroed', () => {
    const jobs = so1048();
    const out = pruneStaleSliceRows(jobs.filter((j) => j.split_from), jobs, resolve);
    expect(out).toEqual([]);
  });

  test('without the resolver the row is kept — the sized claim alone is not stale', () => {
    const jobs = so1048();
    const out = pruneStaleSliceRows(jobs.filter((j) => j.split_from), jobs);
    expect(out.map((j) => j.id)).toEqual(['JOB-1048-04-S']);
  });

  test('receipts hold the row — an absorbed write-off is a human call, not a sync', () => {
    const jobs = so1048();
    const held = (ix) => (ix === 2 ? { units: 0, received: 29 } : resolve(ix));
    expect(pruneStaleSliceRows(jobs.filter((j) => j.split_from), jobs, held).map((j) => j.id))
      .toEqual(['JOB-1048-04-S']);
  });

  test('a fulfilled row is never dead-lined even if the line reads zero', () => {
    const jobs = so1048().map((j) => (j.split_from ? { ...j, items: [{ ...j.items[0], fulfilled: 29 }] } : j));
    expect(pruneStaleSliceRows(jobs.filter((j) => j.split_from), jobs, resolve).map((j) => j.id))
      .toEqual(['JOB-1048-04-S']);
  });

  test('unallocated aggregate fulfillment holds the slice when row counts are stale', () => {
    const jobs = so1048().map((j) => (j.split_from ? { ...j, fulfilled_units: 1 } : j));
    expect(pruneStaleSliceRows(jobs.filter((j) => j.split_from), jobs, resolve).map((j) => j.id))
      .toEqual(['JOB-1048-04-S']);
  });

  test('a MISSING line (index drift) is left alone — never silently delete work', () => {
    const jobs = so1048();
    expect(pruneStaleSliceRows(jobs.filter((j) => j.split_from), jobs, () => null).map((j) => j.id))
      .toEqual(['JOB-1048-04-S']);
  });

  test('a slice already in production keeps its zeroed row', () => {
    const jobs = so1048().map((j) => (j.split_from ? { ...j, prod_status: 'in_process' } : j));
    expect(pruneStaleSliceRows(jobs.filter((j) => j.split_from), jobs, resolve).map((j) => j.id))
      .toEqual(['JOB-1048-04-S']);
  });

  test('a live line keeps its slice untouched', () => {
    const jobs = so1048();
    const live = (ix) => (ix === 2 ? { units: 29, received: 0 } : resolve(ix));
    const out = pruneStaleSliceRows(jobs.filter((j) => j.split_from), jobs, live);
    expect(out[0].items).toHaveLength(1);
  });

  test('mixed slice drops only the dead-lined row and re-totals', () => {
    const jobs = [
      { id: 'P', split_from: null, prod_status: 'hold', items: [] },
      { id: 'P-S', split_from: 'P', prod_status: 'hold', total_units: 9, fulfilled_units: 3,
        items: [{ item_idx: 2, sku: 'DEAD', units: 4, fulfilled: 0, sizes: { M: 4 } },
                { item_idx: 5, sku: 'LIVE', units: 5, fulfilled: 3, sizes: { M: 5 } }] },
    ];
    const r = (ix) => (ix === 2 ? { units: 0, received: 0 } : { units: 5, received: 3 });
    const out = pruneStaleSliceRows([jobs[1]], jobs, r);
    expect(out[0].items.map((g) => g.sku)).toEqual(['LIVE']);
    expect(out[0].total_units).toBe(5);
    expect(out[0].fulfilled_units).toBe(3);
  });
});
