// Regression tests for mergeJobsArtState — the fix for "I merged two jobs that had art and it
// went back to Needs Art." Art and approvals must SURVIVE the merge: the merged job carries the
// union of every design and the LEAST-ADVANCED art_status across the sources (never over-reports
// as approved), plus the unioned workflow logs. Coach approval survives only when unanimous.
import { mergeJobsArtState } from '../lib/syncJobsMatch';

const job = (over) => ({
  art_status: 'needs_art', art_file_id: null, _art_ids: [], art_requests: [], art_messages: [],
  sent_history: [], rejections: null, assigned_artist: null, coach_approved_at: null, coach_rejected: false,
  ...over,
});

describe('mergeJobsArtState — art survives merge', () => {
  test('two approved jobs on the SAME design stay approved (the reported bug)', () => {
    const a = job({ art_status: 'art_complete', art_file_id: 'artX', _art_ids: ['artX'] });
    const b = job({ art_status: 'art_complete', art_file_id: 'artX', _art_ids: ['artX'] });
    const m = mergeJobsArtState([a, b]);
    expect(m.art_status).toBe('art_complete');       // NOT reset to needs_art
    expect(m._art_ids).toEqual(['artX']);
    expect(m.art_file_id).toBe('artX');
  });

  test('unions the designs when the merged jobs carry DIFFERENT art', () => {
    const a = job({ art_status: 'art_complete', art_file_id: 'artX', _art_ids: ['artX'] });
    const b = job({ art_status: 'art_complete', art_file_id: 'artY', _art_ids: ['artY'] });
    const m = mergeJobsArtState([a, b]);
    expect(m._art_ids).toEqual(['artX', 'artY']);      // no design dropped
    expect(m.art_file_id).toBe('artX');                // target's design leads
  });

  test('dedupes shared designs across a multi-design union', () => {
    const a = job({ _art_ids: ['artX', 'artY'], art_status: 'waiting_approval' });
    const b = job({ _art_ids: ['artY', 'artZ'], art_status: 'waiting_approval' });
    const m = mergeJobsArtState([a, b]);
    expect(m._art_ids).toEqual(['artX', 'artY', 'artZ']);
  });

  test('drops the __tbd placeholder from the union', () => {
    const a = job({ art_status: 'art_complete', art_file_id: 'artX', _art_ids: ['artX'] });
    const b = job({ art_status: 'needs_art', art_file_id: '__tbd', _art_ids: ['__tbd'] });
    const m = mergeJobsArtState([a, b]);
    expect(m._art_ids).toEqual(['artX']);
  });
});

describe('mergeJobsArtState — least-advanced status wins (safety: never over-reports approval)', () => {
  test('approved + needs-art merges DOWN to needs_art, not up', () => {
    const approved = job({ art_status: 'art_complete', _art_ids: ['artX'] });
    const needsArt = job({ art_status: 'needs_art', _art_ids: ['artY'] });
    expect(mergeJobsArtState([approved, needsArt]).art_status).toBe('needs_art');
    // order independent — target being the approved one doesn't leak approval onto the merge
    expect(mergeJobsArtState([needsArt, approved]).art_status).toBe('needs_art');
  });

  test('waiting_approval outranks needs_art but loses to approved', () => {
    const waiting = job({ art_status: 'waiting_approval', _art_ids: ['artX'] });
    const complete = job({ art_status: 'art_complete', _art_ids: ['artY'] });
    expect(mergeJobsArtState([complete, waiting]).art_status).toBe('waiting_approval');
  });

  test('copies an ACTUAL production-files variant (emb) rather than synthesizing one', () => {
    const emb = job({ art_status: 'upload_emb_files', _art_ids: ['artX'] });
    const complete = job({ art_status: 'art_complete', _art_ids: ['artY'] });
    expect(mergeJobsArtState([emb, complete]).art_status).toBe('upload_emb_files');
  });

  test('an unknown/missing status is treated as least-advanced', () => {
    const unknown = job({ art_status: undefined, _art_ids: ['artX'] });
    const complete = job({ art_status: 'art_complete', _art_ids: ['artY'] });
    expect(mergeJobsArtState([complete, unknown]).art_status).toBe('needs_art');
  });
});

describe('mergeJobsArtState — approvals & workflow logs survive', () => {
  test('coach approval survives only when EVERY design was coach-approved', () => {
    const a = job({ art_status: 'art_complete', _art_ids: ['artX'], coach_approved_at: '2026-07-10' });
    const b = job({ art_status: 'art_complete', _art_ids: ['artY'], coach_approved_at: '2026-07-11' });
    expect(mergeJobsArtState([a, b]).coachApproved).toBe(true);
  });

  test('coach approval does NOT survive a partial merge', () => {
    const approved = job({ _art_ids: ['artX'], coach_approved_at: '2026-07-10' });
    const notSent = job({ _art_ids: ['artY'], coach_approved_at: null });
    expect(mergeJobsArtState([approved, notSent]).coachApproved).toBe(false);
  });

  test('a coach rejection anywhere blocks the merged approval', () => {
    const approved = job({ _art_ids: ['artX'], coach_approved_at: '2026-07-10' });
    const rejected = job({ _art_ids: ['artY'], coach_approved_at: '2026-07-10', coach_rejected: true });
    expect(mergeJobsArtState([approved, rejected]).coachApproved).toBe(false);
  });

  test('unions and dedupes art_requests / rejections; keeps the artist assignment', () => {
    const a = job({
      _art_ids: ['artX'], assigned_artist: null,
      art_requests: [{ id: 'r1', status: 'completed' }],
      rejections: [{ id: 'x1', reason: 'wrong color' }],
    });
    const b = job({
      _art_ids: ['artY'], assigned_artist: 'artist-7',
      art_requests: [{ id: 'r1', status: 'completed' }, { id: 'r2', status: 'requested' }],
      rejections: [{ id: 'x2', reason: 'logo too small' }],
    });
    const m = mergeJobsArtState([a, b]);
    expect(m.art_requests.map((r) => r.id)).toEqual(['r1', 'r2']);        // deduped by id
    expect(m.rejections.map((r) => r.id)).toEqual(['x1', 'x2']);          // reasons preserved
    expect(m.assigned_artist).toBe('artist-7');                          // target empty → first non-empty
  });

  test('rejections collapse to null when no source had any', () => {
    const a = job({ _art_ids: ['artX'] });
    const b = job({ _art_ids: ['artY'] });
    expect(mergeJobsArtState([a, b]).rejections).toBeNull();
  });
});
