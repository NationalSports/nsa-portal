/* eslint-disable */
/**
 * Coach art review — the queue's "still being designed" group and the per-garment
 * feedback note.
 *
 * Why these two: coaches were reading a half-delivered order as the whole order,
 * because art is sent to them ONE JOB AT A TIME (the rep's Send to Coach stamps
 * sent_to_coach_at on a single job) and the portal only ever listed the jobs that
 * had already arrived. cpUpcomingArtJobs is what puts the not-yet-drawn designs on
 * screen; cpComposeArtFeedback is what lets a coach say "this garment yes, that one
 * no" without writing prose.
 *
 * html2pdf ships a dist bundle jest can't transform and rides in via
 * components.js/utils.js; stub it so the module mounts.
 */
jest.mock('html2pdf.js', () => ({ __esModule: true, default: () => ({ from: () => ({ save: () => {} }) }) }));

const { cpUpcomingArtJobs, cpUpcomingArtLabel, cpComposeArtFeedback } = require('../CoachPortal');

const job = (over) => ({ id: 'J1', art_file_id: 'A1', art_status: 'art_requested', ...over });

describe('cpUpcomingArtJobs — designs the coach is still waiting on', () => {
  test('includes art that has not been drawn yet', () => {
    const out = cpUpcomingArtJobs([
      job({ id: 'a', art_status: 'needs_art' }),
      job({ id: 'b', art_status: 'art_requested' }),
      job({ id: 'c', art_status: 'art_in_progress' }),
    ]);
    expect(out.map((j) => j.id)).toEqual(['a', 'b', 'c']);
  });

  test('a mockup the rep has NOT forwarded still counts as in progress', () => {
    // waiting_approval without sent_to_coach_at is internal rep review — the coach
    // must not be able to act on it (audit A1), but they should know it exists.
    const out = cpUpcomingArtJobs([job({ id: 'a', art_status: 'waiting_approval' })]);
    expect(out.map((j) => j.id)).toEqual(['a']);
  });

  test('excludes art already sent for approval — that is the actionable list', () => {
    const out = cpUpcomingArtJobs([
      job({ id: 'a', art_status: 'waiting_approval', sent_to_coach_at: '2026-08-01T00:00:00Z' }),
    ]);
    expect(out).toEqual([]);
  });

  test('excludes finished art', () => {
    const out = cpUpcomingArtJobs([
      job({ id: 'a', art_status: 'art_complete' }),
      job({ id: 'b', art_status: 'production_files_needed' }),
    ]);
    expect(out).toEqual([]);
  });

  test('a names/numbers-only job never gets a mockup, so it is not promised one', () => {
    // No art_file_id and no _art_ids: nothing will ever be drawn for this job, and
    // telling the coach a mockup is coming would be a lie.
    const out = cpUpcomingArtJobs([{ id: 'a', art_status: 'needs_art', art_file_id: null }]);
    expect(out).toEqual([]);
  });

  test('a __tbd placeholder DOES mean art is coming', () => {
    const out = cpUpcomingArtJobs([job({ id: 'a', art_file_id: '__tbd', art_status: 'needs_art' })]);
    expect(out.map((j) => j.id)).toEqual(['a']);
  });

  test('multi-design jobs are recognised via _art_ids', () => {
    const out = cpUpcomingArtJobs([
      { id: 'a', art_status: 'art_in_progress', art_file_id: null, _art_ids: ['A1', 'A2'] },
    ]);
    expect(out.map((j) => j.id)).toEqual(['a']);
  });

  test('survives junk input', () => {
    expect(cpUpcomingArtJobs(null)).toEqual([]);
    expect(cpUpcomingArtJobs([null, undefined])).toEqual([]);
  });
});

describe('cpUpcomingArtLabel', () => {
  test('art pulled back by the coach reads as their own change request', () => {
    expect(cpUpcomingArtLabel(job({ art_status: 'art_requested', coach_rejected: true })))
      .toBe('Your changes are being made');
  });
  test('anything else is simply in progress', () => {
    expect(cpUpcomingArtLabel(job({ art_status: 'art_requested' }))).toBe('Mockup in progress');
    expect(cpUpcomingArtLabel(job({ art_status: 'art_in_progress' }))).toBe('Mockup in progress');
  });
});

describe('cpComposeArtFeedback — the mixed per-garment decision', () => {
  test('names the approved garments as well as the flagged one', () => {
    // "Everything but the hoodie" is the message. Leaving the approved half implicit
    // is exactly what forced coaches to write paragraphs.
    const out = cpComposeArtFeedback({
      general: '',
      approved: [{ label: 'Tee — Navy' }, { label: 'Long Sleeve — White' }],
      flagged: [{ label: 'Hoodie — Black', note: 'logo sits too high' }],
    });
    expect(out).toBe(
      '✅ Approved: Tee — Navy, Long Sleeve — White\n'
      + '✏️ Changes needed:\n'
      + '• Hoodie — Black: logo sits too high'
    );
  });

  test("the coach's own note leads — it is the one part they wrote as a whole thought", () => {
    const out = cpComposeArtFeedback({
      general: '  Close! Just one fix.  ',
      approved: [{ label: 'Tee — Navy' }],
      flagged: [{ label: 'Hoodie — Black', note: 'bigger mascot' }],
    });
    expect(out.split('\n')[0]).toBe('Close! Just one fix.');
  });

  test('a flagged garment with no note still names the garment', () => {
    // The note is only required somewhere, not on every card — a coach who explains
    // three flags in the general box must not be blocked or lose the garment names.
    const out = cpComposeArtFeedback({
      general: 'Move both logos down.',
      approved: [],
      flagged: [{ label: 'Tee — Navy', note: '' }, { label: 'Hoodie — Black', note: '   ' }],
    });
    expect(out).toBe('Move both logos down.\n✏️ Changes needed:\n• Tee — Navy\n• Hoodie — Black');
  });

  test('every garment flagged omits the approved line entirely', () => {
    const out = cpComposeArtFeedback({
      general: '',
      approved: [],
      flagged: [{ label: 'Tee — Navy', note: 'wrong color' }],
    });
    expect(out).toBe('✏️ Changes needed:\n• Tee — Navy: wrong color');
  });

  test('nothing flagged produces no changes section', () => {
    // This shape never reaches the reject path (approve handles it), but the helper
    // must not emit a dangling "Changes needed:" header if it ever does.
    const out = cpComposeArtFeedback({ general: 'Looks great', approved: [{ label: 'Tee' }], flagged: [] });
    expect(out).toBe('Looks great\n✅ Approved: Tee');
  });

  test('survives junk input', () => {
    expect(cpComposeArtFeedback()).toBe('');
    expect(cpComposeArtFeedback({ general: null, approved: null, flagged: null })).toBe('');
    expect(cpComposeArtFeedback({ approved: [null], flagged: [null] })).toBe('');
  });
});
