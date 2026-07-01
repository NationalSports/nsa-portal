/* eslint-disable */
// NSA rule: screen-print on anything besides white / light grey / vegas gold needs a white underbase.
const { garmentNeedsUnderbase } = require('../businessLogic');

describe('garmentNeedsUnderbase', () => {
  test('light garments do NOT need an underbase', () => {
    ['White', 'white', 'Vegas Gold', 'vegas', 'Light Grey', 'Light Gray', 'Lt Grey'].forEach(c =>
      expect(garmentNeedsUnderbase(c)).toBe(false));
  });
  test('everything darker DOES need an underbase', () => {
    ['Black', 'Power Red', 'Navy', 'Maroon', 'Grey', 'Dark Grey', 'Forest', 'Royal'].forEach(c =>
      expect(garmentNeedsUnderbase(c)).toBe(true));
  });
  test('plain grey (not light grey) needs one; light grey does not', () => {
    expect(garmentNeedsUnderbase('Grey')).toBe(true);
    expect(garmentNeedsUnderbase('Light Grey')).toBe(false);
  });
  test('blank / unknown color → false (do not auto-charge)', () => {
    expect(garmentNeedsUnderbase('')).toBe(false);
    expect(garmentNeedsUnderbase(null)).toBe(false);
    expect(garmentNeedsUnderbase(undefined)).toBe(false);
  });
});
