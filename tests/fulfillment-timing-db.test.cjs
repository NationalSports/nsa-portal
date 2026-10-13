const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.FULFILLMENT_PGLITE_PATH||'@electric-sql/pglite');
test('timing migration captures real transitions and partial check-in with isolated staff access',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table so_jobs(id text primary key,so_id text,prod_status text,deco_type text,total_units integer,assigned_machine text);
 create table so_items(id integer primary key,so_id text,item_index integer,sizes jsonb);
 create table so_item_po_lines(id serial primary key,so_item_id integer,po_id text,sizes jsonb,received jsonb default '{}',cancelled jsonb default '{}',status text);
 create table audit_log(id bigserial primary key,table_name text,op text,new_data jsonb,old_data jsonb,changed_at timestamptz);
 grant select,update on so_item_po_lines to service_role;grant select on so_items to service_role;
 insert into so_jobs values('J1','SO1','staging','embroidery',24,'M1');
 insert into so_items values(1,'SO1',0,'{"M":10}');
 insert into so_item_po_lines(so_item_id,po_id,sizes,status) values(1,'P1','{"M":10,"unit_cost":20}','waiting');
 insert into audit_log(table_name,op,new_data,old_data,changed_at) values('so_jobs','UPDATE','{"id":"OLD","so_id":"SO1","prod_status":"completed","deco_type":"embroidery","total_units":10}','{"prod_status":"in_process"}',now()-interval '1 day');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261012204144_fulfillment_timing_learning.sql','utf8'));
 assert.equal((await db.query('select count(*)::integer as n from fulfillment_job_events')).rows[0].n,1);
 await db.exec("alter table so_jobs add column key text;insert into so_jobs(id,so_id,prod_status,deco_type,total_units,key) values('OUT','SO1','staging','embroidery',10,'outside_art:test');update so_jobs set prod_status='in_process';update so_jobs set prod_status='in_process';update so_jobs set prod_status='completed';");
 assert.equal((await db.query('select count(*)::integer as n from fulfillment_job_events')).rows[0].n,3);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  for(const sql of ['select * from fulfillment_job_events','select * from fulfillment_arrivals',"select record_fulfillment_arrivals('00000000-0000-4000-8000-000000000001','[]')"]){await assert.rejects(()=>db.query(sql),/permission denied/);}
  await db.exec('reset role');
 }
 const line=qty=>JSON.stringify([{so_id:'SO1',item_index:0,po_id:'P1',size:'M',qty}]);
 const record=(id,qty)=>db.query('select record_fulfillment_arrivals($1,$2)',[id,line(qty)]);
 await db.exec('set role service_role');
 await record('00000000-0000-4000-8000-000000000001',4);
 await record('00000000-0000-4000-8000-000000000001',4);
 assert.equal((await db.query('select count(*)::integer as n from fulfillment_arrivals')).rows[0].n,1);
 await record('00000000-0000-4000-8000-000000000002',6);
 await assert.rejects(()=>record('00000000-0000-4000-8000-000000000003',1),/already recorded/);
 await db.exec('reset role');
 await db.exec(`update so_item_po_lines set received='{"M":4}',status='partial';`);
 let rows=(await db.query('select * from fulfillment_arrivals order by id')).rows;
 assert(rows[0].checked_in_at);assert.equal(rows[1].checked_in_at,null);assert.equal(rows[1].received_before,4);
 await db.exec(`update so_item_po_lines set received='{"M":10}',status='received';`);
 rows=(await db.query('select * from fulfillment_arrivals order by id')).rows;assert(rows.every(r=>r.checked_in_at));
 const first=rows[0].checked_in_at;
 await db.exec(`update so_item_po_lines set status='received';`);
 assert.equal((await db.query('select checked_in_at from fulfillment_arrivals order by id')).rows[0].checked_in_at.getTime(),first.getTime());
 await db.exec(`update so_item_po_lines set received='{"M":4}',status='partial';`);
 rows=(await db.query('select * from fulfillment_arrivals order by id')).rows;assert.equal(rows[0].invalidated_at,null);assert(rows[1].invalidated_at);
 await db.exec('set role service_role');
 await assert.rejects(()=>db.query('select record_fulfillment_arrivals($1,$2)',['00000000-0000-4000-8000-000000000004',JSON.stringify([{so_id:'SO1',item_index:0,po_id:'P1',size:'unit_cost',qty:1}])]),/ordered garment size/);
 await db.close();
});
