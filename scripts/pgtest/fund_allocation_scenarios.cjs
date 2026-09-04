const fs=require('fs');
const path=require('path');
const assert=require('assert');

const pgliteModule=process.env.PGLITE_MODULE
  ||path.resolve(__dirname,'../../../audit-tools/node_modules/@electric-sql/pglite');
const{PGlite}=require(pgliteModule);

(async()=>{
  const db=new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create table public.team_members(id text primary key,auth_id uuid,is_active boolean default true);
    create function public.is_team_member() returns boolean language sql stable as $$
      select coalesce(current_setting('app.is_team_member',true),'')='true'
    $$;
    create table public.customers(id text primary key,parent_id text references public.customers(id));
    create table public.estimates(
      id text primary key,customer_id text references public.customers(id),status text,
      updated_at timestamptz,promo_applied boolean default false,promo_amount numeric default 0,
      credit_applied boolean default false,credit_amount numeric default 0
    );
    create table public.sales_orders(
      id text primary key,customer_id text references public.customers(id),estimate_id text references public.estimates(id),
      updated_at timestamptz,deleted_at timestamptz,promo_applied boolean default false,promo_amount numeric default 0,
      credit_applied boolean default false,credit_amount numeric default 0
    );
    create table public.customer_promo_programs(
      id text primary key,customer_id text references public.customers(id),type text,fixed_amount numeric,
      spend_percentage numeric,is_active boolean default true,notes text,created_at timestamptz default now(),updated_at timestamptz default now()
    );
    create table public.customer_promo_periods(
      id text primary key,customer_id text references public.customers(id),program_id text references public.customer_promo_programs(id),
      period_start text,period_end text,allocated numeric default 0,used numeric default 0,notes text,created_at timestamptz default now()
    );
    create table public.customer_promo_usage(
      id serial primary key,period_id text references public.customer_promo_periods(id),so_id text references public.sales_orders(id),
      estimate_id text references public.estimates(id),amount numeric,description text,created_by text,created_at timestamptz default now()
    );
    create table public.customer_credits(
      id text primary key,customer_id text references public.customers(id),amount numeric,used numeric default 0,
      source text,created_by text,created_at timestamptz default now()
    );
    create table public.customer_credit_usage(
      id serial primary key,credit_id text references public.customer_credits(id),so_id text references public.sales_orders(id),
      estimate_id text references public.estimates(id),amount numeric,description text,created_by text,created_at timestamptz default now()
    );
    create role anon; create role authenticated; create role service_role;
  `);
  const migration=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260904224604_atomic_fund_allocations.sql'),'utf8');
  await db.exec(migration);
  await db.exec(`
    select set_config('request.jwt.claim.role','service_role',false);
    insert into customers(id) values ('P');
    insert into customers(id,parent_id) values ('C1','P'),('C2','P');
    insert into customer_promo_programs(id,customer_id,type,fixed_amount) values ('PR','P','fixed',100);
    insert into customer_credits(id,customer_id,amount,used) values ('CR1','C1',50,0);
    insert into estimates(id,customer_id,status,promo_applied,promo_amount,credit_applied,credit_amount)
      values ('E1','C1','approved',true,70,true,30),('E2','C2','approved',true,40,false,0),('E3','C2','approved',true,40,false,0);
  `);
  const call=(type,id,cid,promo,credit,source=null)=>db.query(
    `select public.set_document_fund_allocation($1,$2,$3,$4,$5,$6,'fixture','tester') as result`,
    [type,id,cid,promo,credit,source]
  );

  await call('estimate','E1','C1',70,30);
  assert.equal(Number((await db.query(`select used from customer_promo_periods where customer_id='P'`)).rows[0].used),70,'first promo draw');
  assert.equal(Number((await db.query(`select used from customer_credits where id='CR1'`)).rows[0].used),30,'first credit draw');

  await call('estimate','E1','C1',70,30);
  assert.equal(Number((await db.query(`select used from customer_promo_periods where customer_id='P'`)).rows[0].used),70,'retry does not double promo');
  assert.equal(Number((await db.query(`select used from customer_credits where id='CR1'`)).rows[0].used),30,'retry does not double credit');
  assert.equal(Number((await db.query(`select count(*) n from customer_promo_usage where estimate_id='E1' and so_id is null`)).rows[0].n),1,'one promo usage after retry');
  assert.equal(Number((await db.query(`select count(*) n from customer_credit_usage where estimate_id='E1' and so_id is null`)).rows[0].n),1,'one credit usage after retry');

  let failed=false;
  try{await call('estimate','E2','C2',40,0)}catch(e){failed=/promo funds insufficient/.test(e.message)}
  assert(failed,'overspend rejected');
  assert.equal(Number((await db.query(`select used from customer_promo_periods where customer_id='P'`)).rows[0].used),70,'overspend rolls back balance');
  assert.equal(Number((await db.query(`select count(*) n from customer_promo_usage where estimate_id='E2'`)).rows[0].n),0,'overspend rolls back usage');

  await call('estimate','E1','C1',60,20);
  assert.equal(Number((await db.query(`select used from customer_promo_periods where customer_id='P'`)).rows[0].used),60,'replacement applies promo delta');
  assert.equal(Number((await db.query(`select used from customer_credits where id='CR1'`)).rows[0].used),20,'replacement applies credit delta');

  failed=false;
  try{await call('estimate','E1','C1',70,100)}catch(e){failed=/account credit insufficient/.test(e.message)}
  assert(failed,'credit overspend rejected after promo work starts');
  assert.equal(Number((await db.query(`select used from customer_promo_periods where customer_id='P'`)).rows[0].used),60,'credit failure rolls promo replacement back');
  assert.equal(Number((await db.query(`select used from customer_credits where id='CR1'`)).rows[0].used),20,'credit failure restores prior credit draw');

  await db.exec(`insert into sales_orders(id,customer_id,estimate_id,promo_applied,promo_amount,credit_applied,credit_amount,fund_allocation_status) values ('SO1','C1','E1',true,60,true,20,'pending')`);
  await call('sales_order','SO1','C1',60,20,'E1');
  assert.equal(Number((await db.query(`select count(*) n from customer_promo_usage where estimate_id='E1' and so_id is null`)).rows[0].n),0,'conversion removes estimate promo usage');
  assert.equal(Number((await db.query(`select count(*) n from customer_promo_usage where so_id='SO1'`)).rows[0].n),1,'conversion creates SO promo usage');
  assert.equal(Number((await db.query(`select used from customer_promo_periods where customer_id='P'`)).rows[0].used),60,'conversion does not double promo');
  assert.equal((await db.query(`select status from estimates where id='E1'`)).rows[0].status,'converted','conversion marks estimate');
  assert.equal((await db.query(`select fund_allocation_status from sales_orders where id='SO1'`)).rows[0].fund_allocation_status,'posted','conversion posts SO');

  await call('estimate','E3','C2',40,0);
  assert.equal(Number((await db.query(`select used from customer_promo_periods where customer_id='P'`)).rows[0].used),100,'sibling consumes shared parent remainder');
  failed=false;
  try{await call('estimate','E2','C2',0,1)}catch(e){failed=/account credit insufficient/.test(e.message)}
  assert(failed,'credits do not cross sibling accounts');

  await call('sales_order','SO1','C1',0,0);
  assert.equal(Number((await db.query(`select used from customer_promo_periods where customer_id='P'`)).rows[0].used),40,'zero replacement releases SO promo');
  assert.equal(Number((await db.query(`select used from customer_credits where id='CR1'`)).rows[0].used),0,'zero replacement releases SO credit');

  await db.exec(`update customer_promo_periods set used=41 where customer_id='P'`);
  failed=false;
  try{await call('estimate','E2','C2',0,0)}catch(e){failed=/promo ledger counters need review/.test(e.message)}
  assert(failed,'runtime allocation rejects a mismatched promo counter');
  await db.exec(`update customer_promo_periods set used=40 where customer_id='P'; update customer_credits set used=1 where id='CR1'`);
  failed=false;
  try{await call('sales_order','SO1','C1',0,0)}catch(e){failed=/credit ledger counters need review/.test(e.message)}
  assert(failed,'runtime allocation rejects a mismatched credit counter');
  await db.exec(`update customer_credits set used=0 where id='CR1'`);

  failed=false;
  try{await db.exec(`insert into sales_orders(id,customer_id,estimate_id) values ('SO2','C1','E1')`)}catch(e){failed=true}
  assert(failed,'second live SO for estimate rejected');

  await db.exec(`select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false); select set_config('app.is_team_member','true',false);`);
  await call('estimate','E2','C2',0,0);
  await db.exec(`select set_config('app.is_team_member','false',false);`);
  failed=false;
  try{await call('estimate','E2','C2',0,0)}catch(e){failed=/staff authentication required/.test(e.message)}
  assert(failed,'authenticated nonstaff rejected');

  console.log('fund allocation PostgreSQL scenarios passed');
  await db.close();
})().catch(e=>{console.error(e);process.exit(1)});
