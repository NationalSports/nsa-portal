import {
  completedJobInvoiceExplanation,
  getOrderInvoiceCoverage,
  hasResponsePoForPull,
  isOrderFullyInvoiced,
  isFreshNotificationDate,
  pickSkuChanged,
  picksForCurrentSku,
  pulledItemsHaveMovedInLine,
  shouldShowCompletedJobNotice,
} from './dashboardNotificationRules';

describe('dashboard notification lifecycle rules', () => {
  const so = { id: 'SO-1', items: [{ sku: 'SKU-1', color: 'Blue', sizes: { M: 10 } }] };
  const fullInvoice = { so_id: 'SO-1', status: 'open', line_items: [{ qty: 10, _sku: 'SKU-1', _color: 'Blue' }] };
  const partialInvoice = { so_id: 'SO-1', status: 'open', line_items: [{ qty: 5, _sku: 'SKU-1', _color: 'Blue' }] };

  test('fully invoiced orders clear completed and shipped job notices', () => {
    expect(shouldShowCompletedJobNotice({ prod_status: 'completed' }, so, [])).toBe(true);
    expect(shouldShowCompletedJobNotice({ prod_status: 'shipped' }, so, [])).toBe(true);
    expect(shouldShowCompletedJobNotice({ prod_status: 'completed' }, so, [fullInvoice])).toBe(false);
    expect(shouldShowCompletedJobNotice({ prod_status: 'shipped' }, so, [fullInvoice])).toBe(false);
  });

  test('partial, deposit, void, and deleted invoices do not clear the notice', () => {
    expect(isOrderFullyInvoiced(so, [partialInvoice])).toBe(false);
    expect(isOrderFullyInvoiced(so, [{ ...fullInvoice, inv_type: 'deposit' }])).toBe(false);
    expect(isOrderFullyInvoiced(so, [{ ...fullInvoice, status: 'void' }])).toBe(false);
    expect(isOrderFullyInvoiced(so, [{ ...fullInvoice, deleted_at: '2026-08-25' }])).toBe(false);
    expect(shouldShowCompletedJobNotice({ prod_status: 'completed' }, so, [partialInvoice])).toBe(true);
  });

  test('explains why a completed job notification is still visible', () => {
    expect(getOrderInvoiceCoverage(so, [partialInvoice])).toEqual({ ordered: 10, invoiced: 5, remaining: 5 });
    expect(completedJobInvoiceExplanation(so, [])).toBe('Not invoiced: 10 units');
    expect(completedJobInvoiceExplanation(so, [partialInvoice])).toBe('Partially invoiced: 5 of 10 units');
    expect(completedJobInvoiceExplanation(so, [fullInvoice])).toBe('Fully invoiced — notification will be removed');
    expect(completedJobInvoiceExplanation(so, [{ ...fullInvoice, inv_type: 'deposit' }])).toBe('Not invoiced: 10 units');
  });

  test('promo jobs remain until shipped without requiring an invoice', () => {
    const promo = { ...so, promo_applied: true };
    expect(shouldShowCompletedJobNotice({ prod_status: 'completed' }, promo, [])).toBe(true);
    expect(shouldShowCompletedJobNotice({ prod_status: 'shipped' }, promo, [])).toBe(false);
    expect(completedJobInvoiceExplanation(promo, [])).toBe('Promo order — remains until shipped');
  });

  test('pulled IF clears only when all related jobs have moved in line', () => {
    const jobs = [
      { prod_status: 'staging', items: [{ item_idx: 0 }] },
      { prod_status: 'hold', items: [{ item_idx: 1 }] },
    ];
    expect(pulledItemsHaveMovedInLine(jobs, new Set([0]))).toBe(true);
    expect(pulledItemsHaveMovedInLine(jobs, new Set([0, 1]))).toBe(false);
    jobs[1].prod_status = 'in_process';
    expect(pulledItemsHaveMovedInLine(jobs, new Set([0, 1]))).toBe(true);
  });

  test('short-pull SKU snapshot detects a replacement SKU', () => {
    expect(pickSkuChanged({ sku: 'NEW-SKU' }, [{ _sku: 'OLD-SKU', status: 'pulled' }])).toBe(true);
    expect(pickSkuChanged({ sku: 'SAME-SKU' }, [{ _sku: 'SAME-SKU', status: 'pulled' }])).toBe(false);
  });

  test('a later IF for a replacement SKU can raise its own shortage', () => {
    const picks = [
      { _sku: 'OLD-SKU', status: 'pulled', pulled_at: '8/20/2026', M: 1 },
      { _sku: 'NEW-SKU', status: 'pulled', pulled_at: '8/25/2026', M: 1 },
    ];
    expect(picksForCurrentSku({ sku: 'NEW-SKU' }, picks)).toEqual([picks[1]]);
    expect(pickSkuChanged({ sku: 'NEW-SKU' }, picks)).toBe(false);
  });

  test('only a PO created in response to the pull clears the short alert', () => {
    const picks = [{ pulled_at: '8/25/2026, 12:44:00 PM' }];
    expect(hasResponsePoForPull(picks, [{ po_id: 'PO-old', created_at: '8/20/2026' }])).toBe(false);
    expect(hasResponsePoForPull(picks, [{ po_id: 'PO-new', created_at: '8/25/2026' }])).toBe(true);
    expect(hasResponsePoForPull(picks, [{ po_id: 'PO-imported', created_at: '8/25/2026', preexisting: true }])).toBe(true);
  });

  test('paid invoice notification expires at exactly seven days', () => {
    const paidAt = new Date('2026-08-18T12:00:00Z');
    expect(isFreshNotificationDate(paidAt, new Date('2026-08-25T11:59:59Z'))).toBe(true);
    expect(isFreshNotificationDate(paidAt, new Date('2026-08-25T12:00:00Z'))).toBe(false);
  });
});
