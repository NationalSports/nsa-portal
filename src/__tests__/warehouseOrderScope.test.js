import { hasOpenItemFulfillment } from '../safeHelpers';

describe('warehouse order scope', () => {
  test('recognizes an open IF on a completed/invoiced SO', () => {
    const so = {
      status: 'complete',
      items: [{ pick_lines: [{ pick_id: 'IF-1148', status: 'pick', S: 1 }] }],
    };

    expect(hasOpenItemFulfillment(so)).toBe(true);
  });

  test('does not treat an already-pulled IF as open', () => {
    const so = {
      status: 'complete',
      items: [{ pick_lines: [{ pick_id: 'IF-1148', status: 'pulled', S: 1 }] }],
    };

    expect(hasOpenItemFulfillment(so)).toBe(false);
  });
});
