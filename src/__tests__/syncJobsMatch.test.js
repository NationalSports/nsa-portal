/**
 * Regression: syncJobs must not copy rejections/coach_rejected across sibling
 * jobs that share a logo (art_file_id). Prompted by SO-1159 (hoodie card showed
 * a pants coach comment); the shared-art bleed is the class under test.
 */
import {
  buildExistingJobLookups,
  countJobsByArtId,
  dropMismatchedFrozenClaims,
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
});
