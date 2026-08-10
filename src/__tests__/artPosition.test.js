import { POSITIONS, OTHER_POS, artPosView } from '../pricing';

// The art location picker lets a rep pick "Other" and type a one-off placement ("Under bill").
// The typed text IS the stored position so work orders/tickets print it as-is; position_custom
// only tells the picker to reopen the box. These lock the two ways that can go wrong: a typed
// location that stops showing its box, and a legacy off-list placement mistaken for a typed one.
describe('art location picker', () => {
  test('a listed placement shows the dropdown only', () => {
    const v = artPosView('Left Chest', false);
    expect(v.showBox).toBe(false);
    expect(v.selectValue).toBe('Left Chest');
  });

  test('picking Other opens an empty box', () => {
    const v = artPosView(OTHER_POS, true);
    expect(v.showBox).toBe(true);
    expect(v.selectValue).toBe(OTHER_POS);
    expect(v.boxValue).toBe('');
  });

  test('a typed placement keeps its box, and the box holds the text', () => {
    const v = artPosView('Under bill', true);
    expect(v.showBox).toBe(true);
    expect(v.selectValue).toBe(OTHER_POS);
    expect(v.boxValue).toBe('Under bill');
  });

  test('a placement that predates the list is not mistaken for a typed one', () => {
    // 'Front Center' is the factory default on split art and team shop conversions but has never
    // been in POSITIONS — it must keep reading as itself, not flip every old row into Other.
    expect(POSITIONS).not.toContain('Front Center');
    const v = artPosView('Front Center', undefined);
    expect(v.showBox).toBe(false);
    expect(v.selectValue).toBe('Front Center');
    expect(v.options).toContain('Front Center');
  });

  test('Other is always offered, even if Settings drops it from the list', () => {
    const saved = [...POSITIONS];
    try {
      POSITIONS.length = 0;
      POSITIONS.push('Front', 'Back');
      expect(artPosView('Front', false).options).toContain(OTHER_POS);
    } finally {
      POSITIONS.length = 0;
      POSITIONS.push(...saved);
    }
  });
});
