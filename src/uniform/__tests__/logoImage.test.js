import { visibleAlphaBounds } from '../logoImage';

describe('transparent logo trimming', () => {
  test('measures only visible PNG pixels', () => {
    const width = 6, height = 5;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 1; y <= 3; y++) {
      for (let x = 2; x <= 4; x++) pixels[(y * width + x) * 4 + 3] = 255;
    }

    expect(visibleAlphaBounds(pixels, width, height)).toEqual({ x: 2, y: 1, width: 3, height: 3 });
  });

  test('returns null for a fully transparent image', () => {
    expect(visibleAlphaBounds(new Uint8ClampedArray(4 * 4 * 4), 4, 4)).toBeNull();
  });
});
