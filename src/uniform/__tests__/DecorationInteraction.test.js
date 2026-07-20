import { shouldStartDecorationDrag } from '../decorationInteraction';

describe('decoration movement safeguard', () => {
  test('the first pointer interaction only selects an unselected decoration', () => {
    expect(shouldStartDecorationDrag('', 'backNumber')).toBe(false);
    expect(shouldStartDecorationDrag('frontNumber', 'backNumber')).toBe(false);
  });

  test('a subsequent interaction can drag the already-selected decoration', () => {
    expect(shouldStartDecorationDrag('backNumber', 'backNumber')).toBe(true);
  });
});
