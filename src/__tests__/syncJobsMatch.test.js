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
  matchExistingJob,
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
