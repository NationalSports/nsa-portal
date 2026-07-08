// H4/REUSE-3 — garmentColorClass is the ONE shade table behind the reuse picker's
// color-way matching. The old duplicated regex silently classified Charcoal/Maroon/
// Royal/etc. as "dark-by-omission" (fell to cws[0]) while still rendering a green ✓.
// These tests pin the honest behavior: known light, known dark, and null for unknown.
import { garmentColorClass } from '../constants';

describe('garmentColorClass', () => {
  test('light garment colors', () => {
    ['White', 'Natural', 'Cream', 'Ivory', 'Ash', 'Silver', 'Sand', 'Vegas Gold',
      'Old Gold', 'Athletic Gold', 'Gold', 'Yellow', 'Maize', 'Heather Grey', 'Grey',
      'Gray', 'Light Grey', 'Lt Blue', 'Oxford', 'Stone', 'Tan', 'Khaki', 'Pink',
      'Columbia Blue', 'Carolina Blue', 'Sky Blue', 'Powder Blue', 'Baby Blue', 'Ice Blue',
    ].forEach(c => expect([c, garmentColorClass(c)]).toEqual([c, 'light']));
  });

  test('dark garment colors — incl. the ones the old regex dropped to fallback', () => {
    ['Black', 'Navy', 'Charcoal', 'Maroon', 'Royal', 'Red', 'Cardinal', 'Forest',
      'Forest Green', 'Hunter Green', 'Kelly Green', 'Dark Green', 'Green', 'Purple',
      'Graphite', 'Burgundy', 'Scarlet', 'Crimson', 'Brown', 'Orange', 'Royal Blue',
      'Navy Blue', 'Midnight Navy', 'Dark Grey', 'Dk Grey', 'Teal', 'Cobalt', 'Indigo',
    ].forEach(c => expect([c, garmentColorClass(c)]).toEqual([c, 'dark']));
  });

  test('heathered darks classify dark (heather is a texture, not a shade)', () => {
    expect(garmentColorClass('Heather Navy')).toBe('dark');
    expect(garmentColorClass('Charcoal Heather')).toBe('dark');
    expect(garmentColorClass('Heather')).toBe('light'); // plain heather = light grey melange
  });

  test('explicit light/dark modifiers win over the base token', () => {
    expect(garmentColorClass('Light Navy')).toBe('light');
    expect(garmentColorClass('Dark Heather')).toBe('dark');
  });

  test('CW labels like "on White" / "on Dark" resolve too (used to match art color_ways)', () => {
    expect(garmentColorClass('on White')).toBe('light');
    expect(garmentColorClass('On Dark Garments')).toBe('dark');
  });

  test('unknown / empty colors return null — caller must show "confirm", not a ✓', () => {
    expect(garmentColorClass('')).toBeNull();
    expect(garmentColorClass(null)).toBeNull();
    expect(garmentColorClass(undefined)).toBeNull();
    expect(garmentColorClass('Digi Camo')).toBeNull();
    expect(garmentColorClass('Multicolor')).toBeNull();
    expect(garmentColorClass('XJ-441')).toBeNull();
  });

  test('word boundaries — no substring false positives', () => {
    expect(garmentColorClass('Redwood')).toBeNull();      // not "red"
    expect(garmentColorClass('Blackberry Swirl')).toBeNull(); // not "black"
    expect(garmentColorClass('Golden Rod')).toBeNull();   // not "gold"
  });
});
