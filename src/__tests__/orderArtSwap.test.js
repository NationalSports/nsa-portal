/** @jest-environment node */
import { replaceTbdArt, tbdArtName, tbdArtLabel, isTbdArt } from '../lib/orderArtSwap';

test('replacing a shared TBD group keeps all assigned decorations and clears stale color ways', () => {
  const order = {
    art_files: [{ id: 'tbd', name: 'ART TBD 1 — mascot', deco_type: 'screen_print', _version: 7 }, { id: 'other', name: 'Other' }],
    items: [
      { decorations: [{ kind: 'art', art_file_id: 'tbd', color_way_id: 'old', sell_override: 2 }] },
      { decorations: [{ kind: 'art', art_file_id: 'tbd' }, { kind: 'art', art_file_id: 'other' }] },
    ],
    jobs: [{ art_file_id: 'tbd', art_name: 'ART TBD 1', assigned_artist: 'artist', art_requests: [{ status: 'requested' }] }],
  };
  const source = { id: 'prior', name: 'School Crest', deco_type: 'embroidery', status: 'approved', color_ways: [{ id: 'cw1' }], mockup_files: [{ url: 'old-mock.png' }], prod_files: [{ url: 'sew.dst' }], _so_id: 'SO-1', _version: 99 };
  const next = replaceTbdArt(order, 'tbd', source);
  expect(next.art_files[0]).toMatchObject({ id: 'tbd', name: 'School Crest', _version: 7, prod_files: [{ url: 'sew.dst' }], mockup_files: [] });
  expect(next.art_files[0]._so_id).toBeUndefined();
  expect(next.items[0].decorations[0]).toMatchObject({ art_file_id: 'tbd', color_way_id: null, sell_override: null });
  expect(next.items[1].decorations.map(d => d.art_file_id)).toEqual(['tbd', 'other']);
  expect(next.jobs[0]).toMatchObject({ art_name: 'School Crest', art_status: 'waiting_approval', assigned_artist: '', art_requests: [{ status: 'recalled' }] });
  expect(order.art_files[0].name).toBe('ART TBD 1 — mascot');
});

test('a TBD identifier becomes the whole name; the is_tbd flag keeps it a placeholder', () => {
  expect(tbdArtName('ART TBD 1', 'CSM crest')).toBe('CSM crest');
  expect(tbdArtName('CSM crest', ' 9in Basketball ')).toBe('9in Basketball');
  expect(tbdArtName('ART TBD 2', '')).toBe('ART TBD 2');
  expect(tbdArtLabel('ART TBD 1 — CSM crest')).toBe('CSM crest');
  expect(tbdArtLabel('9in Basketball')).toBe('9in Basketball');
  expect(isTbdArt({ name: 'ART TBD 1' })).toBe(true);
  expect(isTbdArt({ name: '9in Basketball', is_tbd: true })).toBe(true);
  expect(isTbdArt({ name: '9in Basketball', is_tbd: true, mockup_files: [{ url: 'm.png' }] })).toBe(false);
  expect(isTbdArt({ name: '9in Basketball', is_tbd: true, color_ways: [{ id: 'cw' }] })).toBe(false);
  expect(isTbdArt({ name: '9in Basketball' })).toBe(false);
  expect(isTbdArt(null)).toBe(false);
});

test('a renamed TBD can still be swapped for previous art, and the swap clears the flag', () => {
  const order = { art_files: [{ id: 'tbd', name: '9in Basketball', is_tbd: true }], items: [], jobs: [] };
  const next = replaceTbdArt(order, 'tbd', { id: 'prior', name: 'School Crest', is_tbd: true });
  expect(next.art_files[0].name).toBe('School Crest');
  expect(next.art_files[0].is_tbd).toBeUndefined();
});

test('a mixed-art job stays in Needs Art if its other design is still pending', () => {
  const order = {
    art_files: [
      { id: 'tbd', name: 'ART TBD 1' },
      { id: 'other', name: 'Second design', status: 'waiting_for_art' },
    ],
    items: [],
    jobs: [{ art_file_id: 'tbd', _art_ids: ['tbd', 'other'], art_name: 'Two designs', art_status: 'art_requested', prod_status: 'ready' }],
  };
  const next = replaceTbdArt(order, 'tbd', { id: 'prior', name: 'School Crest', status: 'approved' });
  expect(next.jobs[0]).toMatchObject({ art_name: 'Two designs', art_status: 'needs_art', prod_status: 'hold' });
});
