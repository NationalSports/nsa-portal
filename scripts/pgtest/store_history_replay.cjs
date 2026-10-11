// Read-only exports are supplied outside the repository; this script never connects to production.
const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const h=JSON.parse(fs.readFileSync(process.env.STORE_HISTORY)),d=JSON.parse(fs.readFileSync(process.env.STORE_DETAILS));
const quote=s=>'"'+s.replaceAll('"','""')+'"';
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 -- Token generation is irrelevant to this offline accounting replay.
 create function gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('00',$1),'hex')$$;
 create function auth.role() returns text language sql as $$select 'service_role'::text$$;
 create function public.is_team_member() returns boolean language sql as $$select true$$;
 create table team_members(id text primary key,is_active boolean);create table customers(id text primary key,primary_rep_id text,payment_terms text);
 create table invoice_payment_unapplications(invoice_id text,payment_ref text);
 create table webstore_order_items(order_id uuid,line_status text);`);
 for(const table of [...new Set(d.columns.map(c=>c.table_name))]){
  const cols=d.columns.filter(c=>c.table_name===table).map(c=>quote(c.column_name)+' '+(c.column_default?.startsWith('nextval(')?'serial':c.data_type==='ARRAY'?c.udt_name.slice(1)+'[]':c.data_type)+(c.is_nullable==='NO'?' not null':'')+(!c.column_default?.startsWith('nextval(')&&c.column_default?' default '+c.column_default:''));
  cols.push(table==='so_jobs'?'primary key(so_id,id)':table==='commission_snapshots'?'primary key(invoice_id)':'primary key(id)');
  if(table==='invoice_payments')cols.push('unique(invoice_id,ref)');
  if(table==='invoices')cols.push('unique(idempotency_key)');
  await db.exec('create table '+quote(table)+'('+cols.join(',')+')');
 }
 const put=async(table,rows)=>{for(const row of rows||[]){const keys=Object.keys(row);await db.query(`insert into ${quote(table)}(${keys.map(quote)}) select ${keys.map(quote)} from jsonb_populate_record(null::${quote(table)},$1)`,[row]);}};
 await put('team_members',d.staff);await put('customers',d.customers);await put('omg_stores',h.omg);await put('sales_orders',h.orders);
 await put('so_items',d.items);await put('so_jobs',d.jobs);
 await put('so_item_decorations',d.decos);
 await put('webstore_orders',h.weborders);await put('invoices',h.invoices);await put('invoice_payments',h.payments);
 for(const r of d.receipts||[]){const{applied,...row}=r;await put('payment_receipts',[{...row,received_date:'2026-10-11'}]);const captured=h.payments.filter(p=>p.receipt_id===r.id).reduce((a,p)=>a+Number(p.amount),0);if(applied>captured)await put('invoice_payments',[{invoice_id:'UNRELATED',receipt_id:r.id,amount:applied-captured,ref:'existing-other-application:'+r.id}]);}
 // Use the actual production money/version trigger definitions.
 for(const t of d.triggers.filter(t=>['guard_invoice_payment_revision','guard_unapplied_payment','trg_invoices_version','trg_sales_orders_version','trg_invoices_updated','trg_sales_orders_updated','trg_webstore_sync_status'].includes(t.trigger))){await db.exec(t.function);await db.exec(t.definition);}
 await db.exec('alter table assigned_todos add foreign key(assigned_to) references team_members(id);alter table assigned_todos add foreign key(created_by) references team_members(id)');
 await db.exec('grant all on all tables in schema public to authenticated,service_role;grant usage,select on all sequences in schema public to authenticated,service_role');
 await db.exec(fs.readFileSync('supabase/migrations/20261011065626_store_closeout.sql','utf8'));
 await db.exec('set role service_role');
 const actor=d.staff.find(x=>x.is_active)?.id;
 const counts=async()=> (await db.query("select (select count(*) from invoices) invoices,(select count(*) from invoice_payments) payments,(select coalesce(sum(total),0) from invoices) revenue,(select coalesce(sum(amount),0) from invoice_payments) applied")).rows[0];
 const results=[];
 for(const s of h.orders){
  const inv=h.invoices.find(i=>i.so_id===s.id&&i.status!=='void');
  const draft=inv?{total:inv.total,shipping:inv.shipping,line_items:inv.line_items}:null;
  const before=await counts();
  await db.exec('begin');
  try{
   const r=(await db.query('select close_store($1,$2,$3,true,true,$4) r',[s.id,s._version,actor,draft])).rows[0].r;
   const after=await counts();
   const retry=(await db.query('select close_store($1,$2,$3,true,true,$4) r',[s.id,s._version,actor,draft])).rows[0].r;
   assert(retry.already_closed);assert.deepEqual(await counts(),after,'retry duplicates money');
   if(inv)assert.equal(after.invoices,before.invoices,'legacy invoice duplicated');
   results.push({id:s.id,kind:s.omg_store_id?'OMG':'web',result:'closed',invoice:r.invoice.id,total:r.invoice.total,paid:r.invoice.paid,addedInvoices:Number(after.invoices)-Number(before.invoices),addedPayments:Number(after.payments)-Number(before.payments)});
  }catch(e){await db.exec('rollback');assert.deepEqual(await counts(),before,'failed closeout changed money');results.push({id:s.id,kind:s.omg_store_id?'OMG':'web',result:'blocked',reason:e.message});continue;}
  await db.exec('rollback');
 }
 const rehearsals=[];
 for(const id of ['SO-2852','SO-2782','SO-2825']){
  const source=h.orders.find(s=>s.id===id);if(!source)continue;
  await db.exec('begin');
  await db.query("update so_jobs set prod_status='shipped' where so_id=$1",[id]);
  await db.query('delete from invoice_payments where invoice_id in(select id from invoices where so_id=$1)',[id]);
  await db.query('delete from invoices where so_id=$1',[id]);
  const inv=h.invoices.find(i=>i.so_id===id&&i.status!=='void');
  const draft=source.omg_store_id?{total:inv.total,shipping:inv.shipping,line_items:inv.line_items}:null;
  const version=(await db.query('select _version from sales_orders where id=$1',[id])).rows[0]._version;
  const before=await counts();
  const r=(await db.query('select close_store($1,$2,$3,true,true,$4) r',[id,version,actor,draft])).rows[0].r;
  const after=await counts();
  assert.equal(Number(after.invoices)-Number(before.invoices),1);assert.equal(Number(after.payments)-Number(before.payments),1);
  await db.query('select close_store($1,$2,$3,true,true,$4)',[id,version,actor,draft]);assert.deepEqual(await counts(),after);
  rehearsals.push({id,total:r.invoice.total,paid:r.invoice.paid,platformCost:r.sales_order.store_closeout_platform_cost,addedInvoices:1,addedPayments:1,retryAdded:0});
  await db.exec('rollback');
 }
 const todo=(await db.query('select so_id,assigned_to,due_date::text due_date from assigned_todos order by so_id')).rows;
 const report={counts:{orders:h.orders.length,sourceOrders:h.weborders.length,invoices:h.invoices.length,payments:h.payments.length},results,rehearsals,todos:todo};
 if(process.env.STORE_REPLAY_OUTPUT)fs.writeFileSync(process.env.STORE_REPLAY_OUTPUT,JSON.stringify(report,null,2));
 console.log(JSON.stringify({counts:report.counts,outcomes:results.reduce((a,r)=>{const k=r.result==='closed'?r.kind+':closed':r.reason;a[k]=(a[k]||0)+1;return a},{}),closed:results.filter(r=>r.result==='closed'),rehearsals,todoCount:todo.length},null,2));
 await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
