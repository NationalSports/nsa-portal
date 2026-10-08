// Real PostgreSQL transaction tests. Run with PGLITE_MODULE pointing to an installed
// @electric-sql/pglite package; it is a test-only dependency, not shipped to Netlify.
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('fs');
const assert = require('node:assert/strict');
(async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create function public.is_team_member() returns boolean language sql as 'select false';
    create table invoices(id text primary key,total numeric,paid numeric default 0,cc_fee numeric default 0,status text default 'open',deleted_at timestamptz,updated_at timestamptz);
    create table invoice_payments(id serial primary key,invoice_id text references invoices(id),amount numeric,method text,ref text,date text,cc_fee numeric,unique(invoice_id,ref));
    create table invoice_pay_requests(id text primary key,invoice_id text,amount numeric,status text default 'open',paid_at timestamptz,payment_intent_id text);
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261008151046_stripe_invoice_atomic_settlement.sql','utf8'));
  const intent = (id, ids, cents, status='succeeded', extra={}) => ({id,invoice_ids:ids,status,amount_cents:cents,received_cents:status==='succeeded'?cents:0,currency:'usd',livemode:true,method:'ach',submitted_at:new Date().toISOString(),observed_at:new Date().toISOString(),...extra});
  const call = async (pi, apply=true) => (await db.query('select reconcile_stripe_invoice_payment($1::jsonb,$2) result',[JSON.stringify(pi),apply])).rows[0].result;
  const invoice = async id => (await db.query('select * from invoices where id=$1',[id])).rows[0];
  let passed = 0;
  async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
  await test('processing is durable but never books uncleared cash',async()=>{
    await db.exec("insert into invoices(id,total) values('INV-1',100)");
    await call(intent('pi_one',['INV-1'],10000,'processing'));
    assert.equal((await invoice('INV-1')).paid,'0');
    assert.equal((await db.query('select status from invoice_payment_intents')).rows[0].status,'processing');
  });
  await test('settlement and repeated delivery apply exactly once',async()=>{
    await call(intent('pi_one',['INV-1'],10000));
    assert.equal((await call(intent('pi_one',['INV-1'],10000))).already,true);
    assert.equal((await invoice('INV-1')).paid,'100.00');
    assert.equal((await db.query('select count(*) n from invoice_payments')).rows[0].n,1);
  });
  await test('late processing event cannot regress settled state',async()=>{
    await call(intent('pi_one',['INV-1'],10000,'processing'));
    assert.equal((await db.query("select status from invoice_payment_intents where id='pi_one'")).rows[0].status,'succeeded');
  });
  await test('partial payment and request completion are atomic and replay safe',async()=>{
    await db.exec("insert into invoices(id,total) values('INV-2',200); insert into invoice_pay_requests(id,invoice_id,amount) values('request2','INV-2',50)");
    const pi=intent('pi_two',['INV-2'],5000,'succeeded',{pay_request_id:'request2'});
    await call(pi);await call(pi);
    assert.equal((await invoice('INV-2')).paid,'50.00');
    assert.equal((await invoice('INV-2')).status,'partial');
    assert.equal((await db.query("select status from invoice_pay_requests where id='request2'")).rows[0].status,'paid');
  });
  await test('database failure rolls back history AND balance; retry succeeds',async()=>{
    await db.exec(`insert into invoices(id,total) values('INV-3',90);
      create function fail_payment_test() returns trigger language plpgsql as $$begin if new.id='INV-3' then raise exception 'simulated outage'; end if; return new; end$$;
      create trigger fail_payment before update on invoices for each row execute function fail_payment_test();`);
    await assert.rejects(call(intent('pi_three',['INV-3'],9000)),/simulated outage/);
    assert.equal((await invoice('INV-3')).paid,'0');
    assert.equal((await db.query("select count(*) n from invoice_payments where invoice_id='INV-3'")).rows[0].n,0);
    await db.exec('drop trigger fail_payment on invoices');
    await call(intent('pi_three',['INV-3'],9000));
    assert.equal((await invoice('INV-3')).paid,'90.00');
  });
  await test('multi-invoice fee rounding conserves captured cents',async()=>{
    await db.exec("insert into invoices(id,total) values('INV-4',10),('INV-5',20),('INV-6',30)");
    await call(intent('pi_multi',['INV-4','INV-5','INV-6'],6181,'succeeded',{method:'cc'}));
    const sum=(await db.query("select sum(amount) amount,sum(cc_fee) fee from invoice_payments where ref='Stripe pi_multi'")).rows[0];
    assert.equal(sum.amount,'61.81');assert.equal(sum.fee,'1.81');
  });
  await test('underpaid, void, refunded and balance-changed payments are not applied',async()=>{
    await db.exec("insert into invoices(id,total) values('INV-7',100),('INV-8',100),('INV-9',100); update invoices set status='void' where id='INV-8'");
    assert.ok((await call(intent('pi_refunded',['INV-7'],10000,'succeeded',{refunded_cents:10000}))).error);
    assert.ok((await call(intent('pi_low',['INV-7'],5000))).error);
    assert.ok((await call(intent('pi_void',['INV-8'],10000))).error);
    assert.ok((await call(intent('pi_changed',['INV-9'],10000,'succeeded',{base_cents:'12000'}))).error);
    assert.equal((await invoice('INV-7')).paid,'0');assert.equal((await invoice('INV-8')).paid,'0');assert.equal((await invoice('INV-9')).paid,'0');
  });
  await test('read-only observation of captured payment does not settle it',async()=>{
    await db.exec("insert into invoices(id,total) values('INV-10',25)");
    await call(intent('pi_ten',['INV-10'],2500),false);
    assert.equal((await invoice('INV-10')).paid,'0');
  });
  await test('legacy history without balance application is flagged, not duplicated',async()=>{
    await db.exec("insert into invoices(id,total) values('INV-11',25); insert into invoice_payments(invoice_id,amount,ref) values('INV-11',25,'Stripe pi_legacy')");
    assert.ok((await call(intent('pi_legacy',['INV-11'],2500))).error);
    assert.equal((await invoice('INV-11')).paid,'0');
    assert.equal((await db.query("select count(*) n from invoice_payments where invoice_id='INV-11'")).rows[0].n,1);
  });
  await test('observing a valid legacy payment recognizes application without new cash',async()=>{
    await db.exec("insert into invoices(id,total,paid,status) values('INV-12',25,25,'paid'); insert into invoice_payments(invoice_id,amount,ref) values('INV-12',25,'Stripe pi_old')");
    assert.equal((await call(intent('pi_old',['INV-12'],2500),false)).already,true);
    assert.ok((await db.query("select applied_at from invoice_payment_intents where id='pi_old'")).rows[0].applied_at);
  });
  await test('partial bank and card fees leave the requested remaining balance',async()=>{
    for (const [suffix,cents,method] of [['bank',200000,'ach'],['card',205800,'cc']]) {
      await db.query('insert into invoices(id,total) values($1,5000)',['INV-'+suffix]);
      await db.query('insert into invoice_pay_requests(id,invoice_id,amount) values($1,$2,2000)',['req'+suffix,'INV-'+suffix]);
      const pi=intent('pi_'+suffix,['INV-'+suffix],cents,'succeeded',{method,pay_request_id:'req'+suffix});
      await call(pi); await call(pi);
      const inv=await invoice('INV-'+suffix);
      assert.equal(Number(inv.total)-Number(inv.paid),3000);
      assert.equal(Number(inv.cc_fee),method==='cc'?58:0);
    }
  });
  await test('invalid partial requests never modify invoice money',async()=>{
    for (const kind of ['underpaid','excess','paid','mismatch']) {
      const id='INV-'+kind;
      await db.query('insert into invoices(id,total,paid) values($1,5000,$2)',[id,kind==='excess'?4000:0]);
      await db.query('insert into invoice_pay_requests(id,invoice_id,amount,status) values($1,$2,2000,$3)',['req'+kind,kind==='mismatch'?'INV-other':id,kind==='paid'?'paid':'open']);
      const before=await invoice(id);
      const result=await call(intent('pi_'+kind,[id],kind==='underpaid'?150000:200000,'succeeded',{pay_request_id:'req'+kind}));
      assert.ok(result.error,kind); assert.deepEqual(await invoice(id),before);
    }
  });
  await test('staff and anonymous roles cannot invoke financial writes',async()=>{
    for(const role of ['anon','authenticated']){
      await db.exec('set role '+role);
      await assert.rejects(call(intent('pi_denied',['INV-10'],2500)),/permission denied/);
      await db.exec('reset role');
    }
  });
  console.log(`${passed} PostgreSQL settlement tests passed`);
  await db.close();
})().catch(e=>{console.error(e);process.exit(1)});
