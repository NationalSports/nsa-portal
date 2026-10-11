// PGLITE_MODULE=/path/to/@electric-sql/pglite node scripts/test-store-closeout-sql.cjs
// Isolated PostgreSQL; no production credentials or writes.
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
const db=new PGlite();
await db.exec(`
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create function auth.role() returns text language sql as $$select 'service_role'::text$$;
create function is_team_member() returns boolean language sql as $$select true$$;
create table team_members(id text primary key,is_active boolean);insert into team_members values('rep',true);
create table customers(id text primary key,payment_terms text,primary_rep_id text);insert into customers values('C','net30','rep');
create table sales_orders(id text primary key,customer_id text,source text,webstore_id uuid,omg_store_id text,deleted_at timestamptz,
  _version bigint default 1,created_at text default '2026-09-01',created_by text default 'rep',rep_id text,memo text,status text default 'need_order',deco_pos jsonb default '[]',
  _omg_processing numeric,_omg_tax numeric,_omg_shipping numeric,_omg_cc_fees numeric,_webstore_fundraise numeric,_omg_acct_collected numeric);
create function increment_version() returns trigger language plpgsql as $$begin new._version=old._version+1;return new;end$$;
create trigger trg_sales_orders_version before update on sales_orders for each row execute function increment_version();
create table omg_stores(id text primary key,_omg_acct_collected numeric,_omg_sale_code text);
create table webstore_orders(id uuid primary key,store_id uuid,so_id text,backorder_of uuid,status text,payment_mode text,original_total numeric,total numeric,refunded_amt numeric,
  subtotal numeric,fundraise_amt numeric,discount_amt numeric,tax numeric,processing_fee numeric,shipping_fee numeric,cc_fee numeric);
create table so_items(id serial primary key,so_id text,item_index int,sku text,name text,color text,unit_sell numeric,est_qty numeric,sizes jsonb);
create table so_jobs(id text,so_id text,key text,prod_status text);
create table so_item_decorations(so_item_id int,kind text,fulfillment text,deco_po_id text);
create table invoices(id text primary key,so_id text,customer_id text,idempotency_key text unique,type text,inv_type text,date text,due_date text,total numeric,paid numeric,status text,memo text,
  tax numeric,tax_rate numeric,tax_exempt boolean,shipping numeric,line_items jsonb,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz);
create table invoice_items(invoice_id text,sku text,name text,qty int,unit_price numeric,total numeric,description text);
create table invoice_payments(id serial primary key,invoice_id text,amount numeric,method text,ref text,date text,cc_fee numeric,receipt_id text,unique(invoice_id,ref));
create table payment_receipts(id text primary key,customer_id text,amount numeric,reconciliation_hold boolean default false,ns_applications jsonb default '[]');
create table invoice_payment_unapplications(invoice_id text);
create table customer_credits(id text primary key,customer_id text,amount numeric,used numeric,is_fundraise boolean,source text,created_by text,created_at timestamptz);
create table assigned_todos(id text primary key,title text,description text,created_by text,assigned_to text,so_id text,customer_id text,priority int,status text,due_date date,created_at timestamptz,updated_at timestamptz,completed_at timestamptz,completed_by text,completion_note text);
create table commission_snapshots(so_id text,invoice_id text);
create function public.scan_webstore_integrity() returns bigint language sql as $$
  select count(*) from public.sales_orders s
  where s.source = 'webstore' and s.webstore_id is not null
    and exists (select 1 from public.webstore_orders o where o.so_id = s.id)
$$;
grant all on all tables in schema public to service_role,authenticated;
grant usage,select on all sequences in schema public to service_role,authenticated;
`);
// Load the actual converter definitions to verify migration compatibility, not a mock.
await db.exec('create table webstores(id uuid primary key)');
for(const [path,name] of [['supabase/migrations/20260902063000_club_money_and_bundle_allocation.sql','create_club_sales_order'],['supabase/migrations/20261002183729_all_school_order_conversion.sql','create_all_school_sales_order']]){
  // Latest Club definition may be selected by the source scan below.
  let file=path;
  if(name==='create_club_sales_order')file=fs.readdirSync('supabase/migrations').filter(f=>fs.readFileSync('supabase/migrations/'+f,'utf8').toLowerCase().includes('create or replace function public.create_club_sales_order(')).sort().map(f=>'supabase/migrations/'+f).pop();
  const source=fs.readFileSync(file,'utf8');const start=source.toLowerCase().indexOf('create or replace function public.'+name+'(');
  const finish=source.indexOf('end $$;',start)+7;
  assert(finish>start);await db.exec(source.slice(start,finish));
}
await db.exec(fs.readFileSync('supabase/migrations/20261011065626_store_closeout.sql','utf8'));
for(const name of ['create_club_sales_order','create_all_school_sales_order']){
  const def=(await db.query('select pg_get_functiondef(($1)::regprocedure) d',[name+'(uuid)'])).rows[0].d;
  assert(def.includes('if false then -- Invoice and payment deferred to Close Store.'));
  assert(!def.includes('if not exists (select 1 from invoices where so_id = v_so_id) then'));
}

const id='00000000-0000-0000-0000-000000000001';
const close=async(so,version=null,costs=true,shipped=true,invoice={total:100,shipping:0,line_items:[{desc:'Shirts',_sku:'TEE',_name:'Shirts',qty:2,rate:50,amount:100}]})=>(await db.query('select close_store($1,$2,\'rep\',$3,$4,$5) r',[so,version??(await db.query('select _version from sales_orders where id=$1',[so])).rows[0]._version,costs,shipped,invoice])).rows[0].r;
const batch=async()=> (await db.query('select finalize_webstore_batch(\'W\',array[$1::uuid]) r',[id])).rows[0].r;
await db.exec(`insert into sales_orders(id,customer_id,source,webstore_id) values('W','C','webstore','${id}');
insert into so_items(so_id,item_index,sku,name,unit_sell,est_qty,sizes) values('W',0,'TEE','Shirts',50,2,'{"M":2}');
insert into webstore_orders(id,store_id,status,payment_mode,total,subtotal,tax,shipping_fee,processing_fee,cc_fee) values('${id}','${id}','paid','paid',115,100,5,8,2,3);`);
await db.exec('set role service_role');
let r=await batch();assert(r.ok);assert.equal(r.invoice_id,null);assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n,0);
assert.equal(Number((await db.query('select scan_webstore_integrity() n')).rows[0].n),0);
assert.equal((await db.query("select due_date::text d from assigned_todos where so_id='W'")).rows[0].d,'2026-10-06');
await assert.rejects(close('W',1,false),/Confirm all costs/);
await assert.rejects(close('W',9),/changed/);
await db.exec("insert into so_jobs values('J','W','art','in_process')");
assert.equal((await db.query("select count(*)::int n from assigned_todos where so_id='W'")).rows[0].n,0);
await assert.rejects(close('W'),/Finish all production/);
const reviewedVersion=(await db.query("select _version from sales_orders where id='W'")).rows[0]._version;
await db.exec("update so_jobs set prod_status='shipped';update webstore_orders set status='shipped'");
await assert.rejects(close('W',reviewedVersion),/changed/);
const costVersion=(await db.query("select _version from sales_orders where id='W'")).rows[0]._version;
await db.exec("update so_items set name='Reviewed shirts' where so_id='W'");
await assert.rejects(close('W',costVersion),/changed/);
r=await close('W');assert(r.ok);assert.equal(Number(r.invoice.total),115);assert.equal(Number(r.invoice.paid),115);assert.equal(r.payments.length,1);
assert.equal((await db.query('select status from webstore_orders')).rows[0].status,'shipped');
assert.equal(Number((await db.query('select scan_webstore_integrity() n')).rows[0].n),1);
const repeated=await close('W',0);assert(repeated.already_closed);assert.equal(repeated.invoice.id,r.invoice.id);assert.equal(repeated.payments.length,1);
await batch();assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n,1);
await db.exec("insert into omg_stores values('OMG-O',100,'O');insert into sales_orders(id,customer_id,omg_store_id) values('O','C','OMG-O')");
await assert.rejects(db.exec("insert into invoices(id,so_id) values('bad','O')"),/Use Close Store/);
await assert.rejects(db.exec("insert into commission_snapshots values('O','bad')"),/all costs recorded/);
await db.exec("insert into payment_receipts(id,customer_id,amount) values('R','C',100)");
await assert.rejects(close('O'),/unapplied or held/);
await db.exec("delete from payment_receipts where id='R'");
r=await close('O');assert.equal(r.payments.length,1);assert.equal(Number(r.invoice.paid),100);assert.equal(r.payments[0].ref,'OMG O');
await close('O');assert.equal((await db.query("select count(*)::int n from invoice_payments where ref='OMG O'")).rows[0].n,1);
await db.exec("insert into commission_snapshots values('O','ok')");
// Legacy invoices are reused, but inconsistent/duplicate accounting is not guessed.
await db.exec('reset role');
await db.exec("alter table invoices disable trigger guard_store_invoice;insert into omg_stores values('OMG-L',100,'L');insert into sales_orders(id,customer_id,omg_store_id) values('L','C','OMG-L');insert into invoices(id,so_id,customer_id,total,paid,status) values('LEGACY','L','C',100,0,'open');alter table invoices enable trigger guard_store_invoice");
await db.exec('set role service_role');r=await close('L');assert.equal(r.invoice.id,'LEGACY');assert.equal(Number(r.invoice.paid),100);
await db.exec('reset role');
await db.exec("alter table invoices disable trigger guard_store_invoice;insert into omg_stores values('OMG-D',100,'D');insert into sales_orders(id,customer_id,omg_store_id) values('D','C','OMG-D');insert into invoices(id,so_id,total,paid,status) values('D1','D',100,0,'open'),('D2','D',100,0,'open');alter table invoices enable trigger guard_store_invoice");
await db.exec('set role service_role');await assert.rejects(close('D'),/Multiple active invoices/);
// Existing paid accounting is not charged or recognized again.
await db.exec('reset role');
await db.exec("alter table invoices disable trigger guard_store_invoice;alter table invoice_payments disable trigger guard_store_payment;insert into omg_stores values('OMG-P',100,'P');insert into sales_orders(id,customer_id,omg_store_id) values('P','C','OMG-P');insert into invoices(id,so_id,customer_id,total,paid,status) values('PAID','P','C',100,100,'paid');insert into invoice_payments(invoice_id,amount,method,ref) values('PAID',100,'store','OMG P');alter table invoices enable trigger guard_store_invoice;alter table invoice_payments enable trigger guard_store_payment");
await db.exec('set role service_role');
r=await close('P');assert.equal(r.invoice.id,'PAID');assert.equal(r.payments.length,1);
assert.equal(r.todo.completed_by,'rep');assert(r.todo.completed_at);
// Team-tab money remains receivable; customer card collections alone are applied.
for(const [so,n,mode,paid] of [['TAB',2,'team_tab',0],['COLLISION',3,'paid',100]]){
  const oid='00000000-0000-0000-0000-00000000000'+n;
  await db.exec(`insert into sales_orders(id,customer_id,webstore_id) values('${so}','C','${oid}');
    insert into so_items(so_id,item_index,unit_sell,est_qty,sizes) values('${so}',0,100,1,'{"M":1}');
    insert into webstore_orders(id,store_id,so_id,status,payment_mode,total,subtotal) values('${oid}','${oid}','${so}','shipped','${mode}',100,100);`);
  if(so==='COLLISION'){
    await db.exec("insert into invoice_payments(invoice_id,amount,ref,method) values('PAID',1,'WEB COLLISION','check')");
    await assert.rejects(close(so),/already applied elsewhere/);
    assert.equal((await db.query("select count(*)::int n from invoices where so_id='COLLISION'")).rows[0].n,0);
    assert.equal((await db.query("select store_closed_at from sales_orders where id='COLLISION'")).rows[0].store_closed_at,null);
  }else{
    r=await close(so);assert.equal(Number(r.invoice.paid),paid);assert.equal(r.payments.length,0);assert.equal(r.invoice.status,'open');
  }
}
await db.exec('reset role');
await db.exec("alter table invoices disable trigger guard_store_invoice;insert into omg_stores values('OMG-PART',100,'PART');insert into sales_orders(id,customer_id,omg_store_id) values('PART','C','OMG-PART');insert into invoices(id,so_id,customer_id,total,paid,status) values('PARTIAL','PART','C',100,40,'partial');insert into invoice_payments(invoice_id,amount,ref,method) values('PARTIAL',40,'check partial','check');alter table invoices enable trigger guard_store_invoice");
await db.exec('set role service_role');
await assert.rejects(close('PART'),/Partly applied funds/);
assert.equal((await db.query("select count(*)::int n from invoice_payments where invoice_id='PARTIAL'")).rows[0].n,1);
assert.equal((await db.query("select store_closed_at from sales_orders where id='PART'")).rows[0].store_closed_at,null);
// A manually checked-off rep todo never constitutes financial closeout.
await db.exec("update assigned_todos set status='completed' where so_id='PART'");
await assert.rejects(db.exec("insert into commission_snapshots values('PART','PARTIAL')"),/all costs recorded/);
// Partial refund with unreconciled product lines cannot silently create revenue.
await db.exec("delete from invoice_payments where ref='WEB COLLISION';update webstore_orders set refunded_amt=50 where so_id='COLLISION'");
await assert.rejects(close('COLLISION'),/Refunded or cancelled/);
assert.equal((await db.query("select count(*)::int n from invoices where so_id='COLLISION'")).rows[0].n,0);
await db.exec('set role authenticated');await assert.rejects(close('D'),/permission denied/);
await assert.rejects(db.exec("update sales_orders set store_closed_at=now() where id='D'"),/Use Close Store/);
console.log('Passed: deferred accounting, due date, unfinished jobs, stale version, cost/shipment confirmation, atomic close, repeated close/batch, legacy reuse, duplicate invoices, unapplied receipts, permissions and commission gate.');
await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
