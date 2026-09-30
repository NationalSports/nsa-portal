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
  expect(build(approved)[0].art_status).toBe('waiting_approval');
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
