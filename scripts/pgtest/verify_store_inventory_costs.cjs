// NODE_PATH=/private/tmp/nsa-inventory-pgtest/node_modules node scripts/pgtest/verify_store_inventory_costs.cjs
// Isolated PostgreSQL engine; never connects to production.
const fs = require('fs'), assert = require('assert'), { PGlite } = require('@electric-sql/pglite');
(async () => {
 const db = new PGlite();
 await db.exec(fs.readFileSync('e2e/pipeline/seed.sql','utf8').split('-- Reference / seed data')[0].replace(/^\\.*$/gm,''));
 await db.exec(`create or replace function auth.jwt() returns jsonb language sql as $$ select jsonb_build_object('role',coalesce(current_setting('request.jwt.claim.role',true),'')) $$;
 alter table so_items add column source_webstore_item_ids uuid[];alter table products add column available_sizes jsonb;
 alter table webstore_products add column if not exists display_name text;alter table webstore_products add column sku text;
 alter table webstore_transfers add column unit_cost numeric,add column decoration_type text,add column application_method text,add column artwork_version text,add column width_in numeric,add column height_in numeric,add column application_instructions text,add column production_file jsonb;
 create table product_inventory(id serial primary key,product_id text,size text,quantity integer,unique(product_id,size));
 create table so_item_pick_lines(id serial,so_item_id integer,pick_id text,sizes jsonb,status text);
 create table all_school_decoration_allocations(id bigserial primary key,store_id uuid,order_id uuid,order_item_id uuid,transfer_code text,required_qty integer,reserved_qty integer,consumed_qty integer,status text);
 set app.is_staff='true';`);
 await db.exec(fs.readFileSync('supabase/migrations/00193_purchase_orders.sql','utf8'));
 await db.exec(`alter table purchase_orders add column all_school_store_id uuid;alter table purchase_orders add column submission_state text default 'pending';`);
 await db.exec(fs.readFileSync('supabase/migrations/00237_pull_house_inventory.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261008142755_store_inventory_purchase_costs.sql','utf8'));
 const sid='10000000-0000-0000-0000-000000000001',tid='20000000-0000-0000-0000-000000000001',wp='30000000-0000-0000-0000-000000000001',oi='40000000-0000-0000-0000-000000000001';
 await db.exec(`insert into webstores(id,slug,name,org_type) values('${sid}','cost-test','Cost test','all_school');insert into products(id,sku,name,available_sizes) values('P','HOOD','Hood','["M","L"]');insert into webstore_products(id,store_id,product_id,sku) values('${wp}','${sid}','P','HOOD');insert into webstore_transfers(id,store_id,code,label,kind,on_hand) values('${tid}','${sid}','LOGO','Logo','design',0);insert into sales_orders(id) values('SO-TEST');insert into so_items(so_id,item_index,product_id,sku,sizes,source_webstore_item_ids) values('SO-TEST',0,'P','HOOD','{"M":2}',array['${oi}'::uuid]);`);
 const rpc=async(sql,params=[]) => (await db.query(sql,params)).rows[0]?.result;
 const id=()=>require('crypto').randomUUID();
 const request=id(); const body=[{transfer_id:tid,qty:100,unit_cost_cents:300},{webstore_product_id:wp,size:'M',qty:20,unit_cost_cents:1000}];
 const po=await rpc('select create_store_inventory_po($1,$2,$3,$4) result',[sid,request,'Supplier',JSON.stringify(body)]);
 const again=await rpc('select create_store_inventory_po($1,$2,$3,$4) result',[sid,request,'Supplier',JSON.stringify(body)]);assert.equal(again.purchase_order.id,po.purchase_order.id);
 const lines=(await db.query('select * from purchase_order_lines where po_id=$1 order by sku',[po.purchase_order.id])).rows;
 const garment=lines.find(l=>l.product_id),deco=lines.find(l=>!l.product_id);const receipt=id();
 await rpc('select receive_store_inventory_po($1,$2,60,3) result',[deco.id,receipt]);
 await rpc('select receive_store_inventory_po($1,$2,60,3) result',[deco.id,receipt]);
 assert.equal((await db.query('select on_hand from webstore_transfers')).rows[0].on_hand,60);
 await assert.rejects(()=>rpc('select receive_store_inventory_po($1,$2,41,3) result',[deco.id,id()]),/exceeds/);
 await rpc('select receive_store_inventory_po($1,$2,40,5) result',[deco.id,id()]);
 assert.equal(Number((await db.query('select unit_cost from webstore_transfers')).rows[0].unit_cost),3.8);
 await rpc('select receive_store_inventory_po($1,$2,20,10) result',[garment.id,id()]);
 assert.equal((await db.query('select quantity from product_inventory')).rows[0].quantity,20);
 const item=(await db.query('select id from so_items')).rows[0].id;
 const pull=[{product_id:'P',size:'M',qty:2,so_id:'SO-TEST',pick_id:'PICK-1',source_item_ids:[oi]}];
 await rpc('select pull_store_inventory($1) result',[JSON.stringify(pull)]);
 await rpc('select pull_store_inventory($1) result',[JSON.stringify(pull)]);
 assert.equal((await db.query('select quantity from product_inventory')).rows[0].quantity,18);

 await db.query(`insert into so_item_pick_lines(so_item_id,pick_id,status,sizes) values($1,'PICK-1','pulled','{"M":2}')`,[item]);
 let basis=(await db.query('select sizes from so_item_pick_lines')).rows[0].sizes._inventory_costs.M;
 assert.equal(Number(basis.unit_cost)*basis.qty,20);
 await db.exec(`update product_inventory set received_unit_cost=99;update so_item_pick_lines set sizes='{"M":2}';`);
 basis=(await db.query('select sizes from so_item_pick_lines')).rows[0].sizes._inventory_costs.M;assert.equal(Number(basis.unit_cost),10);
 await db.exec(`insert into all_school_decoration_allocations(store_id,order_item_id,transfer_code,required_qty,reserved_qty,consumed_qty,status) values('${sid}','${oi}','LOGO',2,2,2,'consumed');`);
 await db.query(`insert into so_item_decorations(so_item_id,deco_index,kind,transfer_code,cost_each) values($1,0,'art','LOGO',0)`,[item]);
 let d=(await db.query('select * from so_item_decorations')).rows[0];assert.equal(Number(d.cost_each)*2,7.6);assert.equal(d.inventory_cost_missing,false);
 await db.exec(`update webstore_transfers set unit_cost=100;update so_item_decorations set cost_each=0;`);
 d=(await db.query('select * from so_item_decorations')).rows[0];assert.equal(Number(d.cost_each)*2,7.6);

 // An explicit zero cost is valid; unknown opening stock blocks receipt atomically.
 const p2=await rpc('select create_store_inventory_po($1,$2,$3,$4) result',[sid,id(),'Supplier',JSON.stringify([{webstore_product_id:wp,size:'l',qty:5,unit_cost_cents:0}])]);
 const l2=(await db.query('select * from purchase_order_lines where po_id=$1',[p2.purchase_order.id])).rows[0];assert.equal(l2.size,'L');
 await db.exec(`insert into product_inventory(product_id,size,quantity) values('P','L',2)`);
 await assert.rejects(()=>rpc('select receive_store_inventory_po($1,$2,2,0) result',[l2.id,id()]),/existing stock/);
 assert.equal(Number((await db.query('select count(*) n from store_inventory_receipts where po_line_id=$1',[l2.id])).rows[0].n),0);
 await db.query('select set_store_opening_inventory_cost($1,$2,$3,0)',[sid,'P','L']);
 await rpc('select receive_store_inventory_po($1,$2,2,0) result',[l2.id,id()]);
 assert.equal(Number((await db.query("select received_unit_cost from product_inventory where size='L'")).rows[0].received_unit_cost),0);
 await db.query('select close_store_inventory_po($1)',[p2.purchase_order.id]);
 await assert.rejects(()=>rpc('select receive_store_inventory_po($1,$2,1,0) result',[l2.id,id()]),/Open inventory PO/);
 await assert.rejects(()=>rpc('select receive_store_inventory_po($1,$2,59,3) result',[deco.id,receipt]),/does not match/);
 assert.equal((await db.query('select submission_state from purchase_orders where id=$1',[po.purchase_order.id])).rows[0].submission_state,'inventory_received');
 // Distinct logo rows share stock, but their consumption records cannot collide.
 const oi2='40000000-0000-0000-0000-000000000002';
 await db.query(`insert into so_items(so_id,item_index,product_id,sku,sizes,source_webstore_item_ids) values('SO-TEST',1,'P','HOOD','{"M":2}',array[$1::uuid])`,[oi2]);
 await rpc('select pull_store_inventory($1) result',[JSON.stringify([{...pull[0],source_item_ids:[oi2]}])]);
 assert.equal((await db.query("select quantity from product_inventory where size='M'")).rows[0].quantity,16);
 assert.equal(Number((await db.query("select count(*) n from store_inventory_cost_snapshots where source_key like 'pick:%' and stock_pulled")).rows[0].n),2);
 await db.exec(`set app.is_staff='false';`);
 await assert.rejects(()=>rpc('select receive_store_inventory_po($1,$2,1,0) result',[deco.id,id()]),/Staff access/);
 assert.equal((await db.query("select has_function_privilege('anon','public.receive_store_inventory_po(uuid,uuid,integer,numeric)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS: migration, PO retry, partial receipt, receipt replay, overreceipt, weighted actual cost, consumed quantities, snapshot preservation, staff authorization');
 await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
