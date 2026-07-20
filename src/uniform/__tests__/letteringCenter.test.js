import { drawAthleticText, measureAthleticText } from '../lettering';

function contextWithInkBounds({ width = 100, left = 30, right = 60 } = {}) {
  return {
    font: '', textAlign: 'start', textBaseline: 'alphabetic', lineJoin: 'miter',
    measureText: jest.fn(() => ({
      width, actualBoundingBoxLeft: left, actualBoundingBoxRight: right,
      actualBoundingBoxAscent: 80, actualBoundingBoxDescent: 20,
    })),
    fillText: jest.fn(), strokeText: jest.fn(),
  };
}

describe('athletic lettering visual centering', () => {
  test('centers the visible ink instead of the font advance box', () => {
    const ctx = contextWithInkBounds();
    drawAthleticText(ctx, { value: '15', font: 'anton', size: 100, fill: '#fff', x: 200, y: 300 });
    // Ink spans -30..+60 around the nominal canvas alignment point, so its
    // visible center is 15px right and the draw origin must shift 15px left.
    expect(ctx.fillText).toHaveBeenCalledWith('15', 185, 300);
  });

  test('reports no optical shift for symmetric glyph bounds', () => {
    const ctx = contextWithInkBounds({ width: 100, left: 50, right: 50 });
    const measured = measureAthleticText(ctx, { value: '88', font: 'anton', size: 100 });
    expect(measured.visualOffsetX).toBe(0);
    expect(measured.inkWidth).toBe(100);
  });
});
