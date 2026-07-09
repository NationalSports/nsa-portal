/**
 * Regression: syncJobs must not copy rejections/coach_rejected across sibling
 * jobs that share a logo (art_file_id). Prompted by SO-1159 (hoodie card showed
 * a pants coach comment); the shared-art bleed is the class under test.
 */
import {
  buildExistingJobLookups,
  countJobsByArtId,
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
