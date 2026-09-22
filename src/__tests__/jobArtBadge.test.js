import { jobArtBadgeSt } from '../lib/jobArtBadge';

describe('job artwork badge', () => {
  test.each(['waiting_for_art', 'uploaded', 'approved'])('unsubmitted job stays Needs Art despite shared file status %s', status => {
    expect(jobArtBadgeSt({ art_status: 'needs_art' }, { status })).toBe('needs_art');
  });
  test.each(['art_requested', 'art_in_progress'])('submitted job %s waits for art', art_status => {
    expect(jobArtBadgeSt({ art_status }, { status: 'waiting_for_art' })).toBe('waiting_for_art');
  });
  test('coach rejection remains visible while artist works', () => {
    expect(jobArtBadgeSt({ art_status: 'art_requested', coach_rejected: true }, {})).toBe('changes_requested');
  });
  test('recalled legacy job does not imply an active submission', () => {
    expect(jobArtBadgeSt({ art_requests: [{ status: 'recalled' }] }, { status: 'approved' })).toBe('needs_art');
  });
  test.each([['waiting_approval','needs_approval'], ['production_files_needed','approved'], ['art_complete','art_complete']])('job stage %s wins over stale file', (art_status, expected) => {
    expect(jobArtBadgeSt({ art_status }, { status: 'waiting_for_art' })).toBe(expected);
  });
});
