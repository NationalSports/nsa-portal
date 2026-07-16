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

const { cpPantoneFamily, cpEffectiveFamilies, cpTeamTheme, CP_HEX } = require('../CoachPortal');

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
  test('primary is Cardinal, accent is Gold (not the navy/red default)', () => {
    const theme = cpTeamTheme(sanJuan, null);
    expect(theme.primary).toBe(CP_HEX.Cardinal);
    expect(theme.accent).toBe(CP_HEX.Gold);
  });
  test('a truly color-less customer still gets the NSA default', () => {
    const theme = cpTeamTheme({}, null);
    expect(theme.primary).toBe('#1e3a5f');
  });
});
