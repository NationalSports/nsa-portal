const {
  SCHOOL_COLOR_HEX,
  canonicalColorName,
  customerSchoolColorTheme,
  effectiveWebstoreColors,
} = require('./webstoreBranding');

describe('webstore school color defaults', () => {
  test('chooses a dark primary and vivid accent instead of the first two neutral colors', () => {
    expect(customerSchoolColorTheme({
      school_colors: ['White', 'Grey', 'Navy', 'Red'],
    })).toEqual({
      primary: SCHOOL_COLOR_HEX.Navy,
      accent: SCHOOL_COLOR_HEX.Red,
    });
  });

  test('accepts color names case-insensitively and treats Gray as Grey', () => {
    expect(canonicalColorName('navy')).toBe('Navy');
    expect(canonicalColorName('Gray')).toBe('Grey');
  });

  test('inherits parent colors only when the linked customer has none', () => {
    expect(customerSchoolColorTheme(
      { school_colors: null },
      { school_colors: ['Purple', 'Gold'] },
    )).toEqual({
      primary: SCHOOL_COLOR_HEX.Purple,
      accent: SCHOOL_COLOR_HEX.Gold,
    });
  });

  test('store-level colors win independently over customer defaults', () => {
    expect(effectiveWebstoreColors(
      { primary_color: '#010203', accent_color: null },
      { school_colors: ['Navy', 'Red'] },
    )).toEqual({
      primary: '#010203',
      accent: SCHOOL_COLOR_HEX.Red,
    });
  });
});
