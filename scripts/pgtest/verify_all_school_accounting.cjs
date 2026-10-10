// Isolated All School checkout-to-invoice/SO accounting integration scenarios.
// Run with @electric-sql/pglite in NODE_PATH; this never connects to Supabase.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sid = '10000000-0000-0000-0000-000000000001';
const oid = n => `30000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const iid = n => `40000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const nearMoney = (actual, expected, label) => {
  assert.ok(Math.abs(Number(actual) - expected) < 0.005,
    `${label}: expected ${expected.toFixed(2)}, got ${actual}`);
};

(async () => {
  const db = new PGlite();
  const seed = read('e2e/pipeline/seed.sql')
    .split('-- Reference / seed data')[0]
    .replace(/^\\.*$/gm, '');
  await db.exec(seed);

  // These columns are part of the hosted schema but intentionally omitted from
  // the compact repository E2E seed. Add only local fixture schema; no live DB.
  await db.exec(`
    alter table webstore_orders
      add column order_source text,
      add column tax numeric default 0,
      add column shipping_fee numeric default 0,
      add column processing_fee numeric default 0,
      add column cc_fee numeric default 0,
      add column stripe_pi_id text,
      add column tax_state text,
      add column tax_rate numeric,
      add column payment_mode text;
    alter table sales_orders
      add column _omg_processing numeric default 0,
      add column _omg_tax numeric default 0,
      add column _omg_shipping numeric default 0,
      add column _omg_cc_fees numeric default 0;
    alter table invoice_payments add column cc_fee numeric default 0;
    alter table webstore_products add column image_url text;
    create table job_stage_events(
      id bigserial, so_id text, job_id text, event text, from_state jsonb,
      to_state jsonb, actor text, source text, payload jsonb
    );
    insert into team_members(id,name,role) values('REP','Rep','rep');
    insert into customers(id,name,primary_rep_id,payment_terms) values('C','School','REP','30 days');
    insert into products(id,sku,name,brand,color,retail_price,nsa_cost)
      values('P','PC61','Tee','Port','Navy',40,5);
    insert into webstores(id,slug,name,org_type,customer_id,delivery_mode)
      values('${sid}','school','School','all_school','C','ship_home');
    set app.is_staff='true';
  `);

  await db.exec(read('supabase/migrations/20261002183605_all_school_store_foundation.sql'));
  await db.exec(read('supabase/migrations/20261002183729_all_school_order_conversion.sql'));

  // The numbering migration checks all four converter definitions. Keep the
  // real All School converter from the migrations above; the three unrelated
  // converters are minimal signature-compatible fixtures for that guard.
  await db.exec(`
    create function create_teamshop_sales_order(uuid) returns jsonb language plpgsql as $$
    declare v_num bigint;
    begin
      select greatest(coalesce(max((regexp_match(id, '(\\d+)'))[1]::bigint),0),1000)+1
        into v_num from sales_orders;
      return '{}'::jsonb;
    end $$;
    create function create_club_sales_order(uuid) returns jsonb language plpgsql as $$
    declare v_num bigint;
    begin
      select greatest(coalesce(max((regexp_match(id, '(\\d+)'))[1]::bigint),0),1000)+1
        into v_num from sales_orders;
      return '{}'::jsonb;
    end $$;
    create function convert_uniform_order_to_sales_order(uuid) returns jsonb language plpgsql as $$
    declare v_num bigint;
    begin
      select greatest(coalesce(max((regexp_match(id, '^SO-([0-9]+)$'))[1]::bigint),0),1000)+1
        into v_num from sales_orders;
      return '{}'::jsonb;
    end $$;
    create function qbo_sales_source_snapshot_without_links(timestamptz)
      returns jsonb language sql as $$
      select jsonb_build_object('tax',i.tax,'tax_rate',i.tax_rate)
      from invoices i order by i.id limit 1
    $$;
  `);

  await db.exec(read('supabase/migrations/20261008072513_all_school_method_readiness.sql'));
  await db.exec(read('supabase/migrations/20261008193918_keep_sales_order_ids_sequential.sql'));

  const migrationsDir = path.join(root, 'supabase/migrations');
  const accountingMigrations = fs.readdirSync(migrationsDir)
    .filter(name => /all_school.*accounting.*\.sql$/i.test(name))
    .sort();
  assert.equal(accountingMigrations.length, 1,
    `Expected one all_school accounting migration, found: ${accountingMigrations.join(', ') || '(none)'}`);
  await db.exec(read(path.join('supabase/migrations', accountingMigrations[0])));
  await db.exec(read(path.join('supabase/migrations', accountingMigrations[0])));

  const converterDefinition = (await db.query(
    `select pg_get_functiondef('public.create_all_school_sales_order(uuid)'::regprocedure) definition`
  )).rows[0].definition;
  assert.ok(converterDefinition.includes('all_school_method_readiness_v1'), 'readiness migration marker survives accounting patch');
  assert.ok(converterDefinition.includes("max(substring(id from 4)::bigint) filter (where id ~ '^SO-[0-9]{4,7}$')"),
    'sequential SO ID mint rule survives accounting patch');
  assert.ok(converterDefinition.includes('all_school_checkout_accounting_v1'), 'accounting migration is idempotently retained');
  const snapshotDefinition = (await db.query(
    `select pg_get_functiondef('public.qbo_sales_source_snapshot_without_links(timestamptz)'::regprocedure) definition`
  )).rows[0].definition;
  assert.ok(snapshotDefinition.includes("'tax_state',i.tax_state"), 'QBO snapshot wrapper carries invoice tax_state');

  const recipe = (n) => ({
    webstore_product_id: `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
    product_id: 'P', sku: `PC61-${n}`, image_url: 'https://example.invalid/tee.png',
    decorations: [], transfer_codes: [], takes_name: false, takes_number: false,
    mock_approval: { approved: true },
  });
  async function createOrder(n, overrides = {}) {
    const values = {
      status: 'paid', subtotal: 100, fundraise_amt: 10, discount_amt: 5,
      shipping_fee: 8, processing_fee: 3, tax: 8.25, total: 124.25,
      cc_fee: 4, stripe_pi_id: `pi_test_all_school_${n}`,
      tax_state: 'CA', tax_rate: 0.0825, payment_mode: 'paid',
      ...overrides,
    };
    await db.query(`
      insert into webstore_orders
        (id,store_id,status,order_source,subtotal,fundraise_amt,discount_amt,
         shipping_fee,processing_fee,tax,total,cc_fee,stripe_pi_id,tax_state,
         tax_rate,payment_mode,buyer_name)
      values ($1,$2,$3,'all_school',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'Fake Buyer')`,
    [oid(n), sid, values.status, values.subtotal, values.fundraise_amt,
      values.discount_amt, values.shipping_fee, values.processing_fee, values.tax,
      values.total, values.cc_fee, values.stripe_pi_id, values.tax_state,
      values.tax_rate, values.payment_mode]);
  }
  async function createLine(n, order, sku = `PC61-${order}`, price = 100, fundraise = 10) {
    await db.query(`
      insert into webstore_order_items
        (id,order_id,product_id,sku,name,color,size,qty,unit_price,unit_fundraise,
         production_recipe,line_status)
      values ($1,$2,'P',$3,'Tee','Navy','M',1,$4,$5,$6,'pending')`,
    [iid(n), oid(order), sku, price, fundraise, recipe(order)]);
  }

  await createOrder(1);
  await createLine(1, 1);
  const conversion = (await db.query(
    'select create_all_school_sales_order($1) result', [oid(1)]
  )).rows[0].result;
  assert.equal(conversion.so_id, 'SO-1001', 'first All School SO uses the canonical sequence');
  const invoice = (await db.query(
    'select * from invoices where so_id=$1', [conversion.so_id]
  )).rows[0];
  assert.ok(invoice, 'conversion creates an invoice');
  nearMoney(invoice.total, 124.25, 'invoice gross total');
  nearMoney(invoice.paid, 124.25, 'invoice paid amount');
  nearMoney(invoice.tax, 8.25, 'invoice checkout tax');
  nearMoney(invoice.shipping, 8, 'invoice checkout shipping');
  assert.equal(invoice.status, 'paid');
  const snapshot = (await db.query(
    'select qbo_sales_source_snapshot_without_links(null) result'
  )).rows[0].result;
  assert.equal(snapshot.tax_state, 'CA', 'snapshot wrapper emits original checkout jurisdiction');
  const processingLine = (await db.query(
    `select item from jsonb_array_elements($1::jsonb) item where item->>'_name'='Online processing fee'`,
    [invoice.line_items]
  )).rows[0]?.item;
  assert.ok(processingLine, 'invoice has a separate processing fee line');
  nearMoney(processingLine.amount, 3, 'processing fee line');

  const payment = (await db.query(
    'select amount,method,ref from invoice_payments where invoice_id=$1', [invoice.id]
  )).rows[0];
  assert.equal(payment.method, 'store');
  assert.equal(payment.ref, 'Stripe pi_test_all_school_1');
  nearMoney(payment.amount, 124.25, 'Stripe payment');

  const so = (await db.query(
    'select _omg_processing,_omg_tax,_omg_shipping,_omg_cc_fees from sales_orders where id=$1',
    [conversion.so_id]
  )).rows[0];
  nearMoney(so._omg_processing, 3, 'SO processing');
  nearMoney(so._omg_tax, 8.25, 'SO tax');
  nearMoney(so._omg_shipping, 8, 'SO shipping');
  nearMoney(so._omg_cc_fees, 4, 'SO Stripe cost');

  const replay = (await db.query(
    'select create_all_school_sales_order($1) result', [oid(1)]
  )).rows[0].result;
  assert.equal(replay.replayed, true);
  assert.equal((await db.query('select count(*)::int n from invoices where so_id=$1', [conversion.so_id])).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int n from invoice_payments where invoice_id=$1', [invoice.id])).rows[0].n, 1);
  console.log('PASS paid conversion books checkout tax, shipping, processing, Stripe payment, SO money, and replay once');

  for (const [n, status] of [[2, 'pending_payment'], [3, 'declined']]) {
    await createOrder(n, { status });
    await createLine(n, n);
    await assert.rejects(
      db.query('select create_all_school_sales_order($1)', [oid(n)]),
      /NSA_NOT_PAID|NSA_BAD_INPUT|NSA_/i
    );
    const order = (await db.query('select status,so_id from webstore_orders where id=$1', [oid(n)])).rows[0];
    assert.equal(order.status, status);
    assert.equal(order.so_id, null);
    assert.equal((await db.query('select count(*)::int n from invoices where so_id=$1', [`SO-${1001 + n - 1}`])).rows[0].n, 0);
  }
  console.log('PASS pending and declined fake orders cannot convert');

  await createOrder(4, { total: 124.24 });
  await createLine(4, 4);
  await assert.rejects(
    db.query('select create_all_school_sales_order($1)', [oid(4)]),
    /NSA_|amount|total|checkout|money/i
  );
  const malformed = (await db.query(
    'select status,so_id from webstore_orders where id=$1', [oid(4)]
  )).rows[0];
  assert.equal(malformed.status, 'paid');
  assert.equal(malformed.so_id, null);
  assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n, 1);
  console.log('PASS malformed checkout total is rejected atomically');

  await createOrder(8, { processing_fee: -1, total: 120.25 });
  await createLine(8, 8);
  await assert.rejects(
    db.query('select create_all_school_sales_order($1)', [oid(8)]),
    /NSA_CHECKOUT_MONEY|component|negative/i
  );
  assert.equal((await db.query('select status,so_id from webstore_orders where id=$1', [oid(8)])).rows[0].so_id, null);
  assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n, 1);
  console.log('PASS negative checkout component is rejected atomically');

  await createOrder(9, { tax_state: null });
  await createLine(9, 9);
  await assert.rejects(
    db.query('select create_all_school_sales_order($1)', [oid(9)]),
    /NSA_CHECKOUT_MONEY|jurisdiction|tax/i
  );
  assert.equal((await db.query('select status,so_id from webstore_orders where id=$1', [oid(9)])).rows[0].so_id, null);
  assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n, 1);
  console.log('PASS taxable checkout without jurisdiction is rejected atomically');

  await createOrder(10);
  await createLine(10, 10, 'MISMATCHED', 130, 10);
  await assert.rejects(
    db.query('select create_all_school_sales_order($1)', [oid(10)]),
    /NSA_CHECKOUT_MONEY|product lines|checkout/i
  );
  assert.equal((await db.query('select status,so_id from webstore_orders where id=$1', [oid(10)])).rows[0].so_id, null);
  assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n, 1);
  console.log('PASS product amount mismatch rolls back conversion atomically');

  await createOrder(5, { stripe_pi_id: null });
  await createLine(5, 5);
  await assert.rejects(
    db.query('select create_all_school_sales_order($1)', [oid(5)]),
    /NSA_|Stripe|payment|checkout/i
  );
  assert.equal((await db.query('select so_id from webstore_orders where id=$1', [oid(5)])).rows[0].so_id, null);
  assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n, 1);
  console.log('PASS positive paid checkout without a Stripe intent is rejected atomically');

  await createOrder(6, {
    subtotal: 0, fundraise_amt: 0, discount_amt: 0, shipping_fee: 0,
    processing_fee: 0, tax: 0, total: 0, cc_fee: 0, stripe_pi_id: null,
  });
  await createLine(6, 6, 'FREE-TEE', 0, 0);
  const zero = (await db.query(
    'select create_all_school_sales_order($1) result', [oid(6)]
  )).rows[0].result;
  assert.equal(zero.so_id, 'SO-1002', 'next All School SO advances by one');
  const zeroInvoice = (await db.query('select * from invoices where so_id=$1', [zero.so_id])).rows[0];
  assert.equal(zeroInvoice.id, 'INV-1002', 'invoice number mint remains independent of the SO numbering patch');
  nearMoney(zeroInvoice.total, 0, 'zero checkout invoice total');
  nearMoney(zeroInvoice.paid, 0, 'zero checkout paid');
  assert.equal((await db.query('select count(*)::int n from invoice_payments where invoice_id=$1', [zeroInvoice.id])).rows[0].n, 0);
  console.log('PASS zero total checkout converts without a Stripe payment row');

  // Three $10 lines and a $1 coupon create three 9.67 SO lines. The invoice
  // must absorb the one-cent coupon-rounding drift and still equal $29.00.
  await createOrder(7, {
    subtotal: 30, fundraise_amt: 0, discount_amt: 1, shipping_fee: 0,
    processing_fee: 0, tax: 0, total: 29, cc_fee: 0,
  });
  await createLine(17, 7, 'ROUND-A', 10, 0);
  await createLine(18, 7, 'ROUND-B', 10, 0);
  await createLine(19, 7, 'ROUND-C', 10, 0);
  const rounded = (await db.query(
    'select create_all_school_sales_order($1) result', [oid(7)]
  )).rows[0].result;
  assert.equal(rounded.so_id, 'SO-1003', 'subsequent All School SO IDs stay sequential');
  const roundedInvoice = (await db.query(
    'select * from invoices where so_id=$1', [rounded.so_id]
  )).rows[0];
  nearMoney(roundedInvoice.total, 29, 'fractional coupon invoice total');
  nearMoney(roundedInvoice.paid, 29, 'fractional coupon paid');
  const roundingLine = (await db.query(
    `select item from jsonb_array_elements($1::jsonb) item where item->>'_name'='Line-price rounding'`,
    [roundedInvoice.line_items]
  )).rows[0]?.item;
  assert.ok(roundingLine, 'coupon rounding drift is visible as an invoice adjustment');
  nearMoney(roundingLine.amount, -0.01, 'coupon rounding adjustment');
  console.log('PASS fractional coupon rounding ties invoice to collected amount');

  await db.close();
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
