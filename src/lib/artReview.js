// The two art-review WRITES a rep makes on a job: approve it, or send it back to the artist.
//
// Until now both lived only on the order page (OrderEditor `_approveArtTo` /
// `_sendArtBackToArtist`). The dashboard's "Art awaiting approval" panel now makes the same
// two decisions inline, and hand-writing a third copy of the transition is precisely how
// SO-1625 happened: each approve path grew its own copy and only some of them closed the
// artist's open art_request, leaving 79 live jobs reading as BOTH "Needs Approval" and an
// open request. Every caller funnels through here so that can't happen again.
//
// These are PURE. They take the SO to write against, return a new one, and do nothing else:
// no saving, no notifications, no confirms. Every gate — Art TBD, missing garment mockups,
// the coach-rejected override prompt, the production-files routing choice — stays at the call
// site, which is the only place that can talk to the user.
//
// `match(job, idx)` selects the jobs to write. Callers pass their own rule because they
// genuinely differ: the order page's approve targets one job id, while its revision request
// and the dashboard target the whole split family (slices share one artwork, so moving only
// one strands the other in an earlier column).
//
// The caller also decides which jobs array is authoritative by handing us the SO with it in
// place — `safeJobs(so)` on the order page (the persisted array it is editing), `buildJobs(so)`
// on the dashboard (the derived array the workboard reads). We do not choose for them.

import { closeOpenArtRequests } from './artRequests';
import { markDstsStale, prodFilesStatusFor, artProdFilesConfirmed, artDstOnFile } from '../constants';

// Where an approval lands. 'art_complete' ONLY when every live art file already carries a
// CONFIRMED production separation (or a live .dst — approving IS the sign-off on the current
// art, so a non-stale stitch file counts); otherwise the decoration's production-files stage,
// where the artist still owes the separation. This is the routing `artStatusForFile` derives
// per file, applied to a whole job.
//
// A missing file (an id that no longer resolves) counts as NOT confirmed — never let a dangling
// reference vacuously satisfy the gate. A job with no art at all (names/numbers only) has
// nothing to separate and approves straight through, which is what the order page does too.
//
// Callers that can prompt — the order page — may instead ask the rep which of the two it is.
// Callers that can't must take the conservative branch this returns: a job that still owes
// separations landing in art_complete is how unprintable work reaches the floor.
export function artApproveTarget(artFiles, deco) {
  const files = artFiles || [];
  const allConfirmed = files.length === 0
    || files.every((a) => !!a && (artProdFilesConfirmed(a) || artDstOnFile(a)));
  return { allConfirmed, targetStatus: allConfirmed ? 'art_complete' : prodFilesStatusFor(deco) };
}

// Every path that pulls art back for rework must clear the same approval residue — one shared
// list so the call sites can't drift. A stale coach flag produces phantom to-dos and a "Sent to
// Customer" badge on art the coach has never seen; a stale follow_up_at keeps nagging them.
// `_coach_cleared` marks the nulls as DELIBERATE for dbEngine's coach-decision guard (audit A9):
// without it, a save nulling a non-null coach column is treated as stale and the DB value wins.
export const ART_PULLBACK_CLEARS = {
  sent_to_coach_at: null,
  follow_up_at: null,
  coach_approved_at: null,
  coach_rejected: false,
  _coach_cleared: true,
};

// Approve a job's art into `targetStatus` — either 'art_complete' (a production separation is
// CONFIRMED) or the decoration's production-files stage (the artist still owes the separation).
// Callers must decide which via artProdFilesConfirmed; approving into art_complete without a
// confirmed separation is the failure this split exists to prevent.
//
// stampProd sets prod_files_attached on the approved art so a confirmed job stays out of the
// seps stage on the next buildJobs pass.
//
// coach_rejected is cleared in the SAME write as the status: an approved job still flagged
// rejected is the SO-1199 contradictory shape (rejections[] keeps the history either way).
export function approveArtOnSO(so, { match, artIds, targetStatus, stampProd, updatedAt }) {
  const ids = artIds || [];
  const jobs = (so.jobs || []).map((jj, idx) => (match(jj, idx)
    ? {
      ...jj,
      art_status: targetStatus,
      coach_rejected: false,
      art_requests: closeOpenArtRequests(jj.art_requests || []),
    }
    : jj));
  const art_files = ids.length
    ? (so.art_files || []).map((a) => (ids.includes(a.id)
      ? { ...a, status: 'approved', ...(stampProd ? { prod_files_attached: true } : {}) }
      : a))
    : (so.art_files || []);
  return { ...so, jobs, art_files, ...(updatedAt ? { updated_at: updatedAt } : {}) };
}

// Send a job's art back to the artist with a written reason.
//
// The art files go back to waiting_for_art with prod_files_attached cleared, and any attached
// .dst is tagged stale — that stitch file belongs to the design being redrawn and must never
// satisfy a production-files gate for the replacement (history stays downloadable).
//
// The rejection record carries BOTH `at` and `rejected_at`: readers are split between the two
// (the dashboard's to-do generator sorts on rejected_at, the art card renders `at`), and a
// record with only one of them sorts to the wrong end of the queue.
export function sendArtBackOnSO(so, { match, artIds, reason, by, at, updatedAt }) {
  const ids = artIds || [];
  const stamp = at || new Date().toISOString();
  const rejection = { by, at: stamp, rejected_at: stamp, reason };
  const jobs = (so.jobs || []).map((jj, idx) => (match(jj, idx)
    ? {
      ...jj,
      art_status: 'art_requested',
      // Sending art back means the artist has work to do NOW — a job parked off the workboard with
      // "Hide from board" must come back, or the revision request is invisible to them (SO-1571).
      art_hidden: false,
      ...ART_PULLBACK_CLEARS,
      rejections: [...(jj.rejections || []), rejection],
    }
    : jj));
  const art_files = (so.art_files || []).map((a) => (ids.includes(a.id)
    ? {
      ...a,
      status: 'waiting_for_art',
      prod_files_attached: false,
      files: markDstsStale(a.files),
      prod_files: markDstsStale(a.prod_files),
    }
    : a));
  return { ...so, jobs, art_files, ...(updatedAt ? { updated_at: updatedAt } : {}) };
}
