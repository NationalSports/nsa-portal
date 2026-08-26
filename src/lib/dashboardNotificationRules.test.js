import {
  hasInvoiceForOrder,
  hasResponsePoForPull,
  isFreshNotificationDate,
  pickSkuChanged,
  pulledItemsHaveMovedInLine,
  shouldShowCompletedJobNotice,
} from './dashboardNotificationRules';

describe('dashboard notification lifecycle rules', () => {
  test('completed job remains until it is both shipped and invoiced', () => {
    const so = { id: 'SO-1' };
    expect(shouldShowCompletedJobNotice({ prod_status: 'completed' }, so, [])).toBe(true);
    expect(shouldShowCompletedJobNotice({ prod_status: 'shipped' }, so, [])).toBe(true);
    expect(shouldShowCompletedJobNotice({ prod_status: 'shipped' }, so, [{ so_id: 'SO-1', status: 'open' }])).toBe(false);
  });

  test('void and deleted invoices do not clear a completed job notice', () => {
    expect(hasInvoiceForOrder([{ so_id: 'SO-1', status: 'void' }], 'SO-1')).toBe(false);
    expect(hasInvoiceForOrder([{ so_id: 'SO-1', status: 'open', deleted_at: '2026-08-25' }], 'SO-1')).toBe(false);
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
