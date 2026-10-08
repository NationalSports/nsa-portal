// Scratch PostgreSQL harness. PGLITE_MODULE may point at an externally installed
// @electric-sql/pglite module; this script never connects to a live database.
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
(async()=>{
 let db;
 if(process.env.PG_SCRATCH_SOCKET){
   // Only a local Unix socket is accepted. A live URL cannot accidentally be
   // passed to this destructive scratch fixture.
   if(!process.env.PG_SCRATCH_SOCKET.startsWith('/private/tmp/'))throw new Error('Scratch socket must live in /private/tmp');
   const {Client}=require(process.env.PG_MODULE||'pg');
   const client=new Client({host:process.env.PG_SCRATCH_SOCKET,port:Number(process.env.PG_SCRATCH_PORT||54991),user:'postgres',database:'postgres'});
   await client.connect();if(process.env.PG_SCRATCH_RESET==='1')await client.query('drop schema public cascade;create schema public;drop role if exists anon;drop role if exists authenticated;drop role if exists service_role;');db={exec:q=>client.query(q),query:(q,args)=>client.query(q,args),close:()=>client.end()};
 }else{db=new PGlite();await db.waitReady;}
 const meta=JSON.parse(read('scripts/pgtest/order_save_columns.json'));
 const q=n=>'"'+n.replaceAll('"','""')+'"';
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create function public.is_team_member() returns boolean language sql as $$select current_setting('test.staff',true)='true'$$;create table public.customers(id text primary key);create table public.products(id text primary key);create function public._log_stale_save(text,text,integer,integer) returns void language sql as $$select$$;");
 for(const table of [...new Set(meta.map(x=>x.table_name))]){
   const cols=meta.filter(x=>x.table_name===table).map(c=>q(c.column_name)+' '+(c.column_default?.startsWith('nextval(')?'serial':c.data_type==='ARRAY'?c.udt_name.slice(1)+'[]':c.data_type)+(c.is_nullable==='NO'?' not null':'')+(!c.column_default?.startsWith('nextval(')&&c.column_default?' default '+c.column_default:''));
   const owner=table.startsWith('estimate_')?'estimate_id':'so_id';
   cols.push('primary key('+((table.endsWith('art_files')||table==='so_jobs')?owner+',id':'id')+')');
   if(table==='estimate_items')cols.push('unique(estimate_id,item_index)');
   await db.exec('create table public.'+q(table)+'('+cols.join(',')+');');
 }
 // Essential production FK topology and version behavior; all column types,
 // NOT NULL constraints, and defaults above come from read-only schema metadata.
 for(const [table,col,parent] of [
  ['so_items','so_id','sales_orders'],['so_art_files','so_id','sales_orders'],['so_jobs','so_id','sales_orders'],['so_firm_dates','so_id','sales_orders'],
  ['so_item_decorations','so_item_id','so_items'],['so_item_pick_lines','so_item_id','so_items'],['so_item_po_lines','so_item_id','so_items'],
  ['estimate_items','estimate_id','estimates'],['estimate_art_files','estimate_id','estimates'],['estimate_item_decorations','estimate_item_id','estimate_items'],
 ])await db.exec(`alter table ${table} add foreign key(${col}) references ${parent}(id) on delete cascade;`);
 await db.exec("create function bump_save_version() returns trigger language plpgsql as $$begin new._version=old._version+1;return new;end$$;");
 for(const table of ['sales_orders','estimates','so_art_files','so_jobs','estimate_art_files'])await db.exec(`create trigger version before update on ${table} for each row execute function bump_save_version();`);
 await db.exec(read('supabase/migrations/20260901151655_guard_estimate_decoration_shrinks.sql'));
 await db.exec(read('supabase/migrations/20260901154306_fix_estimate_decoration_shrink_null_guard.sql'));
 await db.exec(read('supabase/migrations/20260905134208_atomic_sales_order_save.sql'));
 await db.exec(read('supabase/migrations/20260905135224_stable_order_line_identity.sql'));
 await db.exec(read('supabase/migrations/20260905164405_preserve_order_trigger_search_path.sql'));
 // Production trigger functions include unqualified references inherited from the writer.
 await db.exec("create function order_estimate_trigger() returns trigger language plpgsql as $$begin perform id from estimates where id=new.estimate_id;return new;end$$;create trigger order_estimate_check before insert or update on sales_orders for each row execute function order_estimate_trigger();");
 // Match the live relationship trigger: it must not repair a legacy link
 // during an unrelated memo edit. The migration limits its UPDATE columns.
 await db.exec(`create function public.enforce_so_estimate_customer() returns trigger language plpgsql as $$
 declare est_customer text;begin
 if new.estimate_id is not null then select customer_id into est_customer from estimates where id=new.estimate_id;
 if est_customer is not null and new.customer_id is not null and est_customer<>new.customer_id then new.estimate_id:=null;end if;end if;
 return new;end$$;`);
 await db.exec(read('supabase/migrations/20260905174346_sales_order_memo_command.sql'));
 const query=async(sql,args=[]) => (await db.query(sql,args.map(a=>a!==null&&typeof a==='object'?JSON.stringify(a):a))).rows;
 await db.exec(read('supabase/migrations/20260906052148_save_storm_quarantine.sql'));
 await db.exec(`create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table public.team_members(id text,auth_id uuid,role text,name text,is_active boolean default true);
 insert into team_members values('a','00000000-0000-4000-8000-000000000001','rep','Alice',true),('b','00000000-0000-4000-8000-000000000002','rep','Bob',true),('s','00000000-0000-4000-8000-000000000003','admin','Steve',true);
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
 grant usage,select on all sequences in schema public to authenticated,service_role;
 insert into sales_orders(id) values('SO-LEASE');
 `);
 await db.exec(read('supabase/migrations/20261008075010_sales_order_edit_leases.sql'));
 const user=async n=>{await db.exec('reset role');await db.exec(`set "test.staff"='true';set "test.uid"='00000000-0000-4000-8000-${String(n).padStart(12,'0')}';set role authenticated;`)};
 const session=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const lease=async(s,action,g=null)=>(await query('select public.sales_order_edit_lease($1,$2,$3,$4) result',['SO-LEASE',session(s),action,g]))[0].result;
 const assertLease=async(s,g)=>query('select private.assert_sales_order_edit_lease($1,$2)',['SO-LEASE',s?{session:session(s),generation:g}:null]);
 await user(1);const a=await lease(1,'acquire');assert.equal(a.owned,true);
 assert.equal((await lease(2,'acquire')).owned,false,'same user second tab cannot also edit');
 await assert.rejects(assertLease(null),/SO_EDIT_LEASE_REQUIRED/);
 await assertLease(1,a.generation);
 await user(2);assert.equal((await lease(3,'acquire')).owned,false);await assert.rejects(lease(3,'takeover',a.generation),/EDIT_TAKEOVER_FORBIDDEN/);
 await assert.rejects(assertLease(1,a.generation),/SO_EDIT_LEASE_LOST/);
 console.log('PASS single owner across tabs and users, legacy full-save block, no impersonation');
 await user(3);const b=await lease(4,'takeover',a.generation);assert.equal(b.owned,true);assert.ok(b.generation>a.generation);
 await user(1);assert.equal((await lease(1,'renew',a.generation)).owned,false);await lease(1,'release',a.generation);
 await assert.rejects(assertLease(1,a.generation),/SO_EDIT_LEASE_LOST/);
 await user(3);await assertLease(4,b.generation);
 assert.equal((await lease(5,'takeover',a.generation)).owned,false,'stale takeover confirmation cannot revoke newer owner');
 console.log('PASS admin takeover fences stale saves, renewals, releases and takeover requests');
 // Execute the actual installed full-save RPC, not just its assertion helper.
 const token=async()=>(await query("select sales_order_save_token('SO-LEASE') t"))[0].t;
 const plan={header:{id:'SO-LEASE',memo:'saved by owner',updated_at:new Date().toISOString()},base_version:0,write_header:true,art_upserts:[],art_deletes:[],job_upserts:[],job_deletes:[]};
 const row=(await query("select _version from sales_orders where id='SO-LEASE'"))[0];plan.base_version=row._version;
 const save=async(p,t)=>(await query("select save_sales_order_atomic('SO-LEASE',$1,$2) result",[t,p]))[0].result;
 await assert.rejects(save(plan,await token()),/SO_EDIT_LEASE_REQUIRED/);
 const t=await token();plan.edit_lease={session:session(4),generation:b.generation};
 const saved=await save(plan,t);assert.equal(saved.saved,true);assert.deepEqual(await save(plan,t),saved,'same-owner lost response retry is idempotent');
 // Another authorized same-user tab takes over, then even a receipt replay is fenced.
 const c=await lease(5,'takeover',b.generation);assert.equal(c.owned,true);
 await assert.rejects(save(plan,t),/SO_EDIT_LEASE_LOST/);
 // Narrow child-only artwork operation remains available while the order is leased.
 const art=await save({header:{id:'SO-LEASE'},write_header:false,art_upserts:[],art_deletes:[],job_upserts:[],job_deletes:[]},await token());assert.equal(art.saved,true);
 console.log('PASS real full-save ownership enforcement, idempotent retry, revoked receipt rejection, targeted artwork path');
 await db.exec('reset role');await query("update private.sales_order_edit_leases set expires_at=now()-interval '1 second' where so_id='SO-LEASE'");
 await user(3);await assert.rejects(assertLease(5,c.generation),/SO_EDIT_LEASE_LOST/);await assertLease(null);
 const d=await lease(5,'acquire');assert.ok(d.generation>c.generation);await assert.rejects(assertLease(5,c.generation),/SO_EDIT_LEASE_LOST/);
 console.log('PASS expiry releases legacy callers but never revives a fenced payload');
 await assert.rejects(query('select * from private.sales_order_edit_leases'),/permission denied/);
 await db.exec('reset role;set role anon');await assert.rejects(lease(6,'acquire'),/permission denied/);
 await db.exec('reset role;set "test.staff"=\'false\';set role authenticated');await assert.rejects(lease(6,'acquire'),/STAFF_REQUIRED/);
 console.log('PASS private-table denial, anon denial, nonstaff denial');
 await db.close();
})().catch(error=>{console.error(error);process.exitCode=1});
