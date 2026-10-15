// Offline proof of automatic warehouse pick-task assignment for paid native
// Club / All School sales orders. PGlite only; no live service connections.
// Run: NODE_PATH=/private/tmp/nsa-inventory-pgtest/node_modules node scripts/pgtest/verify_at_once_pick_assignment.cjs
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261011070456_auto_at_once_inventory_pick_assignment.sql'), 'utf8');
const db = new PGlite();
const eq = (actual, expected, label) => assert.equal(Number(actual), expected, label);

(async () => {
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create function public.is_team_member() returns boolean language sql stable as $$select true$$;
      create function public.all_school_garment_source_valid(integer) returns boolean language sql stable as $$select true$$;
      create table public.webstores(id uuid primary key, org_type text, source text);
      create table public.sales_orders(id text primary key, webstore_id uuid, source text, deleted_at timestamptz, status text default 'need_order', updated_at text);
      create table public.so_items(id serial primary key, so_id text not null, product_id text, sizes jsonb, source_webstore_item_ids uuid[] default '{}');
      create table public.webstore_orders(id integer primary key, store_id uuid, so_id text, order_source text, status text);
      create table public.webstore_order_items(id uuid primary key, order_id integer, product_id text, size text, qty integer, line_status text default 'pending', cancelled_qty integer not null default 0, refunded_qty integer not null default 0, is_bundle_parent boolean not null default false);
      create table public.so_item_pick_lines(id serial primary key, so_item_id integer not null, pick_id text, sizes jsonb default '{}', status text default 'pick', created_at text, memo text, ship_dest text);
      create table public.so_item_po_lines(id serial primary key, so_item_id integer not null, sizes jsonb default '{}', cancelled jsonb default '{}', status text default 'ordered');
      create table public.product_inventory(id serial primary key, product_id text, size text, quantity integer default 0, unique(product_id,size));
      create table public.teamshop_auto_po_needs(id bigserial primary key, so_id text, so_item_id integer, product_id text, size text, qty_needed integer default 0, created_at timestamptz default now());
      create table public.all_school_house_reservations(need_id bigint primary key, product_id text, size text, qty integer, so_id text);
    `);
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/00237_pull_house_inventory.sql'), 'utf8'));
    await db.exec(migration);
    console.log('PASS automatic pick-assignment migration applies to the expected schema');

    await db.exec('begin');
    await db.exec(`set app.is_staff='true'; set request.jwt.claims='{"role":"service_role"}';`);
    await db.exec(`
      insert into webstores(id,org_type) values
        ('a1111111-1111-1111-1111-111111111111','club'),
        ('a2222222-2222-2222-2222-222222222222','all_school'),
        ('a3333333-3333-3333-3333-333333333333','team');
      insert into sales_orders(id,webstore_id,source,status) values
        ('SO-CLUB-1','a1111111-1111-1111-1111-111111111111','webstore','need_order'),
        ('SO-CLUB-2','a1111111-1111-1111-1111-111111111111','webstore','need_order'),
        ('SO-AS-1','a2222222-2222-2222-2222-222222222222','webstore','need_order'),
        ('SO-NORMAL',null,'erp','need_order'),
        ('SO-UNCONVERTED','a1111111-1111-1111-1111-111111111111','webstore','need_order'),
        ('SO-PO','a1111111-1111-1111-1111-111111111111','webstore','need_order'),
        ('SO-DECLINED','a1111111-1111-1111-1111-111111111111','webstore','need_order'),
        ('SO-SOURCE','a1111111-1111-1111-1111-111111111111','webstore','need_order'),
        ('SO-SOURCE-QTY','a1111111-1111-1111-1111-111111111111','webstore','need_order'),
        ('SO-CLUB-QTY-LEGACY','a1111111-1111-1111-1111-111111111111','webstore','need_order'),
        ('SO-OMG-STORE','a4444444-4444-4444-4444-444444444444','webstore','need_order');
      insert into webstore_orders(id,store_id,so_id,order_source,status) values
        (1,'a1111111-1111-1111-1111-111111111111','SO-CLUB-1',null,'paid'),
        (2,'a1111111-1111-1111-1111-111111111111','SO-CLUB-2',null,'paid'),
        (3,'a2222222-2222-2222-2222-222222222222','SO-AS-1','all_school','batched'),
        (4,'a1111111-1111-1111-1111-111111111111','SO-DECLINED',null,'declined'),
        (5,'a1111111-1111-1111-1111-111111111111','SO-PO',null,'paid'),
        (6,'a1111111-1111-1111-1111-111111111111','SO-UNCONVERTED',null,'paid'),
        (7,'a3333333-3333-3333-3333-333333333333',null,'teamshop','paid'),
        (8,'a1111111-1111-1111-1111-111111111111','SO-SOURCE',null,'paid'),
        (9,'a1111111-1111-1111-1111-111111111111','SO-SOURCE-QTY',null,'paid'),
        (10,'a1111111-1111-1111-1111-111111111111','SO-CLUB-QTY-LEGACY',null,'paid'),
        (11,'a4444444-4444-4444-4444-444444444444','SO-OMG-STORE','club','paid');
      insert into webstores(id,org_type,source) values ('a4444444-4444-4444-4444-444444444444','club','omg');
      insert into so_items(so_id,product_id,sizes) values
        ('SO-CLUB-1','P-AUTO','{"M":5}'), ('SO-CLUB-2','P-AUTO','{"M":5}'),
        ('SO-AS-1','P-RESERVED','{"L":4}'), ('SO-NORMAL','P-NORMAL','{"S":5}'),
        ('SO-UNCONVERTED','P-UNCONVERTED','{"XL":2}'), ('SO-PO','P-PO','{"M":4}'),
        ('SO-CLUB-QTY-LEGACY','P-LEGACY-QTY','{"M":2}'), ('SO-OMG-STORE','P-OMG','{"M":1}'),
        ('SO-DECLINED','P-DECLINED','{"M":5}');
      insert into so_items(so_id,product_id,sizes,source_webstore_item_ids)
        values('SO-SOURCE','P-SOURCE','{"M":1}',array['a5555555-5555-5555-5555-555555555555'::uuid]),
              ('SO-SOURCE-QTY','P-SOURCE-QTY','{"M":2}',array['a6666666-6666-6666-6666-666666666666'::uuid]);
      insert into product_inventory(product_id,size,quantity) values
        ('P-AUTO','M',3), ('P-RESERVED','L',5), ('P-NORMAL','S',4),
        ('P-UNCONVERTED','XL',5), ('P-PO','M',4), ('P-DECLINED','M',5), ('P-SOURCE','M',1), ('P-SOURCE-QTY','M',2),
        ('P-LEGACY-QTY','M',2), ('P-OMG','M',1);
      insert into so_item_pick_lines(so_item_id,pick_id,sizes,status)
        select id,'IF-MANUAL','{"S":2}','pick' from so_items where so_id='SO-NORMAL';
      insert into webstore_order_items(id,order_id,product_id,size,qty,line_status)
        values ('a4444444-4444-4444-4444-444444444444',7,'P-UNCONVERTED','XL',2,'pending');
      insert into webstore_order_items(id,order_id,product_id,size,qty,line_status)
        values ('a5555555-5555-5555-5555-555555555555',8,'P-SOURCE-WRONG','M',1,'refunded');
      insert into webstore_order_items(id,order_id,product_id,size,qty,line_status,cancelled_qty)
        values ('a6666666-6666-6666-6666-666666666666',9,'P-SOURCE-QTY','M',2,'pending',1);
      insert into webstore_order_items(id,order_id,product_id,size,qty,line_status,cancelled_qty)
        values ('a7777777-7777-7777-7777-777777777777',10,'P-LEGACY-QTY','M',2,'pending',1);
      insert into webstore_order_items(id,order_id,product_id,size,qty,line_status) values
        ('a8888888-8888-8888-8888-888888888888',1,'P-AUTO','M',5,'pending'),
        ('a9999999-9999-9999-9999-999999999999',2,'P-AUTO','M',5,'pending'),
        ('abbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',5,'P-PO','M',4,'pending'),
        ('accccccc-cccc-cccc-cccc-cccccccccccc',6,'P-UNCONVERTED','XL',2,'pending');
      insert into webstore_order_items(id,order_id,product_id,size,qty,line_status,is_bundle_parent)
        values ('addddddd-dddd-dddd-dddd-dddddddddddd',1,'P-AUTO','M',99,'pending',true);
      insert into so_item_po_lines(so_item_id,sizes,cancelled,status)
        select id,'{"M":3}','{"M":1}','ordered' from so_items where so_id='SO-PO';
      insert into teamshop_auto_po_needs(so_id,so_item_id,product_id,size,qty_needed)
        select 'SO-AS-1',id,'P-RESERVED','L',4 from so_items where so_id='SO-AS-1';
      insert into all_school_house_reservations(need_id,product_id,size,qty,so_id)
        values (1,'P-RESERVED','L',3,'SO-AS-1');
    `);

    let result = (await db.query("select assign_at_once_inventory_picks('SO-CLUB-1') as r")).rows[0].r;
    assert.equal(result.ok, true);
    eq(result.created_lines, 1, 'Club creates one size line');
    eq(result.assigned_units, 3, 'Club assignment is capped by unreserved on-hand');
    let row = (await db.query(`select pk.sizes,pk.status,pk.pick_id from so_item_pick_lines pk join so_items i on i.id=pk.so_item_id where i.so_id='SO-CLUB-1'`)).rows[0];
    assert.equal(row.status, 'pick', 'assignment is not physical pull confirmation');
    assert.match(row.pick_id, /^IF-AUTO-[0-9a-f]{32}$/);
    const firstPickId = row.pick_id;
    assert.deepEqual(row.sizes, { M: 3 });
    eq((await db.query("select quantity from product_inventory where product_id='P-AUTO'")).rows[0].quantity, 3, 'assignment does not decrement physical stock');

    result = (await db.query("select assign_at_once_inventory_picks('SO-CLUB-1') as r")).rows[0].r;
    eq(result.created_lines, 0, 'replay creates no duplicate tasks');
    eq((await db.query("select count(*) n from so_item_pick_lines pk join so_items i on i.id=pk.so_item_id where i.so_id='SO-CLUB-1'")).rows[0].n, 1, 'replay retains one pick line');
    await db.query(`update so_item_pick_lines set sizes='{"m":3}' where pick_id=$1`, [firstPickId]);
    await db.query('select pull_house_inventory($1::jsonb)', [JSON.stringify([{ product_id: 'P-AUTO', size: 'M', qty: 3, so_id: 'SO-CLUB-1' }])]);
    await db.query("update so_item_pick_lines set status='pulled' where pick_id=$1", [firstPickId]);
    eq((await db.query("select quantity from product_inventory where product_id='P-AUTO'")).rows[0].quantity, 0, 'physical pull alone decrements the stock ledger');
    await db.query("update product_inventory set quantity=2 where product_id='P-AUTO' and size='M'");
    result = (await db.query("select assign_at_once_inventory_picks('SO-CLUB-1') as r")).rows[0].r;
    eq(result.assigned_units, 2, 'later receipt fills only the remaining backorder quantity');
    const secondPick = (await db.query("select pick_id,sizes,status from so_item_pick_lines where so_item_id=(select id from so_items where so_id='SO-CLUB-1') and status='pick'")).rows[0];
    assert.notEqual(secondPick.pick_id, firstPickId, 'restock assignment receives a fresh pull id');
    assert.deepEqual(secondPick.sizes, { M: 2 }, 'one row carries all assigned sizes for the item');
    await db.query('select pull_house_inventory($1::jsonb)', [JSON.stringify([{ product_id: 'P-AUTO', size: 'M', qty: 2, so_id: 'SO-CLUB-1' }])]);
    await db.query("update so_item_pick_lines set status='pulled' where pick_id=$1", [secondPick.pick_id]);
    eq((await db.query("select quantity from product_inventory where product_id='P-AUTO'")).rows[0].quantity, 0, 'the second pull consumes replenished stock rather than replaying the first pull');
    result = (await db.query("select assign_at_once_inventory_picks('SO-CLUB-2') as r")).rows[0].r;
    eq(result.assigned_units, 0, 'second Club order cannot steal stock reserved by first pending pick');
    result = (await db.query("select assign_at_once_inventory_picks('SO-DECLINED') as r")).rows[0].r;
    assert.equal(result.reason, 'not_eligible', 'declined order is not assigned');
    result = (await db.query("select assign_at_once_inventory_picks('SO-OMG-STORE') as r")).rows[0].r;
    assert.equal(result.reason, 'not_eligible', 'OMG store source is not assigned');

    result = (await db.query("select assign_at_once_inventory_picks('SO-AS-1') as r")).rows[0].r;
    eq(result.assigned_units, 4, 'All School can reuse its own reservation and free stock');
    eq((await db.query("select qty from all_school_house_reservations where need_id=1")).rows[0].qty, 3, 'gross planner reservation remains durable');
    eq((await db.query("select quantity from product_inventory where product_id='P-RESERVED'")).rows[0].quantity, 5, 'All School assignment leaves stock untouched');

    result = (await db.query("select assign_at_once_inventory_picks('SO-NORMAL') as r")).rows[0].r;
    eq(result.assigned_units, 0, 'native pick assignment does not touch ordinary ERP orders');
    result = (await db.query("select assign_at_once_inventory_picks('SO-PO') as r")).rows[0].r;
    eq(result.assigned_units, 2, 'PO-covered quantities are excluded from automatic picks');
    result = (await db.query("select assign_at_once_inventory_picks('SO-UNCONVERTED') as r")).rows[0].r;
    eq(result.assigned_units, 2, 'paid unconverted non-native checkout demand retains stock priority');

    await db.exec('savepoint bad_source');
    await assert.rejects(() => db.query("select assign_at_once_inventory_picks('SO-SOURCE')"), /NSA_SOURCE_LINE_CHANGED/i,
      'refunded and product-mismatched source rows reject assignment');
    await db.exec('rollback to savepoint bad_source; release savepoint bad_source');
    await db.exec('savepoint bad_source_qty');
    await assert.rejects(() => db.query("select assign_at_once_inventory_picks('SO-SOURCE-QTY')"), /NSA_SOURCE_QTY_CHANGED/i,
      'active source quantity mismatches the immutable SO snapshot');
    await db.exec('rollback to savepoint bad_source_qty; release savepoint bad_source_qty');
    await db.exec('savepoint bad_legacy_source_qty');
    await assert.rejects(() => db.query("select assign_at_once_inventory_picks('SO-CLUB-QTY-LEGACY')"), /NSA_SOURCE_QTY_CHANGED/i,
      'Club source quantities are validated from linked order/product when snapshot has no source IDs');
    await db.exec('rollback to savepoint bad_legacy_source_qty; release savepoint bad_legacy_source_qty');

    const changed = (await db.query("select count(*)::int n from sales_orders where updated_at is not null")).rows[0].n;
    eq(changed, 5, 'each eligible native SO is touched; rejected source remains unchanged');
    await db.exec('rollback');
    const remaining = (await db.query(`select
      (select count(*)::int from so_item_pick_lines) picks,
      (select count(*)::int from all_school_house_reservations) reservations,
      (select count(*)::int from sales_orders) orders,
      (select sum(quantity)::int from product_inventory) inventory`)).rows[0];
    for (const [key, value] of Object.entries(remaining)) eq(value, 0, `rollback cleans fake ${key}`);
    console.log('PASS native Club / All School assignment, replay, PO and reservation coverage, non-native stock priority, no decrement, and rollback cleanup');
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
