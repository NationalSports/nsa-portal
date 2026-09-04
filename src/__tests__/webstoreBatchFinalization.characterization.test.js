/**
 * Characterization guard for the webstore batch money boundary.  Production,
 * customer-order ownership, A/R, Stripe settlement, and fundraising must cross
 * the database together; putting any of those back into an unawaited UI write
 * reopens the browser-close loss window this migration fixed.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('atomic webstore batch finalization', () => {
  const migration = read('supabase/migrations/20260902070000_atomic_webstore_batch_finalization.sql');
  const app = read('src/App.js');
  const webstores = read('src/Webstores.js');

  test('server transaction owns the order claim and every accounting row', () => {
    expect(migration).toContain('update public.webstore_orders');
    expect(migration).toContain('insert into public.invoices');
    expect(migration).toContain('insert into public.invoice_payments');
    expect(migration).toContain('insert into public.customer_credits');
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('webstore_batch:' || p_so_id))");
  });

  test('RPC is staff scoped and rejects partial or competing claims', () => {
    expect(migration).toContain('if not public.is_team_member()');
    expect(migration).toContain('v_eligible <> v_expected');
    expect(migration).toContain("'reason', 'order_claim_changed'");
    expect(migration).toContain('revoke all on function public.finalize_webstore_batch(text, uuid[]) from anon');
    expect(migration).toContain('grant execute on function public.finalize_webstore_batch(text, uuid[]) to authenticated');
  });

  test('batch UI waits for the server finalizer and no longer links orders separately', () => {
    expect(app).toContain("await supabase.rpc('finalize_webstore_batch'");
    expect(app).toContain('p_order_ids:Array.isArray(order_ids)?order_ids:[]');
    expect(webstores).toContain('order_ids: [...selIds]');
    expect(webstores).not.toContain("supabase.from('webstore_orders').update({ so_id: soId, status: 'batched' })");
  });

  test('manual settlement repair awaits durable invoice persistence', () => {
    expect(app).toContain('const createAndSettleWebstoreInvoice=async(so,settle)=>');
    expect(app).toContain('const ok=await _dbSaveInvoice(inv)');
    expect(app).toContain('finally{webstoreInvoiceCreating.current.delete(so.id)}');
  });
});
