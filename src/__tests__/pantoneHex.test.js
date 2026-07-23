/* eslint-disable */
/**
 * Regression tests for pantoneHex() color-name resolution.
 *
 * Bug: PANTONE_MAP stores named colors in display casing ('Black', 'Reflex Blue'),
 * but pantoneHex() upper-cased the input before lookup, so named inks like "Black"
 * and "White" never matched and rendered as a blank swatch in the Color Ways editor.
 * Numeric Pantone codes were unaffected (digits have no case).
 *
 * SAFE: pure function from constants.js — no Supabase, no UI, no network.
 */

const { pantoneHex } = require('../constants');

describe('pantoneHex — named color resolution (case-insensitive)', () => {
  test('resolves named colors regardless of input casing', () => {
    expect(pantoneHex('Black')).toBe('#2D2926');
    expect(pantoneHex('black')).toBe('#2D2926');
    expect(pantoneHex('BLACK')).toBe('#2D2926');
    expect(pantoneHex('White')).toBe('#FFFFFF');
    expect(pantoneHex('white')).toBe('#FFFFFF');
  });

  test('resolves multi-word named colors', () => {
    expect(pantoneHex('Reflex Blue')).toBe('#001489');
    expect(pantoneHex('reflex blue')).toBe('#001489');
    expect(pantoneHex('Process Blue')).toBe('#0085CA');
    // tolerant of extra/irregular whitespace
    expect(pantoneHex('  reflex   blue  ')).toBe('#001489');
  });

  test('numeric Pantone codes still resolve (with and without PMS/suffix)', () => {
    expect(pantoneHex('186')).toBe('#CE0037');
    expect(pantoneHex('PMS 186 C')).toBe('#CE0037');
    expect(pantoneHex('pantone 186 u')).toBe('#CE0037');
    expect(pantoneHex('485')).toBe('#DA291C');
  });

  test('resolves combined "number + name" codes to the exact Pantone ink', () => {
    // Colors saved from the "School Colors (Pantone)" card as a combined string;
    // previously these fell through to a placeholder grey.
    expect(pantoneHex('1815 Cardinal')).toBe('#8C1018');
    expect(pantoneHex('1235 Gold')).toBe('#FFC72C');
    expect(pantoneHex('2768 Navy')).toBe('#071D49');
  });

  test('resolves bare / unnumbered family names via threadHex', () => {
    expect(pantoneHex('Maroon')).toBe('#800000');
    expect(pantoneHex('Vegas Gold')).toBe('#C5B358');
    // number not in the Pantone map, but the trailing name still resolves
    expect(pantoneHex('2171 Light Blue')).toBe('#ADD8E6');
  });

  test('returns null for empty / unknown input', () => {
    expect(pantoneHex('')).toBeNull();
    expect(pantoneHex(null)).toBeNull();
    expect(pantoneHex(undefined)).toBeNull();
    expect(pantoneHex('not-a-color-xyz')).toBeNull();
  });
});
