/**
 * Webstore batch checkout money on the Sales Order and its invoice.
 *
 * The batch SO used to bill garments only: sales tax, the processing fee buyers
 * paid, shipping charged at checkout and the Stripe card fees NSA was charged
 * lived only in the store's Analytics tab, so the invoice said "$4,485 paid"
 * while Stripe deposited $5,056 less fees. These guards pin the money model:
 *   - the server finalizer derives the money from the locked orders, bills tax /
 *     shipping / processing on the invoice, and writes it onto the SO;
 *   - the SO editors show it, with tax on the total but never in margin;
 *   - commissions see processing fee revenue against Stripe card-fee cost;
 *   - SO lines are split per collected unit price so qty × rate is exact.
 */

const fs = require('fs');
const path = require('path');
const { webstoreCheckoutMoney, webstoreDocMoneyRows, isWebstoreBatchSO } = require('../lib/webstoreSoMoney');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('lib/webstoreSoMoney', () => {
  const so = { source: 'webstore', _omg_processing: '224.25', _omg_tax: 347.59, _omg_shipping: 0, _omg_cc_fees: 151.74 };

  test('only webstore-batch SOs carry checkout money; OMG and portal SOs read as zero', () => {
    expect(isWebstoreBatchSO(so)).toBe(true);
    expect(webstoreCheckoutMoney(so)).toEqual({ isWebstore: true, processing: 224.25, tax: 347.59, shipping: 0, ccFees: 151.74 });
    expect(webstoreCheckoutMoney({ ...so, source: 'portal' })).toEqual({ isWebstore: false, processing: 0, tax: 0, shipping: 0, ccFees: 0 });
    expect(webstoreCheckoutMoney({ ...so, omg_store_id: 'OMG-1', source: undefined })).toEqual({ isWebstore: false, processing: 0, tax: 0, shipping: 0, ccFees: 0 });
    expect(webstoreCheckoutMoney(null).isWebstore).toBe(false);
  });

  test('document rows list only the non-zero amounts and add up to the total the buyers paid beyond product', () => {
    const fmt = (n) => '$' + n.toFixed(2);
    const doc = webstoreDocMoneyRows(so, fmt);
    expect(doc.rows.map((r) => r.cells[3].value)).toEqual(['<strong>Online processing fee</strong>', '<strong>Sales tax (collected at checkout)</strong>']);
    expect(doc.rows.map((r) => r.cells[4].value)).toEqual(['$224.25', '$347.59']);
    expect(doc.extra).toBe(571.84);
    // 4,485.00 product + 571.84 = 5,056.84 — what SO-2487's cards were charged.
    expect(Math.round((4485 + doc.extra) * 100) / 100).toBe(5056.84);
    expect(webstoreDocMoneyRows({ source: 'portal', _omg_tax: 50 }, fmt)).toEqual({ rows: [], extra: 0 });
  });
});

describe('finalize_webstore_batch bills checkout money and writes it onto the SO', () => {
  const migration = read('supabase/migrations/20260914120000_webstore_batch_invoice_tax_and_fees.sql');

  test('money is derived from the locked orders, never the client', () => {
    expect(migration).toContain("coalesce(round(sum(greatest(coalesce(o.tax, 0), 0)), 2), 0)");
    expect(migration).toContain("coalesce(round(sum(greatest(coalesce(o.processing_fee, 0), 0)), 2), 0)");
    expect(migration).toContain("coalesce(round(sum(greatest(coalesce(o.shipping_fee, 0), 0)), 2), 0)");
    expect(migration).toContain("coalesce(round(sum(greatest(coalesce(o.cc_fee, 0), 0)) filter (where o.payment_mode = 'paid'), 2), 0)");
    expect(migration).toMatch(/update public\.sales_orders\s+set _omg_processing = v_processing,\s+_omg_tax = v_tax,\s+_omg_shipping = v_shipping,\s+_omg_cc_fees = v_cc_fees\s+where id = p_so_id;/);
  });

  test('invoice total = product lines + processing + shipping + tax, with tax and shipping in their own columns', () => {
    expect(migration).toContain('v_inv_total := round(v_items_total + v_processing + v_shipping + v_tax, 2);');
    expect(migration).toContain("'Online processing fee (charged at checkout)'");
    expect(migration).toContain('v_tax, 0, (v_tax <= 0), v_shipping, v_line_items, now(), now()');
    // Card funds cover everything the team tab does not owe, capped at what the cards paid.
    expect(migration).toContain('v_applied := round(least(greatest(v_inv_total - v_tab_total, 0), greatest(v_card_total, 0)), 2);');
    // Stripe's cost is an SO cost, not a payment surcharge.
    expect(migration).toMatch(/values \(v_inv_id, v_applied, 'store', 'WEB ' \|\| p_so_id, to_char\(now\(\), 'MM\/DD\/YYYY'\), 0\)/);
  });

  test('cents-level line averaging drift is absorbed, larger gaps are left visible', () => {
    expect(migration).toContain('v_rounding := round(v_garment_net - v_items_total, 2);');
    expect(migration).toContain('abs(v_rounding) >= 0.005 and abs(v_rounding) <= 1.00');
  });

  test('the same locking, claim validation, grants and idempotency as the original finalizer', () => {
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('webstore_batch:' || p_so_id))");
    expect(migration).toContain('v_eligible <> v_expected');
    expect(migration).toContain("'reason', 'order_claim_changed'");
    expect(migration).toContain("where i.so_id = p_so_id or i.idempotency_key = 'webstore:' || p_so_id");
    expect(migration).toContain('revoke all on function public.finalize_webstore_batch(text, uuid[]) from anon');
    expect(migration).toContain('grant execute on function public.finalize_webstore_batch(text, uuid[]) to authenticated');
    expect(migration).toContain("'store_money', jsonb_build_object(");
  });
});

describe('client side of the batch', () => {
  const app = read('src/App.js');
  const webstores = read('src/Webstores.js');
  const commissions = read('src/CommissionsPage.js');

  test('the SO opened after a batch carries the server-derived money', () => {
    expect(app).toContain('const _sm=finalized.store_money;');
    expect(app).toContain('_omg_processing:Number(_sm.processing)||0,_omg_tax:Number(_sm.tax)||0,_omg_shipping:Number(_sm.shipping)||0,_omg_cc_fees:Number(_sm.cc_fees)||0');
  });

  test('SO lines are split per collected unit price so qty × rate is exact', () => {
    expect(webstores).toContain("const unitCollected = r2(collectedForLine(i) / q);");
    expect(webstores).toContain("}) + '§$' + unitCollected.toFixed(2);");
  });

  test('commissions count processing fee revenue against Stripe card-fee cost, and shipping charged at checkout', () => {
    expect(commissions).toContain("import { webstoreCheckoutMoney } from './lib/webstoreSoMoney';");
    expect(commissions).toContain('const totalRev=rev+shipRev+storeProcRev+storeShipRev;const totalCost=cost+shipCost+inboundFreight+storeCardCost;');
  });
});

describe('classic and new order editors carry the identical webstore money logic', () => {
  const classic = read('src/OrderEditorClassic.js');
  const modern = read('src/OrderEditor.js');
  // Sorted: the print and email builders sit in a different order in the two files.
  const linesWith = (src, re) => src.split('\n').filter((l) => re.test(l)).map((l) => l.trim()).sort();

  test('header totals: tax on the grand total, never in rev/margin; shipping charged joins ship', () => {
    const re = /_wm\.isWebstore|storeTax|_wm\.shipping|webstoreCheckoutMoney\(o\)/;
    const a = linesWith(modern, re), b = linesWith(classic, re);
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(a).toEqual(b);
    expect(a.join('\n')).toContain('grand:rev+ship+priorShip+tax+storeTax');
    expect(a.join('\n')).toContain('margin:marginRev-cost');
  });

  test('print and email PDFs add the checkout rows and total in both editors', () => {
    const re = /_wmDoc/;
    const a = linesWith(modern, re), b = linesWith(classic, re);
    expect(a.filter((l) => l.startsWith('const _wmDoc=webstoreDocMoneyRows(o,_$);')).length).toBe(2);
    expect(a.filter((l) => l === '..._wmDoc.rows,').length).toBe(2);
    expect(a).toEqual(b);
  });

  test('ledger tiles and Costs tab label the webstore fees in both editors', () => {
    const re = /CARD FEES|'PROCESSING'|'SALES TAX'|_webCc/;
    expect(linesWith(modern, re)).toEqual(linesWith(classic, re));
    expect(linesWith(modern, re).length).toBe(4);
  });
});
