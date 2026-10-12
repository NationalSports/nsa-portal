// Fake Club checkout → SO/invoice → stock pull → production → shipment flow.
// Entirely in-memory PGlite; no Supabase, Stripe, supplier, or other network calls.
// Run: NODE_PATH=/private/tmp/nsa-inventory-pgtest/node_modules node scripts/pgtest/verify_club_pipeline.cjs
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sid = 'a1000000-0000-0000-0000-000000000001';
const orderId = 'a2000000-0000-0000-0000-000000000001';
const itemId = 'a3000000-0000-0000-0000-000000000001';
const webProductId = 'a4000000-0000-0000-0000-000000000001';
const transferId = 'a5000000-0000-0000-0000-000000000001';
const customerId = 'CUST-PG-CLUB';
const memberId = 'REP-PG-CLUB';
const productId = 'P-PG-CLUB';
const transferCode = 'PG-CLUB-CREST';
const near = (actual, expected, label) => assert.ok(
  Math.abs(Number(actual) - expected) < 0.005,
  `${label}: expected ${expected}, got ${actual}`
);

let sharedSnapshot = null;
try {
  ({ snapshot: sharedSnapshot } = require('./pipeline_snapshot.cjs'));
} catch (_) {
  // Local query fallback keeps this harness runnable before the optional
  // cross-flow snapshot helper lands. AT_ONCE_SNAPSHOT_FILE still exports the
  // same stage-shaped fields for the parent pipeline reconciliation.
}

(async () => {
  const db = new PGlite();
  let transactionOpen = false;
  const snapshots = [];
  let soId = null;
  const assertFixtureCleared = async () => {
    const result = (await db.query(`
      select
        (select count(*)::int from webstores where id=$1) stores,
        (select count(*)::int from customers where id=$2) customers,
        (select count(*)::int from team_members where id=$3) members,
        (select count(*)::int from products where id=$4) products,
        (select count(*)::int from webstore_products where id=$5) web_products,
        (select count(*)::int from webstore_transfers where id=$6) transfers,
        (select count(*)::int from webstore_orders where id=$7) orders,
        (select count(*)::int from webstore_order_items where id=$8) order_items,
        (select count(*)::int from sales_orders where id=$9) sales_orders,
        (select count(*)::int from so_items where so_id=$9) so_items,
        (select count(*)::int from so_jobs where so_id=$9) jobs,
        (select count(*)::int from invoices where so_id=$9) invoices,
        (select count(*)::int from invoice_payments where invoice_id in
          (select id from invoices where so_id=$9)) payments,
        (select count(*)::int from customer_credits where customer_id=$2) credits,
        (select count(*)::int from job_stage_events where so_id=$9) stage_events
    `, [sid, customerId, memberId, productId, webProductId, transferId, orderId, itemId, soId ?? '__no_so__'])).rows[0];
    for (const [name, count] of Object.entries(result)) {
      assert.equal(Number(count), 0, `rollback cleanup left ${count} fake ${name}`);
    }
  };
  const capture = async (label, expectedStatus, expectedValue) => {
    let value;
    if (sharedSnapshot && soId) {
      value = await sharedSnapshot(db, soId, label, expectedStatus, expectedValue);
    } else {
      value = (await db.query(`
        select $2::text label,$3::text expected_status,$4::text expected_value,
               to_jsonb(o) order_row,to_jsonb(s) store_row,to_jsonb(c) customer_row,
               to_jsonb(so) sales_order,
               (select to_jsonb(i) from invoices i where i.so_id=so.id order by i.id limit 1) invoice,
               (select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]'::jsonb)
                  from so_jobs j where j.so_id=so.id) jobs
          from sales_orders so join webstores s on s.id=so.webstore_id
          join customers c on c.id=so.customer_id
          left join webstore_orders o on o.so_id=so.id
         where so.id=$1`, [soId, label, expectedStatus, expectedValue])).rows[0];
    }
    snapshots.push(value);
    return value;
  };

  try {
    const seed = read('e2e/pipeline/seed.sql')
      .split('-- Reference / seed data')[0]
      .replace(/^\\.*$/gm, '');
    await db.exec(seed);
    // The compact e2e seed omits this pre-existing application table. Keep the
    // production 00007 row shape so hydrated dashboard snapshots can reflect
    // actual warehouse pick/pull states instead of SO status overrides.
    await db.exec(`create table if not exists public.so_item_pick_lines (
      id serial primary key,
      so_item_id int not null references public.so_items(id) on delete cascade,
      pick_id text,
      sizes jsonb default '{}'::jsonb,
      status text default 'pick',
      created_at text,
      memo text,
      ship_dest text default 'in_house',
      ship_addr text,
      deco_vendor text
    );`);
    await db.exec(`alter table so_items add column source_webstore_item_ids uuid[] not null default '{}';
      create table public.product_inventory(id serial primary key,product_id text not null,size text not null,quantity integer not null default 0,unique(product_id,size));
      create table public.so_item_po_lines(id serial primary key,so_item_id integer not null references so_items(id) on delete cascade,po_id text,sizes jsonb default '{}',received jsonb default '{}',cancelled jsonb default '{}',status text default 'ordered');
      create table public.all_school_house_reservations(need_id bigint primary key,product_id text not null,size text not null,qty integer not null,so_id text not null);`);
    // Later schema columns deliberately omitted from the compact baseline are
    // added by their real migrations below; only shipped quantity is absent
    // from this seed and belongs to the at-once completion trigger fixture.
    await db.exec('alter table webstore_orders add column shipped_at timestamptz;');
    await db.exec('alter table webstore_order_items add column shipped_qty integer not null default 0;');
    await db.exec("alter table webstore_products add column num_transfer_sets jsonb not null default '[]'::jsonb; alter table webstore_products add column num_transfer_size text; alter table webstore_products add column num_transfer_color text; alter table webstore_products alter column num_transfer_sets drop not null; alter table webstore_order_items add column num_transfer_sets jsonb; alter table webstore_order_items add column num_transfer_size text; alter table webstore_order_items add column num_transfer_color text; alter table webstore_order_items add column production_recipe jsonb; alter table webstore_order_items add column webstore_product_id uuid; alter table webstore_order_items add column cancelled_qty integer not null default 0; alter table webstore_order_items add column refunded_qty integer not null default 0;");

    const dependencyMigrations = [
      '00191_artwork_storage_staff_write.sql',
      '00192_job_stage_machine.sql',
      '00193_purchase_orders.sql',
      '00194_teamshop_logos.sql',
      '00195_teamshop_orders.sql',
      '00196_create_teamshop_sales_order.sql',
      '00197_teamshop_handoff.sql',
      '00198_teamshop_deco_rates.sql',
      '00199_teamshop_conversion_invoice.sql',
      '00200_teamshop_po_allowed.sql',
      '00201_teamshop_po_orders.sql',
      '00202_teamshop_auto_po.sql',
      '00203_teamshop_delivery_timelines.sql',
      '00204_club_store_conversion.sql',
      '00205_release_gate.sql',
      '00206_pull_transfers_txn.sql',
      '00207_auto_art.sql',
      '00208_teamshop_auto_release.sql',
      '00209_teamshop_auto_po_needs_dismiss.sql',
      '00210_so_jobs_notes.sql',
      '00211_teamshop_dtf_auto_po.sql',
      '00212_so_jobs_dtf_prints_status.sql',
      '00214_club_bundle_store_scope.sql',
      '00215_pull_transfers_idempotent.sql',
      '00219_tighten_auto_art_predicate.sql',
      '00235_club_transfer_auto_art.sql',
      '00237_pull_house_inventory.sql',
      '20260902063000_exact_club_bundle_cent_allocation.sql',
      '20261011064155_club_verified_transfer_pull.sql',
    ];
    for (const migration of dependencyMigrations) {
      await db.exec(read(`supabase/migrations/${migration}`));
    }
    await db.exec(`create function public.all_school_garment_source_valid(integer) returns boolean language sql stable as $$select true$$;`);
    await db.exec(read('supabase/migrations/20261011070456_auto_at_once_inventory_pick_assignment.sql'));

    // The current sequential-ID migration asserts all four converters. The
    // Club and Team Shop definitions above are real; unrelated All School and
    // Uniform converters are shape-compatible guard fixtures in this Club-only
    // harness. They only let the shared numbering migration validate its full
    // expected function set; the target Club converter is never stubbed.
    await db.exec(`
      create function create_all_school_sales_order(uuid)
        returns jsonb language plpgsql as $$
      declare v_num bigint; v_so_id text;
      begin
        perform pg_advisory_xact_lock(hashtext('nsa_sales_orders_id_mint'));
        select greatest(coalesce(max((regexp_match(id, '(\\d+)'))[1]::bigint),0),1000)+1
          into v_num from sales_orders;
        v_so_id := 'SO-' || v_num; return jsonb_build_object('so_id',v_so_id);
      end $$;
      create function convert_uniform_order_to_sales_order(uuid)
        returns jsonb language plpgsql as $$
      declare v_num bigint;
      begin
        select greatest(coalesce(max((regexp_match(id, '^SO-([0-9]+)$'))[1]::bigint),0),1000)+1
          into v_num from sales_orders;
        return '{}'::jsonb;
      end $$;
    `);
    await db.exec(read('supabase/migrations/20261008193918_keep_sales_order_ids_sequential.sql'));
    await db.exec(read('supabase/migrations/20261011063832_at_once_fulfillment_completion.sql'));
    await db.exec(read('supabase/migrations/20261012051835_at_once_247_sales_order_numbering.sql'));
    await db.exec(read('supabase/migrations/20261012054600_at_once_use_store_order_number.sql'));
    await db.exec(read('supabase/migrations/20261012054600_at_once_use_store_order_number.sql'));
    const teamshopMint = (await db.query("select pg_get_functiondef('public.create_teamshop_sales_order(uuid)'::regprocedure) definition")).rows[0].definition;
    const uniformMint = (await db.query("select pg_get_functiondef('public.convert_uniform_order_to_sales_order(uuid)'::regprocedure) definition")).rows[0].definition;
    assert.match(teamshopMint, /SO-/); assert.doesNotMatch(teamshopMint, /247-/);
    assert.match(uniformMint, /SO-/); assert.doesNotMatch(uniformMint, /247-/);
    console.log('PASS real Club chain and checkout-number migration; Team Shop and uniform retain SO namespace');

    await db.exec('begin');
    transactionOpen = true;
    await db.exec(`set app.is_staff='true'; set request.jwt.claims='{"role":"service_role"}';`);
    let rejectionSavepoint = 0;
    const expectSqlReject = async (query, pattern) => {
      const savepoint = `expected_reject_${++rejectionSavepoint}`;
      await db.exec(`savepoint ${savepoint}`);
      try {
        await assert.rejects(query(), pattern);
      } finally {
        await db.exec(`rollback to savepoint ${savepoint}; release savepoint ${savepoint}`);
      }
    };
    await db.query("insert into team_members(id,name,role) values($1,'Fake Club Rep','rep')", [memberId]);
    await db.query(`insert into customers(id,name,primary_rep_id,payment_terms)
      values($1,'Fake Club','REP-PG-CLUB','net30')`, [customerId]);
    await db.query(`insert into products(id,sku,name,brand,color,retail_price,nsa_cost)
      values($1,'PG-TEE','PGlite Tee','Test Brand','Navy',30,7.50)`, [productId]);
    await db.query(`insert into product_inventory(product_id,size,quantity) values($1,'M',2)`, [productId]);
    await db.query(`insert into webstores(id,slug,name,org_type,customer_id,delivery_mode,source,status)
      values($1,'pg-club-fake','PGlite Fake Club','club',$2,'ship_home','webstore','open')`, [sid, customerId]);
    await db.query(`insert into webstore_products(id,store_id,product_id,decorations,transfer_codes,takes_number,num_transfer_sets)
      values($1,$2,$3,'[]'::jsonb,array[$4],true,'[\"8in|White\"]'::jsonb)`, [webProductId, sid, productId, transferCode]);
    await db.query(`insert into webstore_transfers(id,store_id,code,label,kind,on_hand,unit_cost)
      values($1,$2,$3,'Fake Club Crest','design',3,1.25),
             (gen_random_uuid(),$2,'1|8in|White','Digit 1','number',3,0.50),
             (gen_random_uuid(),$2,'2|8in|White','Digit 2','number',3,0.50)`, [transferId, sid, transferCode]);
    await db.query(`insert into webstore_orders
      (id,store_id,status,order_number,buyer_name,buyer_email,subtotal,fundraise_amt,discount_amt,total)
      values($1,$2,'paid',1010042,'Fake Buyer','fake@example.invalid',50,0,0,50)`, [orderId, sid]);
    await db.query(`insert into webstore_order_items
      (id,order_id,product_id,sku,name,color,size,qty,unit_price,unit_fundraise,player_number,line_status)
      values($1,$2,$3,'PG-TEE','PGlite Tee','Navy','M',2,25,0,'12','pending')`, [itemId, orderId, productId]);

    const converted = (await db.query(
      'select public.create_club_sales_order($1) result', [orderId]
    )).rows[0].result;
    soId = converted.so_id;
    assert.equal(soId, '1010042');
    assert.equal(converted.items, 1);
    assert.equal(converted.jobs, 1);
    assert.equal(converted.units, 2);
    const source = (await db.query(`select status,so_id from webstore_orders where id=$1`, [orderId])).rows[0];
    assert.equal(source.status, 'batched');
    assert.equal(source.so_id, soId);
    const invoice = (await db.query('select * from invoices where so_id=$1', [soId])).rows[0];
    assert.ok(invoice, 'Club checkout conversion automatically creates its invoice');
    near(invoice.total, 50, 'invoice total');
    near(invoice.paid, 50, 'invoice paid amount');
    assert.equal(invoice.status, 'paid');
    const payment = (await db.query('select amount,method,ref from invoice_payments where invoice_id=$1', [invoice.id])).rows[0];
    near(payment.amount, 50, 'checkout payment record');
    assert.equal(payment.method, 'store');
    assert.equal(payment.ref, 'CLUB 1010042');
    const job = (await db.query(`select id,art_status,item_status,prod_status,total_units
      from so_jobs where so_id=$1`, [soId])).rows[0];
    assert.equal(job.art_status, 'art_complete', 'existing stocked transfer is auto-art complete');
    assert.equal(job.item_status, 'need_to_order');
    assert.equal(job.total_units, 2);
    const frozenNumbers = (await db.query(`select d.roster from so_item_decorations d
      join so_items i on i.id=d.so_item_id where i.so_id=$1 and d.kind='numbers'`, [soId])).rows[0].roster;
    assert.deepEqual(frozenNumbers, { M: ['12', '12'] });
    const numberDemand = (await db.query('select * from club_number_transfer_demand($1,$2) order by transfer_code', [sid, soId])).rows;
    assert.deepEqual(numberDemand.map((r) => [r.transfer_code, Number(r.required_qty)]), [
      ['1|8in|White', 2], ['2|8in|White', 2],
    ], 'Club number transfers count each digit, repeated digit, configured set, and garment unit');
    await db.query('update webstore_order_items set cancelled_qty=1 where id=$1', [itemId]);
    const remainingNumberDemand = (await db.query('select * from club_number_transfer_demand($1,$2) order by transfer_code', [sid, soId])).rows;
    assert.deepEqual(remainingNumberDemand.map((r) => [r.transfer_code, Number(r.required_qty)]), [
      ['1|8in|White', 1], ['2|8in|White', 1],
    ], 'cancelled source quantity is excluded from digit-transfer demand');
    await db.query('update webstore_order_items set cancelled_qty=0 where id=$1', [itemId]);
    await db.query("update webstore_products set num_transfer_sets='[]'::jsonb where id=$1", [webProductId]);
    assert.deepEqual((await db.query('select * from club_number_transfer_demand($1,$2)', [sid, soId])).rows, [],
      'number personalization with no transfer sets does not require digit stock');
    await db.query("update webstore_products set num_transfer_sets='[\"8in|White\"]'::jsonb where id=$1", [webProductId]);
    const decoCost = (await db.query(`select d.cost_each from so_item_decorations d
      join so_items i on i.id=d.so_item_id where i.so_id=$1`, [soId])).rows[0].cost_each;
    near(decoCost, 1.25, 'transfer unit cost frozen on SO');
    const invoiceCount = (await db.query('select count(*)::int n from invoices where so_id=$1', [soId])).rows[0].n;
    const paymentCount = (await db.query('select count(*)::int n from invoice_payments where invoice_id=$1', [invoice.id])).rows[0].n;
    const replay = (await db.query('select public.create_club_sales_order($1) result', [orderId])).rows[0].result;
    assert.equal(replay.replayed, true);
    assert.equal(replay.so_id, soId);
    const numberCounts = (await db.query(`select
      count(*) filter(where id ~ '^[0-9]+$')::int at_once,
      count(*) filter(where id ~ '^SO-[0-9]{4,7}$')::int main
      from sales_orders`)).rows[0];
    assert.equal(numberCounts.at_once, 1, 'new Club conversion occupies the store-number namespace exactly once');
    assert.equal(numberCounts.main, 0, 'native conversion leaves the ordinary SO sequence untouched');
    assert.equal((await db.query('select count(*)::int n from invoices where so_id=$1', [soId])).rows[0].n, invoiceCount);
    assert.equal((await db.query('select count(*)::int n from invoice_payments where invoice_id=$1', [invoice.id])).rows[0].n, paymentCount);
    assert.equal((await db.query('select count(*)::int n from so_jobs where so_id=$1', [soId])).rows[0].n, 1);
    console.log('PASS fake paid Club checkout converts once to 1010042 SO/job and paid invoice/payment; replay is duplicate-free');

    await capture('club_conversion_need_order', 'need_order', 50);
    const soItem = (await db.query('select id from so_items where so_id=$1', [soId])).rows[0];
    const assigned = (await db.query('select public.assign_at_once_inventory_picks($1) result', [soId])).rows[0].result;
    assert.equal(assigned.created_lines, 1);
    assert.equal(assigned.assigned_units, 2);
    const pick = (await db.query(`select id,sizes,status,pick_id from so_item_pick_lines where so_item_id=$1`, [soItem.id])).rows[0];
    assert.match(pick.pick_id, /^IF-AUTO-[0-9a-f]{32}$/);
    assert.equal(pick.status, 'pick');
    assert.deepEqual(pick.sizes, { M: 2 });
    assert.equal((await db.query('select quantity from product_inventory where product_id=$1 and size=\'M\'', [productId])).rows[0].quantity, 2,
      'task assignment does not decrement inventory before the warehouse confirms a pull');
    await db.query("update sales_orders set status='needs_pull' where id=$1", [soId]);
    await capture('club_pending_pick_needs_pull', 'needs_pull', 50);
    await expectSqlReject(() => db.query(`select advance_job_stage(
      p_so_id=>$1,p_job_id=>$2,p_event=>'release',p_actor=>'pgtest') result`, [soId, job.id]), /NSA_NOT_READY|NSA_TRANSFER/i);

    // Simulate warehouse garment receipt in the ERP, while transfer stock is
    // still unverified. The release gate must continue to block until the
    // stock-pull RPC commits both its decrement and verification stamp.
    await db.query("update so_jobs set item_status='items_received' where so_id=$1 and id=$2", [soId, job.id]);
    await expectSqlReject(() => db.query(`select advance_job_stage(
      p_so_id=>$1,p_job_id=>$2,p_event=>'release',p_actor=>'pgtest') result`, [soId, job.id]), /NSA_TRANSFER|NSA_NOT_READY/i);
    await expectSqlReject(() => db.query('select pull_webstore_transfers($1,$2,$3) result',
      [sid, [soId], []]), /NSA_TRANSFER_DEMAND_MISMATCH/i);
    await expectSqlReject(() => db.query('select pull_webstore_transfers($1,$2,$3) result',
      [sid, [soId], [{ code: transferCode, qty: 1 }]]), /NSA_TRANSFER_DEMAND_MISMATCH/i);
    await expectSqlReject(() => db.query('select pull_webstore_transfers($1,$2,$3) result',
      [sid, [soId], [{ code: transferCode, qty: 2 }, { code: '1|8in|White', qty: 2 }]]), /NSA_TRANSFER_DEMAND_MISMATCH/i);
    const ambiguousOffering = 'a4000000-0000-0000-0000-000000000099';
    await db.query(`insert into webstore_products(id,store_id,product_id,decorations,transfer_codes,takes_number,num_transfer_sets)
      values($1,$2,$3,'[]'::jsonb,array[$4],true,'[\"9in|Black\"]'::jsonb)`,
      [ambiguousOffering, sid, productId, transferCode]);
    // An exact offering ID wins over the ambiguous product fallback, matching
    // transferDemand.shared. Club legacy rows without that ID must fail closed.
    await db.query('update webstore_order_items set webstore_product_id=$2 where id=$1', [itemId, webProductId]);
    assert.equal((await db.query('select count(*)::int n from club_number_transfer_demand($1,$2)', [sid, soId])).rows[0].n, 2);
    await db.query('update webstore_order_items set webstore_product_id=null where id=$1', [itemId]);
    await expectSqlReject(() => db.query('select pull_webstore_transfers($1,$2,$3) result',
      [sid, [soId], [{ code: transferCode, qty: 2 }, { code: '1|8in|White', qty: 2 }, { code: '2|8in|White', qty: 2 }]]), /NSA_NUMBER_TRANSFER_CONFIG_UNVERIFIED/i);
    // A frozen versioned recipe also takes priority over an ambiguous live map.
    await db.query(`update webstore_order_items set production_recipe=$2 where id=$1`, [itemId, {
      version: 1, takes_number: true, transfer_codes: [transferCode], num_transfer_sets: ['8in|White'],
    }]);
    assert.equal((await db.query('select sum(required_qty)::int n from club_number_transfer_demand($1,$2)', [sid, soId])).rows[0].n, 4);
    await db.query(`update webstore_order_items set player_number='2', production_recipe=$2 where id=$1`, [itemId, {
      version: 1, takes_number: true, num_transfer_sets: null, num_transfer_size: '8in', num_transfer_color: 'White',
    }]);
    assert.deepEqual((await db.query('select transfer_code,required_qty from club_number_transfer_demand($1,$2)', [sid, soId])).rows,
      [{ transfer_code: '2|8in|White', required_qty: 2 }],
      'legacy exact-offering digit recipe falls back to num_transfer_size/color when num_transfer_sets is null');
    await db.query('update webstore_order_items set production_recipe=null where id=$1', [itemId]);
    await db.query("update webstore_order_items set player_number='12' where id=$1", [itemId]);
    await db.query('delete from webstore_products where id=$1', [ambiguousOffering]);
    // A design pull alone cannot release the number roster's production jobs.
    await db.query(`update webstore_orders set transfers_pulled=true, transfers_pull_verified_at=now(),
      transfers_pull_verified_codes=array[$2] where id=$1`, [orderId, transferCode]);
    await expectSqlReject(() => db.query(`select advance_job_stage(
      p_so_id=>$1,p_job_id=>$2,p_event=>'release',p_actor=>'pgtest') result`, [soId, job.id]), /NSA_TRANSFER_PULL_UNVERIFIED/i);
    await db.query(`update webstore_orders set transfers_pulled=false, transfers_pull_verified_at=null,
      transfers_pull_verified_codes='{}' where id=$1`, [orderId]);
    await expectSqlReject(() => db.query('select pull_webstore_transfers($1,$2,$3) result',
      [sid, [soId], [{ code: transferCode, qty: 2 }, { code: '1|8in|White', qty: 2 }, { code: '2|8in|White', qty: 2 }, { code: 'PG-CLUB-MISSING', qty: 1 }]]), /NSA_TRANSFER_STOCK_MISSING/i);
    await expectSqlReject(() => db.query('select pull_webstore_transfers($1,$2,$3) result',
      [sid, [soId], [{ code: transferCode, qty: 4 }, { code: '1|8in|White', qty: 2 }, { code: '2|8in|White', qty: 2 }]]), /NSA_TRANSFER_SHORTAGE/i);
    assert.equal((await db.query('select on_hand from webstore_transfers where id=$1', [transferId])).rows[0].on_hand, 3,
      'empty, missing-code, and shortage pull attempts leave stock unchanged');
    assert.equal((await db.query('select transfers_pulled from webstore_orders where id=$1', [orderId])).rows[0].transfers_pulled, false,
      'failed pull attempts do not claim the Club order');
    await db.query('update webstore_orders set transfers_pulled=true where id=$1', [orderId]);
    await expectSqlReject(() => db.query('select pull_webstore_transfers($1,$2,$3) result',
      [sid, [soId], [{ code: transferCode, qty: 2 }, { code: '1|8in|White', qty: 2 }, { code: '2|8in|White', qty: 2 }]]), /NSA_TRANSFER_PULL_RECONCILIATION_REQUIRED/i);
    await db.query('update webstore_orders set transfers_pulled=false where id=$1', [orderId]);
    const pull = (await db.query('select pull_webstore_transfers($1,$2,$3) result',
      [sid, [soId], [{ code: transferCode, qty: 2 }, { code: '1|8in|White', qty: 2 }, { code: '2|8in|White', qty: 2 }]])).rows[0].result;
    assert.equal(pull.ok, true);
    assert.equal(pull.decremented, 3, 'design plus both jersey-digit transfer rows are physically decremented');
    assert.equal(pull.stamped, 1);
    assert.equal((await db.query('select on_hand from webstore_transfers where id=$1', [transferId])).rows[0].on_hand, 1);
    const pullStamp = (await db.query('select transfers_pull_verified_at from webstore_orders where id=$1', [orderId])).rows[0].transfers_pull_verified_at;
    assert.ok(pullStamp, 'verified transfer pull is durably stamped on the Club order');
    const pullReplay = (await db.query('select pull_webstore_transfers($1,$2,$3) result',
      [sid, [soId], [{ code: transferCode, qty: 2 }, { code: '1|8in|White', qty: 2 }, { code: '2|8in|White', qty: 2 }]])).rows[0].result;
    assert.equal(pullReplay.already_pulled, true);
    assert.equal(pullReplay.decremented, 0);
    assert.equal((await db.query('select on_hand from webstore_transfers where id=$1', [transferId])).rows[0].on_hand, 1);
    await db.query('select public.pull_house_inventory($1::jsonb)', [JSON.stringify([{ product_id: productId, size: 'M', qty: 2, so_id: soId }])]);
    assert.equal((await db.query('select quantity from product_inventory where product_id=$1 and size=\'M\'', [productId])).rows[0].quantity, 0,
      'physical warehouse pull decrements the ledger only after an assigned task is confirmed');
    await db.query("update so_item_pick_lines set status='pulled' where id=$1", [pick.id]);
    await db.query("update sales_orders set status='items_received' where id=$1", [soId]);
    await capture('club_pulled_items_received', 'items_received', 50);

    const released = (await db.query(`select advance_job_stage(
      p_so_id=>$1,p_job_id=>$2,p_event=>'release',p_actor=>'pgtest') result`, [soId, job.id])).rows[0].result;
    assert.equal(released.ok, true);
    await db.query("update sales_orders set status='in_production' where id=$1", [soId]);
    await capture('club_staging_in_production', 'in_production', 50);
    await db.query("select advance_job_stage($1,$2,'start_run','pgtest')", [soId, job.id]);
    await db.query("select advance_job_stage($1,$2,'decorated','pgtest')", [soId, job.id]);
    await db.query("select advance_job_stage($1,$2,'packed','pgtest')", [soId, job.id]);
    const completedJob = (await db.query('select prod_status,completed_at,packed_at from so_jobs where so_id=$1 and id=$2', [soId, job.id])).rows[0];
    assert.equal(completedJob.prod_status, 'completed');
    assert.ok(completedJob.completed_at);
    assert.ok(completedJob.packed_at);
    await db.query('update so_jobs set fulfilled_units=total_units where so_id=$1 and id=$2', [soId, job.id]);
    await db.query("update sales_orders set status='ready_to_invoice' where id=$1", [soId]);
    await capture('club_packed_ready_to_invoice', 'ready_to_invoice', 50);

    await db.query('update webstore_order_items set shipped_qty=qty,line_status=\'shipped\' where id=$1', [itemId]);
    await db.query("update webstore_orders set status='shipped',shipped_at=now() where id=$1", [orderId]);
    const finalSo = (await db.query('select status from sales_orders where id=$1', [soId])).rows[0].status;
    assert.equal(finalSo, 'complete', 'server completion closes the SO after full shipment and completed production');
    assert.equal((await db.query('select status from webstore_orders where id=$1', [orderId])).rows[0].status, 'shipped');
    assert.equal((await db.query('select line_status,shipped_qty from webstore_order_items where id=$1', [itemId])).rows[0].line_status, 'shipped');
    await capture('club_shippedcomplete', 'complete', 50);
    if (process.env.AT_ONCE_SNAPSHOT_FILE) {
      fs.writeFileSync(path.resolve(process.env.AT_ONCE_SNAPSHOT_FILE), JSON.stringify(snapshots, null, 2));
    }
    console.log('PASS transfer pull idempotence and verification gate; job advances through packing; shipment trigger closes SO');
  } catch (error) {
    // expected negative release is asserted separately below; this catch is
    // deliberately only a safety net for the overall transaction cleanup.
    throw error;
  } finally {
    try {
      if (transactionOpen) {
        await db.exec('rollback');
        transactionOpen = false;
      }
      await assertFixtureCleared();
      console.log('PASS rollback cleanup leaves zero fake Club rows');
    } finally {
      await db.close();
    }
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
