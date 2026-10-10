import { requestProductionFilesOnSO, sendArtBackOnSO, approveArtOnSO } from '../lib/artReview';
import { jobAwaitingArtist } from '../lib/artRequests';
import { shouldShowMockupReviewNotice } from '../lib/dashboardNotificationRules';

const fixture = (deco = 'screen_print') => ({
  jobs: [{ id: 'job', art_file_id: 'art', art_status: 'art_complete', prod_status: 'in_process',
    coach_approved_at: '2026-09-01', sent_to_coach_at: '2026-08-31', art_hidden: true,
    art_requests: [{ id: 'old', status: 'completed' }] }, { id: 'other', art_status: 'waiting_approval' }],
  art_files: [{ id: 'art', status: 'approved', deco_type: deco, prod_files_attached: true,
    item_mockups: { 'TEE|Black': [{ url: 'mock.jpg' }] }, prod_files: [{ name: 'file.dst' }] },
    { id: 'other-art', status: 'needs_approval' }],
});
const options = { match: j => j.id === 'job', artIds: ['art'],
  request: { id: 'new', artist: 'artist', instructions: 'Need separations' } };

test('separations keep the proof and coach approval, reopening only production readiness', () => {
  const so = fixture();
  const next = requestProductionFilesOnSO(so, options);
  expect(next.jobs[0]).toMatchObject({ art_status: 'production_files_needed', prod_status: 'hold',
    coach_approved_at: '2026-09-01', sent_to_coach_at: '2026-08-31', art_hidden: false });
  expect(next.art_files[0]).toMatchObject({ status: 'approved', prod_files_attached: false });
  expect(next.art_files[0].item_mockups).toBe(so.art_files[0].item_mockups);
  expect(next.jobs[0].art_requests[1]).toMatchObject({ type: 'production_files', status: 'requested' });
  expect(jobAwaitingArtist(next.jobs[0])).toBe(true);
  expect(shouldShowMockupReviewNotice(next.jobs[0], next)).toBe(false);
  expect(next.jobs[1]).toBe(so.jobs[1]);
  expect(next.art_files[1]).toBe(so.art_files[1]);
  expect(so.art_files[0].prod_files_attached).toBe(true);
});
test.each([['embroidery','upload_emb_files'], ['dtf','order_dtf_transfers']])('routes %s correctly', (deco, status) => {
  const next = requestProductionFilesOnSO(fixture(deco), options);
  expect(next.jobs[0].art_status).toBe(status);
  expect(next.art_files[0].prod_files[0].stale).toBe(true);
});
test('mixed print and DTF routes to artist-owned separations first', () => {
  const so = fixture('dtf');
  so.art_files.push({ id: 'print', status: 'approved', deco_type: 'screen_print', prod_files_attached: true });
  expect(requestProductionFilesOnSO(so, { ...options, artIds: ['art','print'] }).jobs[0].art_status)
    .toBe('production_files_needed');
});
test('unapproved or missing designs cannot use production-only request', () => {
  expect(() => requestProductionFilesOnSO(fixture(), { ...options, artIds: ['missing'] })).toThrow();
  expect(() => requestProductionFilesOnSO(fixture(), { ...options, artIds: ['other-art'] })).toThrow();
  expect(() => requestProductionFilesOnSO(fixture(), { ...options, artIds: [] })).toThrow();
});
test('genuine revision still clears approval and returns to artist', () => {
  const next = sendArtBackOnSO(fixture(), { ...options, reason: 'Change the logo' });
  expect(next.jobs[0].art_status).toBe('art_requested');
  expect(next.jobs[0].coach_approved_at).toBeNull();
  expect(next.art_files[0].status).toBe('waiting_for_art');
});
test('confirmed production completion closes request without a new mockup review', () => {
  const next = requestProductionFilesOnSO(fixture(), options);
  const done = approveArtOnSO(next, { ...options, targetStatus: 'art_complete', stampProd: true });
  expect(done.jobs[0].art_requests[1].status).toBe('completed');
  expect(jobAwaitingArtist(done.jobs[0])).toBe(false);
  expect(shouldShowMockupReviewNotice(done.jobs[0], done)).toBe(false);
});
