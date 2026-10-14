/* eslint-disable */
// Numbers / names mock slots store under the anchor artwork, but that artwork's logo proofs and
// production images are not numbers mocks — they must not be suggested there (EST-2944 backpack).
import { garmentSlotCandidates } from '../lib/jobMockCards';

const art = { id: 'af1', name: 'Shield Basketball', deco_type: 'embroidery',
  prod_files: [{ url: 'https://x/DG-622488_BASKETBALL_2a.JPG.png', name: 'DG-622488_BASKETBALL_2a.JPG' }],
  item_mockups: { '5161390|Team Power Red 2/Black': [{ url: 'https://x/logo-mock.png' }] } };
const item = { sku: '5161390', color: 'Team Power Red 2/Black' };

test('numbers slot offers only previous-order suggestions, never the logo artwork files', () => {
  const prior = [{ files: [{ url: 'https://x/prior-numbers.png' }] }];
  const urls = garmentSlotCandidates({ kind: 'numbers', artFile: art, key: 'k|num' }, item, [art], prior).map(f => f.url);
  expect(urls).toEqual(['https://x/prior-numbers.png']);
});

test('art slot still offers the artwork files', () => {
  const urls = garmentSlotCandidates({ kind: 'art', artFile: art, key: 'k' }, item, [art], []).map(f => f.url);
  expect(urls).toContain('https://x/DG-622488_BASKETBALL_2a.JPG.png');
});
