import {
  DEFAULT_WEBSTORE_DELIVERY_WINDOW,
  WEBSTORE_DELIVERY_WINDOWS,
  deliveryWindowLabel,
  estimatedDeliveryDate,
  estimatedDeliveryRangeLabel,
  normalizeDeliveryWindow,
  salesOrderDueDate,
} from '../lib/webstoreDeliveryWindow';

describe('webstore delivery window', () => {
  test('offers exactly the four staff-selectable windows with week labels', () => {
    expect(WEBSTORE_DELIVERY_WINDOWS).toEqual([
      { value: '2-3', label: '2–3 weeks' },
      { value: '3-4', label: '3–4 weeks' },
      { value: '4-5', label: '4–5 weeks' },
      { value: '5-6', label: '5–6 weeks' },
    ]);
  });

  test('defaults missing and invalid legacy values to 4–5 weeks', () => {
    expect(normalizeDeliveryWindow()).toBe(DEFAULT_WEBSTORE_DELIVERY_WINDOW);
    expect(normalizeDeliveryWindow('custom')).toBe('4-5');
    expect(deliveryWindowLabel()).toBe('4–5 weeks');
  });

  test('uses the conservative end of the selected range for an estimated date', () => {
    expect(estimatedDeliveryDate('2026-09-13T23:59:00-07:00', '5-6').toISOString())
      .toBe('2026-10-26T06:59:00.000Z');
  });

  test('sets the SO due date from the Pacific close date and selected upper bound', () => {
    expect(salesOrderDueDate('2026-09-13T23:59:00-07:00', '2-3')).toBe('2026-10-04');
    expect(salesOrderDueDate('2026-09-13T23:59:00-07:00', '5-6')).toBe('2026-10-25');
    expect(salesOrderDueDate(null, '4-5')).toBe('');
  });

  test('translates the selected window into a parent-friendly calendar ETA', () => {
    const closes = '2026-09-13T23:59:00-07:00';
    expect(estimatedDeliveryRangeLabel(closes, '5-6')).toBe('mid to late Oct');
    expect(estimatedDeliveryRangeLabel(closes, '4-5')).toBe('mid Oct');
    expect(estimatedDeliveryRangeLabel(closes, '2-3')).toBe('late Sep to early Oct');
    expect(estimatedDeliveryRangeLabel(null, '5-6')).toBe('');
  });
});
