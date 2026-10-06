import {
  DEFAULT_WEBSTORE_DELIVERY_WINDOW,
  WEBSTORE_DELIVERY_WINDOWS,
  deliveryWindowLabel,
  estimatedDeliveryDate,
  estimatedDeliveryRangeLabel,
  normalizeDeliveryWindow,
  salesOrderDueDate,
  storeShippingPromise,
} from '../lib/webstoreDeliveryWindow';

describe('webstore delivery window', () => {
  test('offers staff-selectable windows including exactly two weeks with week labels', () => {
    expect(WEBSTORE_DELIVERY_WINDOWS).toEqual([
      { value: '2-2', label: '2 weeks' },
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

test('exact two-week option preserves regular default and close-relative due date', () => {
  expect(normalizeDeliveryWindow('2-2')).toBe('2-2');
  expect(deliveryWindowLabel('2-2')).toBe('2 weeks');
  expect(normalizeDeliveryWindow(undefined)).toBe('4-5');
  expect(salesOrderDueDate('2026-10-06T23:59:00-07:00', '2-2')).toBe('2026-10-20');
});

test('24/7 promises default to two weeks from payment and honor overrides', () => {
  expect(storeShippingPromise({ org_type: 'all_school' })).toMatch(/2 weeks after payment/);
  expect(storeShippingPromise({ org_type: 'all_school', all_school_settings: { target_ship_days: 21 } })).toMatch(/3 weeks after payment/);
  expect(storeShippingPromise({ org_type: 'team' })).toMatch(/4–5 weeks after the store closes/);
});
