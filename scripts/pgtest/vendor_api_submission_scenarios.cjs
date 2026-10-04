// In-memory scratch PostgreSQL only; never connects to a supplier or production DB.
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
(async () => {
  const db = new PGlite(); await db.waitReady;
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.app_state(id text primary key,value text);
    create table public.sales_orders(id text primary key,deleted_at timestamptz);
    create table public.so_items(id serial primary key,so_id text,item_index int,sku text,color text,sizes jsonb);
    create table public.so_item_po_lines(id serial primary key,so_item_id int,po_id text,vendor text,status text,sizes jsonb,received jsonb);
    create table public.batch_po_numbers(n int primary key,claimed_by text,claimed_at timestamptz);
    grant all on all tables in schema public to service_role;
    grant usage on all sequences in schema public to service_role;
  `);
  const history = ['NSA 4691','NSA 4695'].map(po_number => ({ po_number,vendor_key:'sanmar',source_pos:[{
    so_id:'SO-2757',po_id:'PO 60232 SERF',items:[{sku:'ST350',color:'Black',sizes:{M:28}}],
  }] }));
  await db.query('insert into app_state values($1,$2)', ['submitted_batches',JSON.stringify(history)]);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261002143418_vendor_api_submission_reservations.sql'),'utf8'));
  let checks=0;
  const query = (sql,args) => db.query(sql,args);
  const sources = (so_id='SO-A', qty=6, queue_id='BPO-A') => [{so_id,sku:'TEE',color:'Black',size:'M',qty,source_po:'PO-A',queue_id}];
  const reserve = (po,lines=sources(),vendor='sanmar') => query('select public.reserve_vendor_api_submission($1,$2,$3::jsonb,$4) r',[vendor,po,JSON.stringify(lines),'test-user']);
  const rejects = async (run,pattern) => {await assert.rejects(run,pattern); checks++;};
  const addOrder = async (id, qty,queue='BPO-A',vendor='SanMar') => {
    await query('insert into sales_orders(id) values($1)',[id]);
    const item=(await query('insert into so_items(so_id,sku,color,sizes) values($1,$2,$3,$4) returning id',[id,'TEE','Black',JSON.stringify({M:qty})])).rows[0].id;
    await query('insert into so_item_po_lines(so_item_id,po_id,vendor,status,sizes) values($1,$2,$3,$4,$5)',[item,'PO-A',vendor,'queued',JSON.stringify({M:qty,batch_queue_id:queue})]);
    return item;
  };
  await db.exec("insert into sales_orders(id) values('SO-2757');insert into so_items(so_id,sku,color,sizes) values('SO-2757','ST350','Black','{\"M\":28}');");
  await rejects(()=>reserve('NSA 4900',[{so_id:'SO-2757',sku:'ST350',color:'Black',size:'M',qty:28,source_po:'PO 60232 SERF',queue_id:'stale'}]),/DUPLICATE_VENDOR_ORDER/);
  assert.equal((await query('select count(*)::int n from private.vendor_api_submissions')).rows[0].n,2); checks++;
  const item=await addOrder('SO-A',6);
  const first=(await reserve('NSA 4901')).rows[0].r;
  assert.equal(first.po_number,'NSA 4901'); checks++;
  await rejects(()=>reserve('NSA 4901'),/DUPLICATE_VENDOR_ORDER/);
  await rejects(()=>reserve('NSA 4902'),/DUPLICATE_VENDOR_ORDER/); // second user, different PO
  await query("select public.finish_vendor_api_submission($1,'uncertain','{\"error\":\"timeout\"}')",[first.id]);
  await rejects(()=>reserve('NSA 4902'),/DUPLICATE_VENDOR_ORDER/); // no automatic timeout expiry
  await query("select public.finish_vendor_api_submission($1,'accepted','{\"transactionId\":\"accepted\"}')",[first.id]);
  // Browser overwrites its current PO marker and the shared app_state history. Ledger survives.
  await db.exec("delete from app_state;delete from so_item_po_lines;");
  await rejects(()=>reserve('NSA 4902'),/DUPLICATE_VENDOR_ORDER/);
  // Same receipt in both current rows and app_state is counted once, not three times.
  const newHistory=[{po_number:'NSA 4901',vendor_key:'sanmar',source_pos:[{so_id:'SO-A',items:[{sku:'TEE',color:'Black',sizes:{M:6}}]}]}];
  await query('insert into app_state values($1,$2)',['submitted_batches',JSON.stringify(newHistory)]);
  await query("insert into so_item_po_lines(so_item_id,po_id,vendor,status,sizes) values($1,'PO-A','SanMar','received',$2)",[item,JSON.stringify({M:6,batch_po_number:'NSA 4901'})]);
  await query('update so_items set sizes=$1 where id=$2',[JSON.stringify({M:9}),item]);
  await query("insert into so_item_po_lines(so_item_id,po_id,vendor,status,sizes) values($1,'PO-A','SanMar','queued',$2)",[item,JSON.stringify({M:3,batch_queue_id:'BPO-TOPUP'})]);
  await rejects(()=>reserve('NSA 4902',sources('SO-A',4,'BPO-TOPUP')),/DUPLICATE_VENDOR_ORDER/);
  const topup=(await reserve('NSA 4902',sources('SO-A',3,'BPO-TOPUP'))).rows[0].r;
  assert.ok(topup.id); checks++;
  // Separate orders sharing a vendor SKU remain legitimate.
  await addOrder('SO-B',6,'BPO-B');
  assert.ok((await reserve('NSA 4903',sources('SO-B',6,'BPO-B'))).rows[0].r.id); checks++;
  await addOrder('SO-C',6,'BPO-C');
  await rejects(()=>reserve('NSA 4904',sources('SO-C',6,'removed-queue')),/STALE_VENDOR_QUEUE/);
  assert.equal((await query('select count(*)::int n from batch_po_numbers where n=4904')).rows[0].n,0); checks++;
  // Both sources must validate before any reservation is written.
  await rejects(()=>reserve('NSA 4904',[...sources('SO-C',3,'BPO-C'),...sources('SO-B',3,'BPO-B')]),/DUPLICATE_VENDOR_ORDER/);
  await rejects(()=>reserve('NSA 4904',[...sources('SO-C',4,'BPO-C'),{...sources('SO-C',4,'BPO-C')[0],sku:'tee',color:'black'}]),/DUPLICATE_VENDOR_ORDER/);
  assert.equal((await query("select count(*)::int n from private.vendor_api_submissions where po_number='NSA 4904'")).rows[0].n,0); checks++;
  await addOrder('SO-D',6,'BPO-D','S&S Activewear');
  await rejects(()=>reserve('NSA 4904',sources('SO-D',6,'BPO-D'),'sanmar'),/STALE_VENDOR_QUEUE/);
  assert.ok((await reserve('NSA 4904',sources('SO-D',6,'BPO-D'),'sss')).rows[0].r.id); checks++;
  // A second supplier must not bypass already reserved SO demand.
  await rejects(()=>reserve('NSA 4905',sources('SO-D',6,'BPO-D'),'momentec'),/DUPLICATE_VENDOR_ORDER/);
  await rejects(()=>reserve('NSA 4905',[]),/INVALID_VENDOR_SUBMISSION/);
  await db.exec('set role authenticated');
  await rejects(()=>reserve('NSA 4905',sources('SO-C',6,'BPO-C')),/permission denied/);
  await rejects(()=>query('select * from private.vendor_api_submissions'),/permission denied/);
  await db.exec('reset role; set role service_role');
  assert.ok((await reserve('NSA 4905',sources('SO-C',6,'BPO-C'))).rows[0].r.id); checks++;
  await db.exec('reset role');
  await addOrder('SO-DIRECT',4,'','Momentec');
  await db.exec("update so_item_po_lines set status='waiting',sizes='{\"M\":4}' where so_item_id=(select id from so_items where so_id='SO-DIRECT')");
  const direct=sources('SO-DIRECT',4,'');direct[0].source_po='PO 60240 TEST';
  await db.exec("update so_item_po_lines set po_id='PO 60240 TEST' where so_item_id=(select id from so_items where so_id='SO-DIRECT')");
  assert.ok((await reserve('PO 60240 TEST',direct,'momentec')).rows[0].r.id); checks++;
  await rejects(()=>reserve('PO 60240 TEST',direct,'momentec'),/DUPLICATE_VENDOR_ORDER/);
  await rejects(()=>reserve('PO 60241 TEST',direct,'momentec'),/INVALID_VENDOR_SUBMISSION/);
  await db.close();
  console.log(`ALL_VENDOR_API_SUBMISSION_SCENARIOS_PASSED (${checks} checks)`);
})().catch(error => {console.error(error);process.exitCode=1;});
