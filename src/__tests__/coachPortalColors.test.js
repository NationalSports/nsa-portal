/* eslint-disable */
/**
 * Regression tests for the coach-portal team-color theming.
 *
 * Bug: the portal derived its theme + "Team Colors" swatches from
 * customer.school_colors (the catalog color-family picker), which ~95% of
 * customers never fill — they only fill the "School Colors (Pantone)" card,
 * which writes customer.pantone_colors. So the portal ignored their real colors
 * and painted the NSA navy/red default for 295 of 311 color-defined customers
 * (e.g. San Juan Missions rendered navy/red/white instead of cardinal/gold).
 *
 * Fix: cpEffectiveFamilies() falls back to the saved Pantone colors, and the
 * color NAME wins over a mis-stored hex ("1815 Cardinal" → Cardinal even though
 * its saved hex is a placeholder grey).
 *
 * html2pdf ships a dist bundle jest can't transform and rides in via
 * components.js/utils.js; stub it so the module mounts.
 */
jest.mock('html2pdf.js', () => ({ __esModule: true, default: () => ({ from: () => ({ save: () => {} }) }) }));

const { cpPantoneFamily, cpEffectiveFamilies, cpEffectiveColors, cpTeamTheme, CP_HEX } = require('../CoachPortal');

describe('cpPantoneFamily — Pantone entry → catalog color family', () => {
  test('color name wins over a mis-stored hex (1815 Cardinal saved as grey)', () => {
    expect(cpPantoneFamily({ code: '1815 Cardinal', hex: '#cccccc' })).toBe('Cardinal');
  });
  test('named inks resolve directly', () => {
    expect(cpPantoneFamily({ code: 'White', hex: '#FFFFFF' })).toBe('White');
    expect(cpPantoneFamily({ code: 'Black', hex: '#2D2926' })).toBe('Black');
  });
  test('numeric code falls to the nearest family by canonical Pantone hex', () => {
    // PMS 458 (#DCCA6A) is nearest to the Gold family.
    expect(cpPantoneFamily({ code: '458', hex: '#DCCA6A' })).toBe('Gold');
  });
  test('unresolvable entry returns null', () => {
    expect(cpPantoneFamily({ code: 'not-a-color', hex: 'nope' })).toBeNull();
    expect(cpPantoneFamily(null)).toBeNull();
  });
});

describe('cpEffectiveFamilies — school_colors else derived from Pantones', () => {
  test('the explicit family picker wins when present', () => {
    const cust = { school_colors: ['Navy', 'Orange'], pantone_colors: [{ code: '458' }] };
    expect(cpEffectiveFamilies(cust)).toEqual(['Navy', 'Orange']);
  });
  test('derives (deduped) families from pantone_colors when school_colors is empty', () => {
    const cust = {
      school_colors: null,
      pantone_colors: [
        { hex: '#DCCA6A', code: '458' },
        { hex: '#FFFFFF', code: 'White' },
        { hex: '#2D2926', code: 'Black' },
        { hex: '#cccccc', code: '1815 Cardinal' },
      ],
    };
    expect(cpEffectiveFamilies(cust)).toEqual(['Gold', 'White', 'Black', 'Cardinal']);
  });
  test('no colors anywhere → empty', () => {
    expect(cpEffectiveFamilies({})).toEqual([]);
  });
});

describe('cpTeamTheme — San Juan Missions themes from its Pantones', () => {
  const sanJuan = {
    school_colors: null,
    pantone_colors: [
      { hex: '#DCCA6A', code: '458' },
      { hex: '#FFFFFF', code: 'White' },
      { hex: '#2D2926', code: 'Black' },
      { hex: '#cccccc', code: '1815 Cardinal' },
    ],
  };
  test('primary is the REAL PMS 1815 cardinal, recovered from the code despite a grey saved hex', () => {
    // The saved hex is a #cccccc placeholder, but the code "1815 Cardinal" still
    // resolves to the true PMS 1815 (#8C1018) — so the portal wears the real
    // Pantone, not the placeholder and not the navy/red default.
    expect(cpTeamTheme(sanJuan, null).primary).toBe('#8C1018');
  });
  test('accent is the team\'s REAL Pantone gold (#DCCA6A), not the generic Gold swatch', () => {
    // PMS 458 is a trustworthy hex (nearest family === Gold), so the portal wears
    // the actual Pantone rather than flattening it to CP_HEX.Gold.
    expect(cpTeamTheme(sanJuan, null).accent).toBe('#DCCA6A');
  });
  test('a truly color-less customer still gets the NSA default', () => {
    const theme = cpTeamTheme({}, null);
    expect(theme.primary).toBe('#1e3a5f');
  });
});

describe('cpEffectiveColors / cpTeamTheme — real Pantone hex vs curated swatch', () => {
  // Concordia University Athletics: rich forest green PMS 357 + gold PMS 1235.
  // The bug: these flattened to the washed-out CP_HEX.Green (#15803D) / Yellow.
  const concordia = {
    school_colors: null,
    pantone_colors: [
      { hex: '#215732', code: '357' },
      { hex: '#FFC72C', code: '1235' },
      { hex: '#FFFFFF', code: 'White' },
      { hex: '#A7A8AA', code: 'Cool Gray 6' },
    ],
  };
  test('paints the actual rich Pantone green/gold, not the generic family swatches', () => {
    const theme = cpTeamTheme(concordia, null);
    expect(theme.primary).toBe('#215732');
    expect(theme.primary).not.toBe(CP_HEX.Green);
    expect(theme.accent).toBe('#FFC72C');
  });
  test('swatch hexes are the real Pantones', () => {
    expect(cpEffectiveColors(concordia).map((c) => c.hex)).toEqual(['#215732', '#FFC72C', '#FFFFFF', '#A7A8AA']);
  });
  test('a trustworthy hex passes through; an off-family saved hex falls back to the curated swatch', () => {
    const cust = {
      school_colors: null,
      pantone_colors: [
        { hex: '#215732', code: '357' },                          // trustworthy → real hex
        { code: 'zzz-unknown', name: 'Cardinal', hex: '#cccccc' },// name-resolved, hex is grey, code unresolvable → curated
      ],
    };
    const byFam = Object.fromEntries(cpEffectiveColors(cust).map((c) => [c.family, c.hex]));
    expect(byFam.Green).toBe('#215732');
    expect(byFam.Cardinal).toBe(CP_HEX.Cardinal);
  });
  test('explicit school_colors use the curated swatches (no per-color hex to honor)', () => {
    expect(cpEffectiveColors({ school_colors: ['Navy', 'Gold'] })).toEqual([
      { family: 'Navy', hex: CP_HEX.Navy },
      { family: 'Gold', hex: CP_HEX.Gold },
    ]);
  });
});
