// End-to-end database flow using the actual reservation, conversion and consumption routines.
const fs=require('fs'),assert=require('assert/strict'),{PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(p,'utf8');const id=()=>require('crypto').randomUUID();
(async()=>{
 const db=new PGlite();
 await db.exec(read('e2e/pipeline/seed.sql').split('-- Reference / seed data')[0].replace(/^\\.*$/gm,''));
 await db.exec(`create or replace function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('role','service_role')$$;
 alter table webstore_orders add column order_source text;
 alter table webstore_products add column transfer_code text,add column image_url text,add column sku text,add column display_name text;
 alter table products add column available_sizes jsonb;
 alter table webstore_transfers add column unit_cost numeric;
 alter table so_jobs add column digitizing_needed boolean,add column dtf_prints_status text,add column notes text;
 create table job_stage_events(id bigserial,so_id text,job_id text,event text,from_state jsonb,to_state jsonb,actor text,source text,payload jsonb);
 create table product_inventory(id serial primary key,product_id text,size text,quantity integer,alert_threshold integer,unique(product_id,size));
 create table so_item_pick_lines(id serial,so_item_id integer,pick_id text,sizes jsonb,status text);
 set app.is_staff='true';`);
 for(const f of ['20261002183605_all_school_store_foundation.sql','20261002183729_all_school_order_conversion.sql','00193_purchase_orders.sql','00237_pull_house_inventory.sql','00239_merge_product_inventory.sql']) await db.exec(read('supabase/migrations/'+f));
 await db.exec(`alter table purchase_orders add column all_school_store_id uuid,add column submission_state text;`);
 await db.exec(read('supabase/migrations/20261008142755_store_inventory_purchase_costs.sql'));
 const store=id(),wp=id(),order=id(),artA=id(),artB=id(),sourceA=id(),sourceB=id();
 await db.exec(`insert into team_members(id,name,role) values('REP','Rep','rep');insert into customers(id,name,primary_rep_id) values('C','School','REP');insert into products(id,sku,name,brand,color,retail_price,nsa_cost,available_sizes) values('P','HOOD','Hood','Nike','Royal',40,20,'["M"]')`);
 await db.query(`insert into webstores(id,slug,name,org_type,customer_id,delivery_mode) values($1,'inventory-e2e','School','all_school','C','ship_home')`,[store]);
 await db.query(`insert into webstore_products(id,store_id,product_id,sku) values($1,$2,'P','HOOD')`,[wp,store]);
 for(const [tid,code] of [[artA,'SCRIPT'],[artB,'BLOCK']]) await db.query(`insert into webstore_transfers(id,store_id,code,label,kind,on_hand,decoration_type,application_method) values($1,$2,$3,$3,'design',0,'dtf','heat_press')`,[tid,store,code]);
 const rpc=async(name,args)=> (await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 const po=await rpc('create_store_inventory_po',[store,id(),'Supplier',JSON.stringify([{transfer_id:artA,qty:100,unit_cost_cents:300},{transfer_id:artB,qty:100,unit_cost_cents:500},{webstore_product_id:wp,size:'M',qty:100,unit_cost_cents:1000}])]);
 const lines=(await db.query('select * from purchase_order_lines where po_id=$1',[po.purchase_order.id])).rows;
 for(const l of lines) await rpc('receive_store_inventory_po',[l.id,id(),l.qty,l.unit_cost_cents/100]);
 const recipe=code=>({webstore_product_id:wp,product_id:'P',sku:'HOOD',decorations:[],transfer_codes:[code],transfer_inventory:[{code,label:code,unit_cost:999,decoration_type:'dtf',application_method:'heat_press',width_in:4,height_in:4,production_file:{path:'mock/production.ai'}}],takes_name:false,takes_number:false,mock_approval:{approved:true}});
 await db.query(`insert into webstore_orders(id,store_id,status,order_source,subtotal,total) values($1,$2,'paid','all_school',160,160)`,[order,store]);
 for(const [src,code] of [[sourceA,'SCRIPT'],[sourceB,'BLOCK']]) await db.query(`insert into webstore_order_items(id,order_id,product_id,sku,size,qty,unit_price,unit_fundraise,production_recipe,line_status) values($1,$2,'P','HOOD','M',2,40,0,$3,'pending')`,[src,order,recipe(code)]);
 const so=await rpc('create_all_school_sales_order',[order]);assert.equal(so.items,2);
 let decos=(await db.query(`select transfer_code,cost_each,inventory_cost_missing from so_item_decorations where transfer_code is not null order by transfer_code`)).rows;
 assert.deepEqual(decos.map(d=>[d.transfer_code,Number(d.cost_each),d.inventory_cost_missing]),[['BLOCK',5,false],['SCRIPT',3,false]]);
 // Source recipe's stale $999 cost must not override the received $3/$5 costs.
 await rpc('consume_all_school_decorations',[order]);await rpc('consume_all_school_decorations',[order]);
 assert.deepEqual((await db.query('select on_hand from webstore_transfers order by code')).rows.map(r=>r.on_hand),[98,98]);
 const items=(await db.query('select * from so_items where so_id=$1 order by item_index',[so.so_id])).rows;
 const pulls=items.map(it=>({product_id:'P',size:'M',qty:2,so_id:so.so_id,pick_id:'IF-E2E',source_item_ids:it.source_webstore_item_ids}));
 await rpc('pull_store_inventory',[JSON.stringify(pulls)]);await rpc('pull_store_inventory',[JSON.stringify(pulls)]);
 assert.equal((await db.query('select quantity from product_inventory')).rows[0].quantity,96);
 for(const it of items) await db.query(`insert into so_item_pick_lines(so_item_id,pick_id,status,sizes) values($1,'IF-E2E','pulled','{"M":2}')`,[it.id]);
 // A stale catalog tab with base=100 must not overwrite the receipt/pull result.
 await rpc('merge_product_inventory',['P',JSON.stringify([{size:'M',quantity:100,base:100}])]);
 assert.equal((await db.query('select quantity from product_inventory')).rows[0].quantity,96);
 // Simulate save/rebuild of child rows without losing receipt cost links.
 await db.exec(`update so_item_pick_lines set sizes='{"M":2}'; update so_item_decorations set cost_each=0;`);
 const picks=(await db.query('select sizes from so_item_pick_lines')).rows.map(r=>r.sizes._inventory_costs.M);
 assert.deepEqual(picks.map(p=>p.qty*Number(p.unit_cost)),[20,20]);assert(picks.every(p=>p.receipt_ids.length===1));
 decos=(await db.query(`select cost_each,inventory_cost_basis from so_item_decorations where transfer_code is not null order by transfer_code`)).rows;
 assert.deepEqual(decos.map(d=>Number(d.cost_each)*2),[10,6]);assert(decos.every(d=>d.inventory_cost_basis[0].received&&d.inventory_cost_basis[0].receipt_ids.length===1));
 console.log('PASS end-to-end: 100-unit POs → receipts → two-logo paid order → separate SO lines → consume 4 garments/4 logos → $40 garment cost + $16 decoration cost; replay and stale-save protections');
 await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
