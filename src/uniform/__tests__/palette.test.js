import { DEFAULT_PALETTE } from '../builderSettings';
import * as ds from '../designSpec';

describe('uniform builder palette', () => {
  test('keeps requested uniform shades available as distinct named colors', () => {
    const colors = Object.fromEntries(DEFAULT_PALETTE.map((color) => [color.name, color.hex]));

    expect(colors).toMatchObject({
      'Light Grey': '#C0C0C0',
      'Dark Grey': '#4A4A4A',
      'Vegas Gold': '#C5B358',
      Orange: '#F47A1F',
      'Burnt Orange': '#BF5700',
    });
    expect(colors.Orange).not.toBe(colors['Burnt Orange']);
  });

  test('resolves the new names for production specs and AI design input', () => {
    expect(ds.toHex('light gray')).toBe('#c0c0c0');
    expect(ds.toHex('dark grey')).toBe('#4a4a4a');
    expect(ds.toHex('vegas gold')).toBe('#c5b358');
    expect(ds.toHex('orange')).toBe('#f47a1f');
    expect(ds.toHex('burnt orange')).toBe('#bf5700');
  });
});
