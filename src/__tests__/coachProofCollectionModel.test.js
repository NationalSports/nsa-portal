import { buildCoachProofCollection, coachProofStatus, nextPendingCoachProof } from '../lib/coachProofCollection';
const pending = (id, items = []) => ({ id, art_file_id: 'art-' + id, art_status: 'waiting_approval', sent_to_coach_at: '2026-10-14T12:00:00Z', items });

test('split quantities and two designs on one garment retain distinct navigation identities', () => {
  const entries = buildCoachProofCollection({ orderId: 'SO-1', items: [{ name: 'Pullover' }, { name: 'Crew' }], jobs: [
    pending('front', [{ item_idx: 0, sizes: { M: 3 } }, { item_idx: 1, sizes: { M: 4 } }]),
    pending('back', [{ item_idx: 1, sizes: { M: 4 } }]),
  ] });
  expect(entries.map(e => [e.jobId, e.itemIndex, e.name, e.qty])).toEqual([
    ['front', 0, 'Pullover', 3], ['front', 1, 'Crew', 4], ['back', 0, 'Crew', 4],
  ]);
  expect(new Set(entries.map(e => e.key)).size).toBe(3);
});
test('draft and rejected revisions are disabled until the rep sends them', () => {
  const entries = buildCoachProofCollection({ orderId: 'SO-1', jobs: [
    { ...pending('draft'), sent_to_coach_at: null },
    { ...pending('changes'), sent_to_coach_at: null, coach_rejected: true }, pending('ready'),
  ] });
  expect(entries.map(e => [e.status, e.canOpen])).toEqual([
    ['Mockup in progress', false], ['Changes requested', false], ['Awaiting approval', true],
  ]);
  expect(nextPendingCoachProof(entries, entries[0].key).jobId).toBe('ready');
  expect(coachProofStatus({ ...pending('resent'), coach_rejected: true, coach_approved_at: 'old' })).toBe('Awaiting approval');
});
test('file-prep approvals remain approved and continuation skips all items of the decided design', () => {
  const entries = buildCoachProofCollection({ orderId: 'SO-1', jobs: [
    pending('current', [{ item_idx: 0 }, { item_idx: 1 }]),
    { ...pending('approved'), art_status: 'upload_emb_files', coach_approved_at: 'now' }, pending('next'),
  ] });
  expect(entries[2].status).toBe('Approved');
  expect(nextPendingCoachProof(entries, entries[0].key, 'current').jobId).toBe('next');
  expect(nextPendingCoachProof(entries.slice(0, 2), entries[0].key, 'current')).toBeNull();
});
test('outside art remains in the collection; names/numbers-only jobs do not promise mockups', () => {
  const entries = buildCoachProofCollection({ orderId: 'SO-1', jobs: [
    { id: 'numbers' }, { id: 'coming', art_file_id: '__tbd', art_status: 'needs_art' },
    { ...pending('outside'), prod_status: 'outside' },
  ] });
  expect(entries.map(e => e.jobId)).toEqual(['coming', 'outside']);
});
test('null order lines do not shift indices and empty collections are safe', () => {
  const entries = buildCoachProofCollection({ orderId: 'SO-1', items: [null, { name: 'Cap' }], jobs: [pending('cap', [{ item_idx: 1 }])] });
  expect(entries[0].name).toBe('Cap');
  expect(buildCoachProofCollection({ jobs: null, items: null })).toEqual([]);
});

test('an old approval timestamp cannot publish or approve a new internal revision', () => {
  const entries = buildCoachProofCollection({ orderId: 'SO-1', jobs: [
    { id: 'revised', art_file_id: 'A1', art_status: 'art_in_progress', coach_approved_at: 'old', sent_to_coach_at: null },
  ] });
  expect(entries[0].status).toBe('Mockup in progress');
  expect(entries[0].canOpen).toBe(false);
});
