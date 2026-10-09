// A joined, isolated All School order pipeline proof using the repository's
// compact E2E schema and current SQL migrations. This never connects to a live
// Supabase project or calls a supplier/payment service.
// Run: NODE_PATH=/private/tmp/nsa-inventory-pgtest/node_modules node scripts/pgtest/verify_all_school_pipeline.cjs
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sid = '10000000-0000-0000-0000-000000000001';
const oid = '30000000-0000-0000-0000-000000000001';
const itemId = '40000000-0000-0000-0000-000000000001';
const transferId = '50000000-0000-0000-0000-000000000001';
const poRequest = '60000000-0000-0000-0000-000000000001';
const receiptRequest = '70000000-0000-0000-0000-000000000001';
const dtfBatchId = '80000000-0000-0000-0000-000000000001';
const near = (actual, expected, label) => assert.ok(
  Math.abs(Number(actual) - expected) < 0.005,
  `${label}: expected ${expected}, got ${actual}`
);

(async () => {
  const db = new PGlite();
  try {
    const seed = read('e2e/pipeline/seed.sql')
      .split('-- Reference / seed data')[0]
      .replace(/^\\.*$/gm, '');
    await db.exec(seed);

    // The compact E2E schema intentionally omits the later All School and
    // inventory columns. These are fixture additions only; migrations below
    // still create the functions/tables under verification.
    await db.exec(`
      alter table products add column available_sizes jsonb default '[]';
      alter table webstore_orders add column order_source text, add column tax numeric default 0,
        add column shipping_fee numeric default 0, add column processing_fee numeric default 0,
        add column cc_fee numeric default 0, add column stripe_pi_id text,
        add column tax_state text, add column tax_rate numeric, add column payment_mode text;
      alter table webstore_products add column image_url text;
      alter table webstore_products add column sku text, add column display_name text,
        add column available_sizes jsonb default '[]';
      alter table sales_orders add column _omg_processing numeric default 0,
        add column _omg_tax numeric default 0, add column _omg_shipping numeric default 0,
        add column _omg_cc_fees numeric default 0;
      alter table invoice_payments add column cc_fee numeric default 0;
      alter table so_jobs add column digitizing_needed boolean, add column dtf_prints_status text,
        add column notes text;
      create table job_stage_events(
        id bigserial primary key, so_id text, job_id text, event text,
        from_state jsonb, to_state jsonb, actor text, source text, payload jsonb,
        created_at timestamptz not null default now()
      );
      create table product_inventory(
        id bigserial primary key, product_id text not null, size text not null,
        quantity integer not null default 0, unique(product_id,size)
      );
      create table so_item_pick_lines(
        id bigserial primary key, pick_id uuid not null default gen_random_uuid(),
        so_item_id integer not null references so_items(id), sizes jsonb not null,
        status text not null
      );
      create table app_state(id text primary key,value text,updated_at timestamptz default now());
      create table so_item_po_lines(
        id bigserial primary key,so_item_id integer,po_id text,vendor text,sizes jsonb,
        received jsonb default '{}',cancelled jsonb default '{}',shipments jsonb default '[]',
        status text,created_at text,memo text
      );
      insert into team_members(id,name,role) values('REP','Fake Pipeline Rep','rep');
      insert into customers(id,name,primary_rep_id,payment_terms)
        values('SCHOOL','Fake School','REP','30 days');
      insert into products(id,sku,name,brand,color,retail_price,nsa_cost,available_sizes)
        values('GARMENT','PC61','Cotton Tee','Port','Navy',30,5,'["M"]');
      insert into webstores(id,slug,name,org_type,customer_id,delivery_mode)
        values('${sid}','fake-school','Fake School','all_school','SCHOOL','ship_home');
      set app.is_staff='true';
    `);

    // Apply the relevant current database path in dependency order.
    await db.exec(read('supabase/migrations/20261002183605_all_school_store_foundation.sql'));
    // 00204 supplies this already-live transfer column; keep this compact
    // fixture aligned without importing unrelated Club/Team Shop migrations.
    await db.exec('alter table webstore_transfers add column unit_cost numeric;');
    await db.query(`update webstores set all_school_settings=$2 where id=$1`,
      [sid,{purchasing:{enabled:true,minimum_cents:1,mode:'minimum_weekly'}}]);
    await db.exec(read('supabase/migrations/20261002183729_all_school_order_conversion.sql'));
    await db.exec(read('supabase/migrations/20261008072513_all_school_method_readiness.sql'));
    await db.exec(read('supabase/migrations/20261002184500_all_school_dtf_batches.sql'));
    await db.exec(read('supabase/migrations/00193_purchase_orders.sql'));
    await db.exec(read('supabase/migrations/00202_teamshop_auto_po.sql'));
    await db.exec('alter table teamshop_auto_po_needs add column dismissed_at timestamptz;');
    await db.exec(read('supabase/migrations/20261002184054_all_school_purchasing_runtime.sql'));
    await db.exec(read('supabase/migrations/20261008142755_store_inventory_purchase_costs.sql'));
    await db.exec(read('supabase/migrations/00237_pull_house_inventory.sql'));
    await db.exec(read('supabase/migrations/00192_job_stage_machine.sql'));
    await db.exec(read('supabase/migrations/00205_release_gate.sql'));
    // The sequential-ID migration intentionally validates every converter.
    // Three unrelated converters are signature-compatible scratch stubs; the
    // tested All School converter remains the production migration definition.
    await db.exec(`
      create function create_teamshop_sales_order(uuid) returns jsonb language plpgsql as $$
      declare v_num bigint; begin
        select greatest(coalesce(max((regexp_match(id, '(\\d+)'))[1]::bigint),0),1000)+1 into v_num from sales_orders;
        return '{}'::jsonb;
      end $$;
      create function create_club_sales_order(uuid) returns jsonb language plpgsql as $$
      declare v_num bigint; begin
        select greatest(coalesce(max((regexp_match(id, '(\\d+)'))[1]::bigint),0),1000)+1 into v_num from sales_orders;
        return '{}'::jsonb;
      end $$;
      create function convert_uniform_order_to_sales_order(uuid) returns jsonb language plpgsql as $$
      declare v_num bigint; begin
        select greatest(coalesce(max((regexp_match(id, '^SO-([0-9]+)$'))[1]::bigint),0),1000)+1 into v_num from sales_orders;
        return '{}'::jsonb;
      end $$;
      create function qbo_sales_source_snapshot_without_links(timestamptz)
        returns jsonb language sql as $$
        select jsonb_build_object('tax',i.tax,'tax_rate',i.tax_rate) from invoices i order by i.id limit 1
      $$;
    `);
    await db.exec(read('supabase/migrations/20261008193918_keep_sales_order_ids_sequential.sql'));
    await db.exec(read('supabase/migrations/20261009054131_all_school_checkout_accounting.sql'));
    console.log('PASS current All School foundation, conversion, DTF, purchasing, inventory-cost, pull, release, sequential-ID, and checkout-accounting migrations apply');

    // A paid fake web checkout, with two garment units and a DTF transfer that
    // is initially out of stock. Payment and checkout are represented by the
    // same immutable fields the conversion RPC consumes after successful
    // checkout; no network/payment operation is attempted here.
    const recipe = {
      webstore_product_id: '20000000-0000-0000-0000-000000000001',
      product_id: 'GARMENT', sku: 'PC61', color: 'Navy',
      decorations: [{ art_id: 'crest', type: 'dtf', placement: 'full_front',
        art_url: 'https://example.invalid/crest.png' }],
      transfer_codes: ['SCHOOL-CREST'],
      transfer_inventory: [{ code: 'SCHOOL-CREST', label: 'School crest',
        decoration_type: 'dtf', application_method: 'heat_press', width_in: 4,
        height_in: 4, production_file: { bucket: 'all-school-art', path: 'school/crest.ai' } }],
      takes_name: false, takes_number: false,
      mock_approval: { approved: true },
    };
    await db.query(`
      insert into webstore_products(id,store_id,product_id,sku,display_name,available_sizes)
      values($1,$2,'GARMENT','PC61','Cotton Tee','["M"]')`,
    [recipe.webstore_product_id, sid]);
    await db.query(`insert into webstore_transfers(id,store_id,code,label,on_hand,unit_cost)
      values($1,$2,'SCHOOL-CREST','School crest',0,2.50)`, [transferId,sid]);
    await db.query(`insert into webstore_orders
      (id,store_id,status,order_source,subtotal,fundraise_amt,discount_amt,shipping_fee,
       processing_fee,tax,total,cc_fee,stripe_pi_id,tax_state,tax_rate,payment_mode,buyer_name)
      values($1,$2,'paid','all_school',60,0,0,0,0,0,60,1.80,'pi_fake_school_1','CA',0,'paid','Fake Buyer')`,
    [oid,sid]);
    await db.query(`insert into webstore_order_items
      (id,order_id,product_id,sku,name,color,size,qty,unit_price,unit_fundraise,
       production_recipe,line_status)
      values($1,$2,'GARMENT','PC61','Cotton Tee','Navy','M',2,30,0,$3,'pending')`,
    [itemId,oid,recipe]);

    const conversion = (await db.query(
      'select create_all_school_sales_order($1) result', [oid]
    )).rows[0].result;
    assert.equal(conversion.so_id, 'SO-1001');
    assert.equal(conversion.items, 1);
    const invoice = (await db.query('select * from invoices where so_id=$1',[conversion.so_id])).rows[0];
    assert.ok(invoice, 'conversion should create the checkout invoice without a separate invoice action');
    assert.equal(invoice.status, 'paid');
    near(invoice.total,60,'automatically created invoice total');
    near(invoice.paid,60,'automatically applied checkout payment');
    assert.equal((await db.query('select count(*)::int n from invoice_payments where invoice_id=$1',[invoice.id])).rows[0].n,1);
    assert.equal((await db.query('select status from webstore_orders where id=$1',[oid])).rows[0].status,'batched');
    console.log('PASS fake paid checkout converts once to SO + paid invoice/payment; no manual invoice step');

    const job = (await db.query('select id,so_id from so_jobs where so_id=$1',[conversion.so_id])).rows[0];
    const soItem = (await db.query('select id,sizes,source_webstore_item_ids from so_items where so_id=$1',[conversion.so_id])).rows[0];
    const readiness = async () => (await db.query(
      'select all_school_materials_ready($1,$2) result',[job.so_id,job.id]
    )).rows[0].result;
    const short = (await db.query('select reserve_all_school_decorations($1) result',[oid])).rows[0].result;
    assert.equal(short.short_qty,2);
    assert.equal((await readiness()).reason,'decoration_not_physically_consumed');
    console.log('PASS transfer allocation records shortage and keeps production blocked');

    // The garment is also short on warehouse stock. The production PO engine
    // places the two-unit backorder in its own PO; supplier submission is
    // represented with the server claim/record RPCs, without calling a vendor.
    await db.query(`insert into teamshop_auto_po_settings(vendor,auto_submit_enabled)
      values('SanMar',true) on conflict(vendor) do update set auto_submit_enabled=true`);
    await db.query(`insert into teamshop_auto_po_needs
      (so_id,so_item_id,product_id,sku,size,qty_ordered,qty_needed,vendor,unit_cost_cents,skip_reason)
      values($1,$2,'GARMENT','PC61','M',2,2,'SanMar',500,'all_school_pending')`,[job.so_id,soItem.id]);
    const need = (await db.query('select id from teamshop_auto_po_needs where so_id=$1',[job.so_id])).rows[0].id;
    const shipTo = {companyName:'Fake School',address1:'1 Test Way',city:'Orange',region:'CA',postalCode:'92865',country:'US'};
    const plan = (await db.query(`select plan_all_school_purchase($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result`,
      [sid,'SanMar','fake-school-order-1',[need],'minimum',false,'separate',100000,'pgtest',shipTo])).rows[0].result;
    assert.ok(plan.purchase_order, `garment shortage should create a PO; got ${JSON.stringify(plan)}`);
    assert.equal(plan.purchase_order.origin,'auto');
    assert.equal((await db.query('select count(*)::int n from purchase_order_lines where po_id=$1',[plan.purchase_order.id])).rows[0].n,1);
    const token = '90000000-0000-0000-0000-000000000001';
    const claim = (await db.query('select claim_all_school_po_submission($1,$2) result',[plan.purchase_order.id,token])).rows[0].result;
    assert.equal(claim.claimed,true);
    const recorded = (await db.query(`select record_all_school_po_submission($1,$2,$3,$4,$5,$6) result`,
      [plan.purchase_order.id,token,'submitted','FAKE-SUPPLIER-PO',null,[]])).rows[0].result;
    assert.ok(recorded);
    console.log('PASS garment shortage creates a dedicated All School PO and guarded synthetic submission record');

    // Warehouse inventory replenishment is a separate inventory PO lane. A
    // receipt increases the stock ledger and then an order-specific pick pulls
    // exactly the source garments with the received unit cost frozen.
    const invProduct = (await db.query('select id from webstore_products where id=$1',[recipe.webstore_product_id])).rows[0];
    assert.ok(invProduct);
    const inventoryPo = (await db.query(`select create_store_inventory_po($1,$2,$3,$4) result`,
      [sid,poRequest,'Local Apparel',[{webstore_product_id:recipe.webstore_product_id,size:'M',qty:2,unit_cost_cents:500}]])).rows[0].result.purchase_order;
    const poLine = (await db.query('select id from purchase_order_lines where po_id=$1',[inventoryPo.id])).rows[0].id;
    await db.query('select receive_store_inventory_po($1,$2,$3,$4)',[poLine,receiptRequest,2,5]);
    assert.equal((await db.query("select quantity from product_inventory where product_id='GARMENT' and size='M'")).rows[0].quantity,2);
    const pickId = 'a0000000-0000-0000-0000-000000000001';
    await db.query('select pull_store_inventory($1)',[[{so_id:job.so_id,product_id:'GARMENT',size:'M',qty:2,pick_id:pickId,source_item_ids:soItem.source_webstore_item_ids}]]);
    await db.query(`insert into so_item_pick_lines(pick_id,so_item_id,sizes,status)
      values($1,$2,'{"M":2}','pulled')`,[pickId,soItem.id]);
    assert.equal((await db.query("select quantity from product_inventory where product_id='GARMENT' and size='M'")).rows[0].quantity,0);
    const pickSnapshot=(await db.query("select qty,unit_cost,stock_pulled from store_inventory_cost_snapshots where source_key like 'pick:%'")).rows[0];
    assert.equal(pickSnapshot.qty,2);near(pickSnapshot.unit_cost,5,'picked garment receipt cost');assert.equal(pickSnapshot.stock_pulled,true);
    console.log('PASS inventory PO receipt replenishes stock; source-bound pick decrements it and freezes cost');

    // Short DTF is procured through the DTF batch lane. Claim/receive are SQL
    // state transitions only; no email, supplier portal or service endpoint is
    // contacted. Receipt adds stock and allocation; a physical consume is a
    // separate, audited pull before production becomes eligible.
    const allocation = (await db.query('select id,required_qty from all_school_decoration_allocations where order_id=$1',[oid])).rows[0];
    assert.equal(allocation.required_qty,2);
    const manifest = {so_id:job.so_id,job_id:job.id,order_id:oid,transfer_code:'SCHOOL-CREST',qty:2,
      allocation_shortfalls:[{id:allocation.id,qty:2}]};
    await db.query(`insert into all_school_dtf_requests(id,store_id,so_id,job_id,supplier_id,qty,manifest)
      values($1,$2,$3,$4,'Local DTF',2,$5)`,[dtfBatchId,sid,job.so_id,job.id,manifest]);
    const dtfBatch=(await db.query('select claim_all_school_dtf_batch($1,$2,$3) result',
      [sid,'Local DTF',{vendor:'Local DTF',email:'fake@example.invalid'}])).rows[0].result;
    assert.ok(dtfBatch.id);
    await db.query("update all_school_dtf_batches set status='sent' where id=$1",[dtfBatch.id]);
    await db.query('select receive_all_school_dtf_batch($1,$2,$3)',[dtfBatch.id,'REP','FAKE-DTF-RECEIPT']);
    assert.equal((await db.query("select on_hand from webstore_transfers where code='SCHOOL-CREST'")).rows[0].on_hand,2);
    assert.equal((await readiness()).reason,'decoration_not_physically_consumed');
    const consumed=(await db.query('select consume_all_school_decorations($1) result',[oid])).rows[0].result;
    assert.equal(consumed.ok,true);
    assert.equal((await readiness()).ready,true);
    console.log('PASS DTF batch receipt alone does not release job; physical allocation consumption makes materials ready');

    // Exercise the production release gate only after the materials ledger has
    // passed. Release then follows the normal job FSM through packing.
    await db.query("update so_jobs set art_status='art_complete',item_status='received' where so_id=$1 and id=$2",[job.so_id,job.id]);
    const released=(await db.query(`select advance_job_stage(
      p_so_id=>$1,p_job_id=>$2,p_event=>'release',p_actor=>'pgtest') result`,[job.so_id,job.id])).rows[0].result;
    assert.equal(released.ok,true);
    assert.equal((await db.query('select prod_status from so_jobs where so_id=$1 and id=$2',[job.so_id,job.id])).rows[0].prod_status,'staging');
    await db.query("select advance_job_stage($1,$2,'start_run','pgtest')",[job.so_id,job.id]);
    await db.query("select advance_job_stage($1,$2,'decorated','pgtest')",[job.so_id,job.id]);
    await db.query("select advance_job_stage($1,$2,'packed','pgtest')",[job.so_id,job.id]);
    assert.equal((await db.query('select prod_status from so_jobs where so_id=$1 and id=$2',[job.so_id,job.id])).rows[0].prod_status,'completed');
    console.log('PASS job release is gated by art/material readiness and completes through staging, run, decorate, pack');
  } finally {
    await db.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
