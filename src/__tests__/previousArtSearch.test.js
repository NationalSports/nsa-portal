/** @jest-environment node */
import { previousArtSport, previousArtSourceKey, previousArtReuseDesignId, filterPreviousArt } from '../lib/previousArtSearch';

test('FPU sibling teams remain separate and can be filtered by sport', () => {
  const basketball = { id: 'fpu-bb', name: 'FPU Women Basketball', parent_id: 'fpu' };
  const volleyball = { id: 'fpu-vb', name: 'FPU Women Volleyball', parent_id: 'fpu' };
  const art = { id: 'old-art', name: 'Sunbirds Crest', deco_type: 'screen_print', color_ways: [] };
  expect(previousArtSport(basketball, 'fpu')).toBe('Basketball');
  expect(previousArtSport(volleyball, 'fpu')).toBe('Volleyball');
  expect(previousArtSourceKey(art, basketball.id, 'Basketball')).not.toBe(previousArtSourceKey(art, volleyball.id, 'Volleyball'));
  expect(previousArtSourceKey(art, 'fpu', 'Basketball')).not.toBe(previousArtSourceKey(art, 'fpu', 'Volleyball'));
  expect(previousArtReuseDesignId(art, basketball.id)).not.toBe(previousArtReuseDesignId(art, volleyball.id));
  const choices = [
    { ...art, _srcTeam: basketball.name, _sport: 'Basketball' },
    { ...art, _srcTeam: volleyball.name, _sport: 'Volleyball' },
  ];
  expect(filterPreviousArt(choices, { search: 'sunbirds', sport: 'Volleyball' })).toEqual([choices[1]]);
  expect(filterPreviousArt(choices, { search: 'FPU Women', sport: 'Basketball' })).toEqual([choices[0]]);
});

test('parent artwork stays identified as shared', () => {
  expect(previousArtSport({ id: 'fpu', name: 'Fresno Pacific University' }, 'fpu')).toBe('Program / shared');
  expect(previousArtSport({ id: 'fpu', name: 'Fresno Pacific University' }, 'fpu', { name: 'Sunbirds Volleyball' })).toBe('Volleyball');
  expect(previousArtSport({ id: 'fpu', name: 'Fresno Pacific University' }, 'fpu', { name: 'Main Crest' }, 'Basketball gear')).toBe('Basketball');
});
