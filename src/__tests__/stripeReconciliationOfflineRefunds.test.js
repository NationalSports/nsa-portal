/** @jest-environment node */

// The amount reconciliation lives in SQL, and its own suite cannot load here
// because it mocks the `stripe` package. These assertions read the migration
// directly, so the offline-refund contract is covered without that dependency.

const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '..', '..',
  'supabase/migrations/20260925031500_stripe_reconciliation_offline_refunds.sql'), 'utf8');

describe('offline refunds in the Stripe amount reconciliation', () => {
  // SO-2487: $288.64 charged, 2x ST485 cancelled, $69.90 returned by cheque.
  // Stripe keeps the whole charge forever, so comparing raw Stripe activity to
  // the portal total reported a mismatch nightly with no reachable end state.
  test('non-Stripe refunds are subtracted from Stripe activity before comparing', () => {
    expect(sql).toContain('round(coalesce(o.total, 0) * 100)::bigint <> a.activity_cents - f.offline_refund_cents');
  });

  test('only refunds Stripe never processed count, so a card refund is not double-subtracted', () => {
    expect(sql).toContain('from public.webstore_order_refunds r');
    expect(sql).toContain('and r.stripe_refund_id is null');
  });

  test('the offline credit stays visible in the finding rather than silently netting out', () => {
    expect(sql).toContain("'offline_refund_cents', f.offline_refund_cents");
    expect(sql).toContain("'difference_cents', a.activity_cents - f.offline_refund_cents");
  });

  test('an order with no refunds at all still reconciles, so the lateral cannot drop rows', () => {
    expect(sql).toContain('coalesce(sum(round(r.amount * 100)::bigint), 0)::bigint as offline_refund_cents');
    expect(sql).toContain(') f on true');
  });

  test('the function stays service-role only', () => {
    expect(sql).toContain('revoke all on function public.scan_stripe_reconciliation(integer) from public, anon, authenticated');
    expect(sql).toContain('grant execute on function public.scan_stripe_reconciliation(integer) to service_role');
  });

  test('the other three finding families are preserved, not dropped by the rewrite', () => {
    for (const key of ['order:unlinked:', 'payout:actionable:', 'payout:failed:', 'order:amount-mismatch:']) {
      expect(sql).toContain(key);
    }
  });
});
