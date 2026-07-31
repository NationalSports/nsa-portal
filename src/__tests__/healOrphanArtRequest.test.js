// Regression tests for healOrphanArtRequest — the fix for "JOB-1707-03 won't let me submit art."
//
// A production job that reads 'needs_art' while it already carries an ACTIVE artist request
// (requested / in_progress) is self-contradictory and self-perpetuating: syncJobs' rebuild inherits
// the matched job's art_requests but re-derives art_status back to needs_art, so the job stays
// stuck forever — the rep sees "Needs Art" AND "Art Requested" at once and every re-submit path
// (all gated on needs_art-with-no-request) is blocked. This ran into 14 jobs across 7 live orders.
import { healOrphanArtRequest } from '../safeHelpers';

// o carries a single live art file 'artX' so jobHasUnresolvedArt() resolves the job's declared art.
const o = { art_files: [{ id: 'artX' }], items: [{ decorations: [{ kind: 'art', art_file_id: 'artX' }] }] };

const job = (over) => ({
  art_status: 'needs_art', art_file_id: 'artX', _art_ids: ['artX'],
  items: [{ item_idx: 0, deco_idxs: [0] }], art_requests: [], ...over,
});
const req = (status) => ({ id: 'AR-1', status });

describe('healOrphanArtRequest — needs_art + live request is promoted to art_requested', () => {
  test('needs_art with an active "requested" request → art_requested (the reported bug)', () => {
    const healed = healOrphanArtRequest(job({ art_requests: [req('requested')] }), o);
    expect(healed.art_status).toBe('art_requested');
  });

  test('needs_art with an "in_progress" request → art_requested', () => {
    const healed = healOrphanArtRequest(job({ art_requests: [req('in_progress')] }), o);
    expect(healed.art_status).toBe('art_requested');
  });

  test('the request log itself is left untouched — only art_status changes', () => {
    const j = job({ art_requests: [req('requested')] });
    const healed = healOrphanArtRequest(j, o);
    expect(healed.art_requests).toEqual(j.art_requests);
  });
});

describe('healOrphanArtRequest — leaves legitimate states alone', () => {
  test('needs_art with NO active request stays needs_art', () => {
    expect(healOrphanArtRequest(job({ art_requests: [] }), o).art_status).toBe('needs_art');
  });

  test('needs_art whose only requests are recalled stays needs_art', () => {
    expect(healOrphanArtRequest(job({ art_requests: [req('recalled')] }), o).art_status).toBe('needs_art');
  });

  test('an already-advanced status (art_requested) is returned unchanged', () => {
    const j = job({ art_status: 'art_requested', art_requests: [req('requested')] });
    expect(healOrphanArtRequest(j, o)).toBe(j); // same reference — no rewrite
  });

  test('art_complete is never dragged down or up by this heal', () => {
    const j = job({ art_status: 'art_complete', art_requests: [req('requested')] });
    expect(healOrphanArtRequest(j, o)).toBe(j);
  });

  test('unresolved art (TBD placeholder) is NOT promoted — needs_art is correct there', () => {
    const tbdO = { art_files: [], items: [{ decorations: [{ kind: 'art', art_file_id: '__tbd' }] }] };
    const j = job({ art_file_id: '__tbd', _art_ids: [], art_requests: [req('requested')] });
    expect(healOrphanArtRequest(j, tbdO).art_status).toBe('needs_art');
  });
});
