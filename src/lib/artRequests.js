// Art-request status bookkeeping for a job's `art_requests[]` array.
//
// A single art job carries one `art_status` and a list of `art_requests` (each with a status:
// requested → in_progress → completed, or recalled). An "open" request — status 'requested' or
// 'in_progress' — means the ball is with the ARTIST: they have an outstanding ask to create or
// revise a mockup.
//
// Once the artist submits the mockup (art_status → waiting_approval) or the art is approved
// (art_status → art_complete / a production-file stage), that request is fulfilled — there is no
// longer an open ask sitting with the artist. Leaving it at 'requested'/'in_progress' is the
// SO-1625 contradictory shape: the job renders as BOTH "Needs Approval" and an open "Start Working"
// request, and every `art_requests.some(r => r.status === 'requested' || 'in_progress')` reader
// (artist-board visibility, the "Art Requested" pill, the request card) thinks the job is still out
// with the artist. A production sweep on 2026-07-30 found 79 live jobs stuck in this shape.
//
// This is the ONE place that closes open requests, so the ~half-dozen hand-duplicated
// send-for-approval / approve paths in App.js and OrderEditor.js can't drift apart again — which is
// exactly how the gap opened (each path grew its own copy of the transition and only some closed
// the request).

export const OPEN_ART_REQ_STATUSES = ['requested', 'in_progress'];

// Returns a new array with every open request marked 'completed'; other requests (completed,
// recalled) are left untouched. Returns the input unchanged when there is nothing to close, so it
// is safe to call on every transition. Never mutates the input.
export function closeOpenArtRequests(reqs) {
  if (!Array.isArray(reqs) || reqs.length === 0) return reqs;
  let changed = false;
  const out = reqs.map((r) => {
    if (r && OPEN_ART_REQ_STATUSES.includes(r.status)) {
      changed = true;
      return { ...r, status: 'completed' };
    }
    return r;
  });
  return changed ? out : reqs;
}
