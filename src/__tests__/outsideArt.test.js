const { buildOutsideArtJobs, isOutsideArtJob, productionJobs, wantsOutsideArt, outsideArtVendor } = require('../lib/outsideArt');
const { artStatusForFile } = require('../constants');

const so = (decoOver = {}, extra = {}) => ({
  id: 'SO-500',
  art_files: [{ id: 'a1', name: 'Crest', status: 'waiting_for_art', deco_type: 'embroidery' }],
  items: [
    { sku: 'POLO', name: 'Polo', color: 'Navy', sizes: { M: 4, L: 2 }, decorations: [{ kind: 'art', art_file_id: 'a1', position: 'Left Chest', fulfillment: 'outside', vendor: 'Olympic', outside_art: true, ...decoOver }] },
    { sku: 'HOOD', name: 'Hood', color: 'Grey', sizes: { L: 3 }, decorations: [{ kind: 'art', art_file_id: 'a1', position: 'Front', fulfillment: 'outside', vendor: 'Olympic', outside_art: true, ...decoOver }] },
  ],
  ...extra,
});
const build = (o, prev = [], opts = {}) => buildOutsideArtJobs(o, prev, { artStatusOf: artStatusForFile, reservedIds: ['JOB-500-01'], ...opts });

test('opt-in only: an outside decoration without the stamp gets no job (existing orders unchanged)', () => {
  expect(build(so({ outside_art: undefined }))).toEqual([]);
  expect(build(so({ outside_art: false }))).toEqual([]);
  expect(wantsOutsideArt({ kind: 'art', outside_art: true })).toBe(false); // not routed outside
});

test('one art-only job per design across every garment carrying it', () => {
  const [j] = build(so());
  expect(j).toMatchObject({ id: 'JOB-500-X01', key: 'outside_art:art_a1', prod_status: 'outside', art_status: 'needs_art', art_file_id: 'a1', total_units: 9, art_name: 'Crest', deco_type: 'embroidery' });
  expect(j.items.map((g) => [g.item_idx, g.deco_idxs])).toEqual([[0, [0]], [1, [0]]]);
  expect(isOutsideArtJob(j)).toBe(true);
  expect(outsideArtVendor(so(), j)).toBe('Olympic');
});

test('workflow fields and id carry over; human-advanced art status is kept', () => {
  const [first] = build(so());
  const prev = [{ ...first, art_status: 'art_requested', assigned_artist: 'u9', art_requests: [{ status: 'requested' }], _version: 3 }];
  const [next] = build(so(), prev);
  expect(next).toMatchObject({ id: 'JOB-500-X01', art_status: 'art_requested', assigned_artist: 'u9', _version: 3 });
});

test('reused approved art waits for the rep to confirm, except on store pulls', () => {
  const approved = so({}, { art_files: [{ id: 'a1', name: 'Crest', status: 'approved', deco_type: 'embroidery', prod_files_attached: true }] });
  expect(build(approved)[0].art_status).toBe('needs_art_review');
  expect(build(approved, [], { isStoreOrder: true })[0].art_status).toBe('art_complete');
});

test('turning the art flow off removes the job', () => {
  const [j] = build(so());
  expect(build(so({ outside_art: false }), [j])).toEqual([]);
});

test('production readers never see outside-art jobs', () => {
  const jobs = [{ id: 'JOB-1', prod_status: 'hold', key: 'x' }, { id: 'JOB-X', prod_status: 'outside', key: 'outside_art:art_a1' }, { id: 'JOB-Y', prod_status: 'staging', key: 'outside_art:art_b' }];
  expect(productionJobs(jobs).map((j) => j.id)).toEqual(['JOB-1']);
});

test('an order whose only jobs are outside-art still reaches ready to invoice / complete like before', () => {
  const { calcSOStatus } = require('../businessLogic');
  const base = { items: [{ sizes: { M: 2 }, decorations: [{ kind: 'art', fulfillment: 'outside', outside_art: true }], po_lines: [{ M: 2, received: { M: 2 } }] }] };
  expect(calcSOStatus({ ...base, jobs: [] })).toBe(calcSOStatus({ ...base, jobs: [{ id: 'X', key: 'outside_art:art_a', prod_status: 'outside' }] }));
});

const requested = o => build(o).map(j => ({ ...j, art_status: 'art_requested', assigned_artist: 'artist', _version: 4, art_requests: [{ id: 'request', status: 'requested' }] }));

test('new designs cannot steal existing IDs even when inserted before existing garments', () => {
  const original = so();
  const previous = requested(original);
  const added = { ...original.items[0], decorations: [{ ...original.items[0].decorations[0], art_file_id: 'new' }] };
  const next = build({ ...original, items: [added, ...original.items] }, previous);
  expect(next.find(j => j.art_file_id === 'a1')).toMatchObject({ id: previous[0].id, art_requests: previous[0].art_requests });
  expect(next.find(j => j.art_file_id === 'new').id).not.toBe(previous[0].id);
  expect(build({ ...original, items: [added, ...original.items] }, next)).toEqual(next);
});

test('replacing requested artwork preserves job identity and artist request', () => {
  const original = so();
  const previous = requested(original);
  const replacement = so({ art_file_id: 'new' }, { art_files: [{ id: 'new', name: 'New art', status: 'approved' }] });
  const [next] = build(replacement, previous);
  expect(next).toMatchObject({ id: previous[0].id, art_file_id: 'new', assigned_artist: 'artist', art_status: 'art_requested', art_requests: previous[0].art_requests, _version: 4, _coach_cleared: true });
  expect(build(replacement, [next])[0]).toEqual(next);
});

test('replacement approval requires a new review and clears old coach approval', () => {
  const previous = build(so()).map(j => ({ ...j, art_status: 'art_complete', coach_approved_at: 'old', sent_to_coach_at: 'old', art_reuse_confirmed: true }));
  const [next] = build(so({ art_file_id: 'new' }, { art_files: [{ id: 'new', status: 'approved' }] }), previous);
  expect(next).toMatchObject({ id: previous[0].id, art_status: 'needs_art_review', coach_approved_at: null, sent_to_coach_at: null, art_reuse_confirmed: false, _coach_cleared: true });
});

test('a partial art replacement does not copy the surviving job workflow', () => {
  const original = so();
  const previous = requested(original);
  const items = original.items.map((it, i) => i ? it : { ...it, decorations: [{ ...it.decorations[0], art_file_id: 'new' }] });
  const next = build({ ...original, items }, previous);
  expect(next.find(j => j.art_file_id === 'a1').id).toBe(previous[0].id);
  expect(next.find(j => j.art_file_id === 'new').art_requests).toBeUndefined();
  expect(new Set(next.map(j => j.id)).size).toBe(2);
});

test('replacement matching follows stable line IDs across garment reordering', () => {
  const original = so();
  original.items.forEach((it, i) => { it.line_id = 'line-' + i; });
  const previous = requested(original);
  const items = [...original.items].reverse().map(it => ({ ...it, decorations: [{ ...it.decorations[0], art_file_id: 'new' }] }));
  expect(build({ ...original, items, art_files: [{ id: 'new', status: 'approved' }] }, previous)[0]).toMatchObject({ id: previous[0].id, art_status: 'art_requested' });
});
