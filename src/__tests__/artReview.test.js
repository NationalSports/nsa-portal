// The two art-review writes, now shared by the order page and the dashboard's inline
// Approve / Request-changes bar. These lock the parts that have actually broken before:
// the open art_request left dangling (SO-1625), coach flags left stranded on a job whose
// status moved past them (SO-1199), and a stale .dst surviving a redo.
import { approveArtOnSO, sendArtBackOnSO, artApproveTarget, ART_PULLBACK_CLEARS } from '../lib/artReview';

const so = (over = {}) => ({
  id: 'SO-1',
  jobs: [
    { id: 'JOB-1-01', art_status: 'waiting_approval', art_requests: [{ id: 'r1', status: 'in_progress' }] },
    { id: 'JOB-1-02', art_status: 'waiting_approval', art_requests: [{ id: 'r2', status: 'requested' }] },
    { id: 'JOB-1-09', art_status: 'needs_art' },
  ],
  art_files: [
    { id: 'a1', status: 'needs_approval' },
    { id: 'a2', status: 'needs_approval' },
  ],
  ...over,
});
const onlyFirst = (jj) => jj.id === 'JOB-1-01';
const family = (jj) => jj.id === 'JOB-1-01' || jj.id === 'JOB-1-02';

describe('approveArtOnSO', () => {
  test('moves only the matched jobs and leaves the rest untouched', () => {
    const out = approveArtOnSO(so(), { match: onlyFirst, artIds: ['a1'], targetStatus: 'art_complete', stampProd: true });
    expect(out.jobs.map((j) => j.art_status)).toEqual(['art_complete', 'waiting_approval', 'needs_art']);
  });

  test('closes the artist\'s open request in the same write (SO-1625)', () => {
    const out = approveArtOnSO(so(), { match: family, artIds: ['a1'], targetStatus: 'art_complete', stampProd: true });
    expect(out.jobs[0].art_requests[0].status).toBe('completed');
    expect(out.jobs[1].art_requests[0].status).toBe('completed');
  });

  test('leaves already-settled requests alone', () => {
    const base = so();
    base.jobs[0].art_requests = [{ id: 'r0', status: 'recalled' }, { id: 'r1', status: 'in_progress' }];
    const out = approveArtOnSO(base, { match: onlyFirst, artIds: [], targetStatus: 'art_complete' });
    expect(out.jobs[0].art_requests.map((r) => r.status)).toEqual(['recalled', 'completed']);
  });

  test('clears coach_rejected so an approved job is never also flagged rejected (SO-1199)', () => {
    const base = so();
    base.jobs[0].coach_rejected = true;
    const out = approveArtOnSO(base, { match: onlyFirst, artIds: ['a1'], targetStatus: 'art_complete', stampProd: true });
    expect(out.jobs[0].coach_rejected) .toBe(false);
    expect(out.jobs[0].rejections).toBeUndefined(); // history is not rewritten
  });

  test('stampProd controls prod_files_attached; only listed art files move', () => {
    const stamped = approveArtOnSO(so(), { match: onlyFirst, artIds: ['a1'], targetStatus: 'art_complete', stampProd: true });
    expect(stamped.art_files[0]).toMatchObject({ status: 'approved', prod_files_attached: true });
    expect(stamped.art_files[1].status).toBe('needs_approval');

    const unstamped = approveArtOnSO(so(), { match: onlyFirst, artIds: ['a1'], targetStatus: 'production_files_needed', stampProd: false });
    expect(unstamped.art_files[0].status).toBe('approved');
    expect(unstamped.art_files[0].prod_files_attached).toBeUndefined();
  });

  test('does not mutate the input SO', () => {
    const base = so();
    approveArtOnSO(base, { match: family, artIds: ['a1', 'a2'], targetStatus: 'art_complete', stampProd: true });
    expect(base.jobs[0].art_status).toBe('waiting_approval');
    expect(base.jobs[0].art_requests[0].status).toBe('in_progress');
    expect(base.art_files[0].status).toBe('needs_approval');
  });

  test('updated_at is stamped only when the caller supplies one', () => {
    expect(approveArtOnSO(so(), { match: onlyFirst, targetStatus: 'art_complete' }).updated_at).toBeUndefined();
    expect(approveArtOnSO(so(), { match: onlyFirst, targetStatus: 'art_complete', updatedAt: 'X' }).updated_at).toBe('X');
  });
});

describe('sendArtBackOnSO', () => {
  const back = (over = {}) => sendArtBackOnSO(so(over), { match: family, artIds: ['a1'], reason: 'Wrong orange', by: 'Sam', at: '2026-08-10T12:00:00.000Z' });

  test('returns the whole family to the artist', () => {
    const out = back();
    expect(out.jobs.map((j) => j.art_status)).toEqual(['art_requested', 'art_requested', 'needs_art']);
  });

  test('records the reason with both timestamp keys readers use', () => {
    const rej = back().jobs[0].rejections[0];
    expect(rej).toEqual({ by: 'Sam', at: '2026-08-10T12:00:00.000Z', rejected_at: '2026-08-10T12:00:00.000Z', reason: 'Wrong orange' });
  });

  test('appends to rejection history rather than replacing it', () => {
    const out = back({ jobs: [{ id: 'JOB-1-01', rejections: [{ reason: 'first' }] }] });
    expect(out.jobs[0].rejections.map((r) => r.reason)).toEqual(['first', 'Wrong orange']);
  });

  test('clears every coach flag, deliberately (dbEngine audit A9)', () => {
    const out = sendArtBackOnSO(
      so({ jobs: [{ id: 'JOB-1-01', sent_to_coach_at: 'x', follow_up_at: 'y', coach_approved_at: 'z', coach_rejected: true }] }),
      { match: onlyFirst, artIds: [], reason: 'redo', by: 'Sam' },
    );
    expect(out.jobs[0]).toMatchObject(ART_PULLBACK_CLEARS);
    expect(out.jobs[0]._coach_cleared).toBe(true);
  });

  test('art goes back to waiting_for_art with prod files unconfirmed and DSTs staled', () => {
    const out = sendArtBackOnSO(
      so({ art_files: [{ id: 'a1', status: 'approved', prod_files_attached: true, files: [{ name: 'logo.dst' }], prod_files: [{ name: 'seps.dst' }, { name: 'proof.pdf' }] }] }),
      { match: onlyFirst, artIds: ['a1'], reason: 'redo', by: 'Sam' },
    );
    const af = out.art_files[0];
    expect(af.status).toBe('waiting_for_art');
    expect(af.prod_files_attached).toBe(false);
    expect(af.files[0].stale).toBe(true);
    expect(af.prod_files[0].stale).toBe(true);
    expect(af.prod_files[1].stale).toBeUndefined(); // only stitch files are retired
  });

  test('art files outside the job are not touched', () => {
    const out = back();
    expect(out.art_files[1].status).toBe('needs_approval');
  });
});

describe('artApproveTarget', () => {
  const confirmed = { id: 'a1', prod_files_attached: true };
  const bare = { id: 'a2' };

  test('every art file confirmed → straight to art_complete', () => {
    expect(artApproveTarget([confirmed, { id: 'a3', prod_files_attached: true }], 'screen_print'))
      .toEqual({ allConfirmed: true, targetStatus: 'art_complete' });
  });

  test('one unconfirmed file routes the whole job to its production-files stage', () => {
    expect(artApproveTarget([confirmed, bare], 'screen_print').targetStatus).toBe('production_files_needed');
    expect(artApproveTarget([bare], 'embroidery').targetStatus).toBe('upload_emb_files');
    expect(artApproveTarget([bare], 'dtf').targetStatus).toBe('order_dtf_transfers');
    expect(artApproveTarget([bare], 'heat_press').targetStatus).toBe('order_dtf_transfers');
  });

  // artDstOnFile keys off the ART FILE's own deco_type, not the job's — approving IS the
  // sign-off on the current art, so a live stitch file counts before the status flips.
  test('a live .dst counts as the embroidery separation, a stale one does not', () => {
    const emb = (prod_files) => [{ id: 'a1', deco_type: 'embroidery', prod_files }];
    expect(artApproveTarget(emb([{ name: 'left-chest.dst' }]), 'embroidery').allConfirmed).toBe(true);
    expect(artApproveTarget(emb([{ name: 'left-chest.dst', stale: true }]), 'embroidery'))
      .toEqual({ allConfirmed: false, targetStatus: 'upload_emb_files' });
  });

  test('a dangling art reference never satisfies the gate vacuously', () => {
    expect(artApproveTarget([confirmed, undefined], 'screen_print'))
      .toEqual({ allConfirmed: false, targetStatus: 'production_files_needed' });
  });

  test('a job with no art at all (names/numbers only) approves straight through', () => {
    expect(artApproveTarget([], 'screen_print')).toEqual({ allConfirmed: true, targetStatus: 'art_complete' });
  });
});
