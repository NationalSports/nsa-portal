// Real independent PostgreSQL connections, plus the shipped Netlify handler.
// Authentication is deliberately stubbed; this is NOT a Supabase/QBO sandbox E2E test.
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
module.exports=async db=>{
 await db.exec('reset role');
 const seed=async(id,code=id)=>{
  await db.query("insert into omg_stores(id,_omg_acct_collected,_omg_sale_code) values($1,100,$2)",['OMG-'+id,code]);
  await db.query("insert into sales_orders(id,customer_id,omg_store_id) values($1,'C',$2)",[id,'OMG-'+id]);
  await db.query("insert into so_items(so_id,item_index,unit_sell,est_qty) values($1,0,100,1)",[id]);
  return Number((await db.query('select _version from sales_orders where id=$1',[id])).rows[0]._version);
 };
 const draft={total:100,shipping:0,line_items:[{qty:1,rate:100,amount:100}]};
 const clients=[];
 const connect=async()=>{const c=await db.newConnection();clients.push(c);await c.query('set role service_role');return c;};
 const call=(c,id,version)=>c.query("select close_store($1,$2,'rep',true,true,$3) r",[id,version,draft]).then(x=>x.rows[0].r);
 try{
  const version=await seed('CONCURRENT');
  const cs=await Promise.all(Array.from({length:8},()=>connect()));
  const result=await Promise.all(cs.map(c=>call(c,'CONCURRENT',version)));
  assert.equal(result.filter(r=>!r.already_closed).length,1);
  assert.equal(new Set(result.map(r=>r.invoice.id)).size,1);
  assert.equal((await db.query("select count(*)::int n from invoice_payments where ref='OMG CONCURRENT'")).rows[0].n,1);
  // Two distinct store IDs that accidentally carry the same OMG sale code.
  const av=await seed('REF-A','SHARED'),bv=await seed('REF-B','SHARED');
  const race=await Promise.allSettled([call(cs[0],'REF-A',av),call(cs[1],'REF-B',bv)]);
  assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
  assert.match(race.find(x=>x.status==='rejected').reason.message,/already applied elsewhere/);
  assert.equal((await db.query("select count(*)::int n from invoices where so_id in ('REF-A','REF-B')")).rows[0].n,1);
  // A concurrent child edit commits before the closeout obtains the parent lock.
  const stale=await seed('CHILD-RACE');
  await cs[0].query('begin');await cs[0].query("update so_items set unit_sell=101 where so_id='CHILD-RACE'");
  const closing=call(cs[1],'CHILD-RACE',stale);const rejection=assert.rejects(closing,/changed/);
  await cs[0].query('commit');await rejection;
  assert.equal((await db.query("select count(*)::int n from invoices where so_id='CHILD-RACE'")).rows[0].n,0);
  // Execute the real handler, with real RPC/database and a test-only staff identity.
  const hv=await seed('HTTP-RETRY');
  const rpcClient=cs[2];const sandbox={exports:{},require:name=>{
   assert.equal(name,'./_shared');return {
    verifyUser:async()=>({ok:true,teamMemberId:'rep'}),
    getSupabaseAdmin:()=>({rpc:async(name,p)=>{assert.equal(name,'close_store');try{return{data:await call(rpcClient,p.p_so_id,p.p_expected_version)}}catch(e){return{error:{message:e.message}}}}})
   };
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../netlify/functions/close-store.js'),'utf8'),sandbox);
  const event={httpMethod:'POST',body:JSON.stringify({soId:'HTTP-RETRY',version:hv,costsRecorded:true,shipped:true,invoice:draft})};
  // Pretend the first committed response was lost; the caller resends its old version.
  assert.equal((await sandbox.exports.handler(event)).statusCode,200);
  const retry=await sandbox.exports.handler(event);assert.equal(retry.statusCode,200);assert(JSON.parse(retry.body).already_closed);
  assert.equal((await db.query("select count(*)::int n from invoice_payments where ref='OMG HTTP-RETRY'")).rows[0].n,1);
  console.log('Passed real PG concurrency: 8 same-store requests; cross-store source collision; stale child-edit race; Netlify handler dropped-response retry (stubbed auth).');
 }finally{await Promise.all(clients.map(c=>c.end()));}
};
