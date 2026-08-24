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
  // Catalog colors name body first, trim second. The body token decides — a dark garment must not
  // escape the upcharge because its own name ends in "/White" (EST-2139).
  test('two-tone DARK body still needs an underbase', () => {
    ['Black/White', 'Black/ White', 'Navy/White', 'Team Power Red/White', 'Royal/White',
     'Maroon/White', 'Dark Green/White', 'Medium Grey Heather/ White', 'Grey Three/White',
     'Team Collegiate Purple/White', 'Black, Team Royal Blue/White'].forEach(c =>
      expect(garmentNeedsUnderbase(c)).toBe(true));
  });
  test('two-tone LIGHT body does NOT need one', () => {
    ['White/Black', 'White/Team Grey', 'Vegas Gold/Black', 'Light Grey/Navy'].forEach(c =>
      expect(garmentNeedsUnderbase(c)).toBe(false));
  });
  test('a trailing "(SKU)" note does not change the answer', () => {
    expect(garmentNeedsUnderbase('Black/White (JX4452)')).toBe(true);
    expect(garmentNeedsUnderbase('White/Team Grey (JX4482)')).toBe(false);
    expect(garmentNeedsUnderbase('Black (KB9093)')).toBe(true);
  });
  test('blank / unknown color → false (do not auto-charge)', () => {
    expect(garmentNeedsUnderbase('')).toBe(false);
    expect(garmentNeedsUnderbase(null)).toBe(false);
    expect(garmentNeedsUnderbase(undefined)).toBe(false);
  });
});
