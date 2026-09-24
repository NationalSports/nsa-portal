import { storeMockPlan, containRect, attachStoreGarmentMocks } from '../lib/storeGarmentMocks';

const fixture = () => ({
  item: { sku: 'POLO', color: 'Navy', decorations: [{ kind: 'art', art_file_id: 'logo', side: 'front' }] },
  // SO-2245: neither order line nor webstore_products stored a static image;
  // the storefront displayed the master garment with a positioned logo.
  product: { image_front_url: 'garment.png', image_back_url: 'back.png' },
  catalog: { image_url: null },
  decorations: [{ art_id: 'logo', art_url: 'red-logo.png', placement: 'left_chest', x: 64, y: 27, w: 15, cw_by_color: { navy: { url: 'white-logo.png' } } }],
});
const arts = () => [{ id: 'logo', status: 'approved', item_mockups: {} }, { id: 'other', item_mockups: {} }];
const deps = () => ({ render: jest.fn(async () => ({ type: 'image/png' })), upload: jest.fn(async () => 'rendered.png') });

test('captures garment plus the correct colorway at storefront coordinates despite null image_url', () => {
  expect(storeMockPlan(fixture())).toMatchObject({ base: 'garment.png', width: 800, height: 1000, layers: [{ url: 'white-logo.png', x: 64, y: 27, w: 15 }] });
  expect(containRect(1000, 1000, 800, 1000)).toEqual({ x: 0, y: 100, width: 800, height: 800 });
});
test('baked store image is reused, never double-stamped', async () => {
  const source = fixture(); source.catalog.image_url = 'baked.png'; source.decorations[0].baked = true;
  expect(storeMockPlan(source).layers).toEqual([]);
  const upload = jest.fn();
  const result = await attachStoreGarmentMocks(arts(), [source], { upload });
  expect(result.artFiles[0].item_mockups['POLO|Navy'][0].url).toBe('baked.png');
  expect(upload).not.toHaveBeenCalled();
});
test('generated mock persists on the correct art and exact garment key, approval untouched', async () => {
  const input = arts(), original = JSON.stringify(input), dep = deps();
  const result = await attachStoreGarmentMocks(input, [fixture()], dep);
  expect(result.warnings).toEqual([]);
  expect(result.artFiles[0].item_mockups['POLO|Navy'][0]).toMatchObject({ url: 'rendered.png', source: 'webstore', art_file_id: 'logo' });
  expect(result.artFiles[0].status).toBe('approved');
  expect(result.artFiles[1]).toBe(input[1]);
  expect(JSON.stringify(input)).toBe(original);
});
test.each([{ existing: [{ url: 'manual.png' }] }, { existing: [] }])('does not overwrite an existing or explicitly cleared slot: %j', async ({ existing }) => {
  const input = arts(); input[0].item_mockups['POLO|Navy'] = existing;
  const dep = deps(); const result = await attachStoreGarmentMocks(input, [fixture()], dep);
  expect(result.artFiles).toBe(input); expect(dep.render).not.toHaveBeenCalled();
});
test('front and back route independently, price-split lines reuse the same upload', async () => {
  const source = fixture(); source.item.decorations.push({ kind: 'art', art_file_id: 'other', side: 'back' });
  source.decorations.push({ art_id: 'other', art_url: 'back-logo.png', side: 'back', placement: 'full_back' });
  const dep = deps(); const result = await attachStoreGarmentMocks(arts(), [source, source], dep);
  expect(result.artFiles[0].item_mockups['POLO|Navy'][0].side).toBe('front');
  expect(result.artFiles[1].item_mockups['POLO|Navy|d1'][0].side).toBe('back');
  expect(dep.upload).toHaveBeenCalledTimes(2);
});
test.each(['ambiguous', 'substituted'])('%s garment requires review, never auto-adopts the old image', async key => {
  const dep = deps(); const result = await attachStoreGarmentMocks(arts(), [{ ...fixture(), [key]: true }], dep);
  expect(result.warnings).toHaveLength(1); expect(dep.upload).not.toHaveBeenCalled();
});
test('an unpositioned transfer never inherits an unrelated store logo mock', async () => {
  const source = fixture();
  source.item.decorations.push({ kind: 'art', art_file_id: 'other', side: 'front', transfer_code: 'TRANSFER' });
  const dep = deps(); const result = await attachStoreGarmentMocks(arts(), [source], dep);
  expect(result.warnings[0]).toContain('Transfer');
  expect(dep.upload).not.toHaveBeenCalled();
  expect(result.artFiles[1].item_mockups).toEqual({});
});
test('missing placed artwork produces a manual recovery warning', async () => {
  const source = fixture(); source.decorations = [];
  const dep = deps(); const result = await attachStoreGarmentMocks(arts(), [source], dep);
  expect(result.warnings[0]).toContain('No positioned store artwork');
  expect(dep.upload).not.toHaveBeenCalled();
});
test('missing base/logo and upload failures stay unmocked with actionable warnings', async () => {
  for (const alter of [s => { s.product = {}; }, s => { s.decorations[0].art_url = ''; s.decorations[0].cw_by_color = {}; }]) {
    const source = fixture(); alter(source);
    const dep = deps(); const result = await attachStoreGarmentMocks(arts(), [source], dep);
    expect(result.warnings).toHaveLength(1); expect(result.artFiles[0].item_mockups).toEqual({}); expect(dep.render).not.toHaveBeenCalled();
  }
  const dep = deps(); dep.upload.mockRejectedValue(new Error('Upload failed'));
  const result = await attachStoreGarmentMocks(arts(), [fixture()], dep);
  expect(result.warnings[0]).toContain('Upload failed'); expect(result.artFiles[0].item_mockups).toEqual({});
});
