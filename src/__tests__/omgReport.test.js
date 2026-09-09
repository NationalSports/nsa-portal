import { normalizeOmgSize } from '../lib/omgReport';

describe('normalizeOmgSize', () => {
  test('accepts numeric sizes from OMG report rows', () => {
    expect(normalizeOmgSize(8)).toBe('8');
    expect(normalizeOmgSize(10.5)).toBe('10.5');
  });

  test('preserves existing text cleanup and one-size fallback', () => {
    expect(normalizeOmgSize(' 2XL" ')).toBe('2XL');
    expect(normalizeOmgSize(null)).toBe('OS');
    expect(normalizeOmgSize('')).toBe('OS');
    expect(normalizeOmgSize(0)).toBe('0');
  });
});
