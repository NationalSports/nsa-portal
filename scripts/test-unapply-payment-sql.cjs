// Run with: PGLITE_MODULE=/path/to/@electric-sql/pglite node scripts/test-unapply-payment-sql.cjs
// Isolated PostgreSQL semantics test: no production data or credentials.
const {PGlite}=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const fs=require('fs');const assert=require('node:assert/strict');
(async()=>{
const db=new PGlite();
await db.exec(`
create role anon;create role authenticated;create role service_role bypassrls;
create function public.is_team_member() returns boolean language sql as $$select true$$;
create table invoices(id text primary key,customer_id text,total numeric,paid numeric,status text,qb_invoice_id text);
create table invoice_payments(id serial primary key,invoice_id text,amount numeric,method text,ref text,date text,cc_fee numeric default 0,receipt_id text,unique(invoice_id,ref));
create table payment_receipts(id text primary key,customer_id text,amount numeric,method text,ref text,received_date text,memo text,created_by text,ns_applications jsonb default '[]',qb_payment_id text,updated_at timestamptz,created_at timestamptz default now());
create table team_members(id text,name text,is_active boolean);
insert into team_members values('00000000-0000-0000-0000-000000000040','Andrea',true);
create table qbo_sales_settings(company_key text primary key);insert into qbo_sales_settings values('national');
create table qbo_sales_runs(company_key text,status text,lease_expires_at timestamptz);
create table app_state(id text,value text);
create function qbo_sales_source_snapshot(timestamptz) returns jsonb language sql as $$select jsonb_build_object('receipts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.payment_receipts r),'payments',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.invoice_payments p))$$;
grant all on all tables in schema public to service_role,authenticated;
grant usage,select on all sequences in schema public to service_role,authenticated;
`);
await db.exec(fs.readFileSync('supabase/migrations/20261008152808_unapply_invoice_payments.sql','utf8'));
const seed=async(id,paid=100,qb=null)=>{
 await db.query('insert into invoices(id,customer_id,total,paid,status,qb_invoice_id) values($1,\'C1\',100,$2,\'paid\',$3)',[id,paid,qb]);
 await db.query('insert into invoice_payments(invoice_id,amount,method,ref,date) values($1,100,\'check\',\'58415\',\'10/06/2026\')',[id]);
};
const call=async(id,extra={})=>(await db.query('select unapply_invoice_payment($1,$2,$3::jsonb,$4,$5) result',[id,'58415',JSON.stringify({amount:100,method:'check',date:'10/06/2026',receipt_id:null,...extra}),'Wrong invoice','00000000-0000-0000-0000-000000000040'])).rows[0].result;
await seed('INV-1');await seed('INV-2',100,'1113');await seed('INV-3',99);await seed('INV-4');
await db.exec('set role service_role');
let r=await call('INV-1');assert.equal(r.invoice.paid,0);assert.equal(r.invoice.status,'open');assert.equal(r.invoice.payment_revision,1);assert.equal(r.qbo_review_required,false);assert.equal(r.payments.length,0);
const retry=await call('INV-1');assert.equal(retry.already_unapplied,true);assert.equal(retry.invoice.payment_revision,1);
await assert.rejects(db.exec("update invoices set paid=100,payment_revision=0 where id='INV-1'"),/payments changed/);
await assert.rejects(db.exec("insert into invoice_payments(invoice_id,amount,method,ref,date) values('INV-1',100,'check','58415','10\/06\/2026')"),/was unapplied/);
r=await call('INV-2');assert.equal(r.qbo_review_required,true);const held=r.receipt_id;
assert.equal((await db.query('select reconciliation_hold from payment_receipts where id=$1',[held])).rows[0].reconciliation_hold,true);
await assert.rejects(db.query("insert into invoice_payments(invoice_id,amount,method,ref,date,receipt_id) values('INV-4',100,'check','new-ref','10/06/2026',$1)",[held]),/held for QuickBooks/);
const snapshot=(await db.query('select qbo_sales_source_snapshot(now()) s')).rows[0].s;assert(!snapshot.receipts.some(r=>r.id===held));
await assert.rejects(call('INV-3'),/paid total and payment history differ/);
await assert.rejects(call('INV-4',{amount:99}),/Payment changed/);
await db.exec("insert into qbo_sales_runs values('national','running',now()+interval '5 minutes')");await assert.rejects(call('INV-4'),/sync is running/);await db.exec('delete from qbo_sales_runs');
await db.exec('set role authenticated');
await assert.rejects(call('INV-4'),/permission denied/);
await assert.rejects(db.query('update payment_receipts set reconciliation_hold=false where id=$1',[held]),/held for QuickBooks/);
await assert.rejects(db.exec("delete from invoice_payment_unapplications"),/permission denied/);
await db.exec('reset role');
assert.equal((await db.query("select count(*)::int n from invoice_payments where invoice_id='INV-4'")).rows[0].n,1);
await seed('INV-5',150);await db.exec("update invoices set total=200 where id='INV-5'; insert into payment_receipts(id,customer_id,amount,method,ref,received_date) values('RCPT-5','C1',180,'check','58415','10/06/2026'); update invoice_payments set receipt_id='RCPT-5' where invoice_id='INV-5'; insert into invoice_payments(invoice_id,amount,method,ref,date) values('INV-5',50,'cash','another-payment','10/07/2026')");
await db.exec('set role service_role');
r=await call('INV-5',{receipt_id:'RCPT-5'});assert.equal(r.invoice.paid,50);assert.equal(r.invoice.status,'partial');assert.equal(r.payments.length,1);assert.equal(r.payments[0].ref,'another-payment');assert.equal(r.receipt_id,'RCPT-5');
assert.equal((await db.query("select amount from payment_receipts where id='RCPT-5'")).rows[0].amount,'180');
await db.exec("update invoices set paid=75 where id='INV-5'; insert into invoice_payments(invoice_id,amount,method,ref,date) values('INV-5',25,'cash','new-correct-payment','10/08/2026')");
assert.equal((await db.query("select paid from invoices where id='INV-5'")).rows[0].paid,'75');
console.log('SQL passed: unapply, repeat idempotency, receipt preservation, stale-save fencing, tombstone, QBO hold/snapshot, changed payment, inconsistent totals, active sync, authorization and audit immutability.');await db.close();
})().catch(e=>{console.error(e.message);process.exitCode=1});
