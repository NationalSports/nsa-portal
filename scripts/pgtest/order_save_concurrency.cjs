// Run after order_save_scenarios.cjs on a native scratch Postgres (not PGlite).
const {Client}=require(process.env.PG_MODULE||'pg');const assert=require('node:assert/strict');
const socket=process.env.PG_SCRATCH_SOCKET;
if(!socket?.startsWith('/private/tmp/'))throw new Error('Only a local scratch Unix socket is accepted');
const config={host:socket,port:Number(process.env.PG_SCRATCH_PORT||54991),user:'postgres',database:'postgres'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const a=new Client(config),b=new Client(config),reader=new Client(config);
 await Promise.all([a.connect(),b.connect(),reader.connect()]);
 try{
  for(const c of [a,b,reader])await c.query("set statement_timeout='8s';set lock_timeout='6s';");
  const id='SO-CONCURRENT';await a.query("insert into sales_orders(id,memo) values($1,'before')",[id]);
  const token=(await a.query('select sales_order_save_token($1) t',[id])).rows[0].t;
  const plan=memo=>({header:{id,memo},base_version:1,is_new:false,items:null,firm_dates:null,art_upserts:[],art_deletes:[],job_upserts:[],job_deletes:[]});
  const save=(c,p,t=token)=>c.query('select save_sales_order_atomic($1,$2,$3) result',[id,t,JSON.stringify(p)]);
  await a.query('begin');const first=(await save(a,plan('first'))).rows[0].result;
  let finished=false;const losing=save(b,plan('second')).then(r=>({result:r}),error=>({error})).finally(()=>{finished=true});
  await sleep(80);assert.equal(finished,false,'second writer waits on the first transaction');
  const visible=(await reader.query('select memo,_version from sales_orders where id=$1',[id])).rows[0];
  assert.equal(visible.memo,'before');assert.equal(visible._version,1,'readers see only the prior committed document');
  await a.query('commit');const rejected=await losing;assert.equal(rejected.error?.code,'40001');
  assert.equal((await reader.query('select memo from sales_orders where id=$1',[id])).rows[0].memo,'first');
  console.log('PASS two concurrent full saves: loser rejected, no intermediate state visible');
  assert.deepEqual((await save(b,plan('first'))).rows[0].result,first,'response-lost retry acknowledges original commit');
  console.log('PASS same prepared request can be retried from a second connection');
  // A receiving update holds a child row while a full save prepares from the
  // old token. After the child commits, the waiting full save must re-check it.
  const item=(await a.query('insert into so_items(so_id,item_index,sku) values($1,0,$2) returning id',[id,'TEE'])).rows[0];
  const po=(await a.query("insert into so_item_po_lines(so_item_id,po_id) values($1,'PO-C') returning id",[item.id])).rows[0];
  const oldToken=(await a.query('select sales_order_save_token($1) t',[id])).rows[0].t;
  await b.query('begin');await b.query('update so_item_po_lines set received=$1 where id=$2',[JSON.stringify({M:4}),po.id]);
  finished=false;const stale=save(a,{...plan('must not land'),base_version:2},oldToken).then(r=>({result:r}),error=>({error})).finally(()=>{finished=true});
  await sleep(80);assert.equal(finished,false,'full save waits for locked receiving row');
  await b.query('commit');const outcome=await stale;assert.equal(outcome.error?.code,'40001');
  assert.deepEqual((await reader.query('select received from so_item_po_lines where id=$1',[po.id])).rows[0].received,{M:4});
  assert.equal((await reader.query('select memo from sales_orders where id=$1',[id])).rows[0].memo,'first');
  console.log('PASS receiving edit racing full save survives; full save rejected atomically');
  // Memo CAS holds the same order lock as full saves. A second memo writer
  // waits, then sees a conflict instead of overwriting the first writer.
  const memo=(client,expected,value,n)=>client.query('select save_sales_order_memo($1,$2,$3,$4) result',[id,expected,value,'10000000-0000-4000-8000-'+String(n).padStart(12,'0')]);
  await a.query('begin');await memo(a,'first','memo winner',1);
  finished=false;const memoLoser=memo(b,'first','memo loser',2).finally(()=>{finished=true;});
  await sleep(80);assert.equal(finished,false);
  assert.equal((await reader.query('select memo from sales_orders where id=$1',[id])).rows[0].memo,'first');
  await a.query('commit');assert.equal((await memoLoser).rows[0].result.conflict,true);
  // An unrelated legacy header edit can advance the order revision. Memo CAS
  // preserves it and succeeds because the memo itself did not change.
  await b.query('begin');await b.query("update sales_orders set po_number='PO-MEMO-RACE' where id=$1",[id]);
  finished=false;const independent=memo(a,'memo winner','independent memo',3).finally(()=>{finished=true;});
  await sleep(80);assert.equal(finished,false);await b.query('commit');assert.equal((await independent).rows[0].result.saved,true);
  assert.equal((await reader.query('select po_number from sales_orders where id=$1',[id])).rows[0].po_number,'PO-MEMO-RACE');
  console.log('PASS concurrent memo conflict and independent header update preservation');
  console.log('ALL_ORDER_SAVE_CONCURRENCY_SCENARIOS_PASSED');
 }finally{await a.query('rollback');await b.query('rollback');await Promise.all([a.end(),b.end(),reader.end()]);}
})().catch(e=>{console.error(e.message);process.exit(1)});
