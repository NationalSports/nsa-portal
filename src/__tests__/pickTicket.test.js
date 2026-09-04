import { buildQrSheetInfoBoxes } from '../lib/pickTicket';

describe('IF pick ticket', () => {
  test('includes the assigned rep on the initial warehouse sheet', () => {
    expect(buildQrSheetInfoBoxes({
      title: 'New Zealand Lacrosse',
      subtitle: 'SO-2316',
      rep: 'Steve',
      shipBadge: { text: 'SHIP TO DECO — Silver Screen' },
    })).toEqual([
      { label: 'Customer / Team', value: 'New Zealand Lacrosse', sub: 'SO-2316' },
      { label: 'Rep', value: 'Steve' },
      { label: 'Ship To', value: 'SHIP TO DECO — Silver Screen' },
    ]);
  });

  test('does not print an empty rep field when an order has no assigned rep', () => {
    expect(buildQrSheetInfoBoxes({ title: 'Team', subtitle: 'SO-1' }))
      .not.toContainEqual(expect.objectContaining({ label: 'Rep' }));
  });
});
