// Isolated PostgreSQL regression. Never connects to the live project.
const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs'),assert=require('node:assert/strict');
const {config,canViewPortalPage}=require('../src/lib/portalAccess.shared');
const tables=require('./portal-audit-tables.json');
(async()=>{
 const db=new PGlite();let checks=0;
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;grant usage on schema auth to anon,authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.test_uid',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.test_jwt',true),''),'{}')::jsonb$$;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table team_members(id text primary key,auth_id uuid,name text,role text,email text,phone text,is_active boolean,access text[]);
 create table user_profiles(id uuid,auth_id uuid,role text);
 create table app_state(id text primary key,value text,version integer default 0,updated_at timestamptz);
 create table omg_store_commission_months(id text,rep_id text);
 create table commission_snapshots(id text primary key,rep_id text,amount numeric);
 create table coach_accounts(id uuid primary key,auth_user_id uuid,email text,status text,customer_id text);
 create table coach_customer_access(id uuid,coach_id uuid,customer_id text);
 create table roster_order_sessions(id uuid primary key,customer_id text);
 create table roster_teams(id uuid primary key,session_id uuid);
 create table roster_players(id uuid primary key,team_id uuid);
 create table roster_player_sizes(id uuid primary key,player_id uuid);
 create table roster_team_coaches(id uuid primary key,team_id uuid,coach_id uuid);
 create table roster_kit_templates(id uuid primary key,customer_id text);
 create table document_history_snapshots(seq bigint,kind text,document_id text,entry jsonb);
 create function public.is_admin_member() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from team_members where auth_id=auth.uid() and is_active is not false and role in ('admin','super_admin'))$$;
 create function public.is_team_member() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from team_members where auth_id=auth.uid() and is_active is not false)$$;
 create function public.link_team_auth(p_team_id text,p_auth_id uuid) returns void language plpgsql security definer as $$begin update team_members set auth_id=p_auth_id where id=p_team_id;end$$;
 create function public.reserve_po_number() returns bigint language sql security definer as $$select 123::bigint$$;
 create function public.unclassified_privileged_rpc() returns text language sql security definer as $$select 'private data'$$;
 create function public.app_state_cas(p_key text,p_expected integer,p_value text) returns integer language plpgsql security definer as $$begin update public.app_state set value=p_value,version=version+1 where id=p_key and version=p_expected;return 1;end$$;`);
 for(const table of tables){await db.exec(`create table if not exists public.${table}(id text primary key,customer_id text);alter table public.${table} enable row level security;grant all on public.${table} to authenticated,service_role;grant select on public.${table} to anon;create policy baseline_read on public.${table} for select to anon,authenticated using(true);create policy baseline_staff on public.${table} for all to authenticated using(public.is_team_member()) with check(public.is_team_member());`);}
 await db.exec(`create policy team_members_staff_write on team_members for all to authenticated using(public.is_team_member()) with check(public.is_team_member());
 insert into team_members(id,auth_id,name,role,email,is_active,access) values
 ('rep','00000000-0000-0000-0000-000000000101','Rep','rep','rep@test.invalid',true,array['orders','commissions']),
 ('admin','00000000-0000-0000-0000-000000000102','Admin','admin','admin@test.invalid',true,null),
 ('limited-admin','00000000-0000-0000-0000-000000000103','Limited admin','admin','limited@test.invalid',true,array['orders']),
 ('inactive','00000000-0000-0000-0000-000000000104','Inactive','admin','inactive@test.invalid',false,null),
 ('artist','00000000-0000-0000-0000-000000000105','Artist','artist','artist@test.invalid',true,array['art','messages']);
 insert into invoices(id) values('INV-TEST');insert into sales_orders(id) values('SO-TEST');
 insert into app_state(id,value) values('labor_rates','secret'),('qb_config','secret'),('comm_rep_comp','secret'),('unknown_secret','secret'),('so_history','orders');
 insert into commission_snapshots values('own','rep',100),('other','admin',200);`);
 for(const name of ['20261010101040_app_readiness_staff_permissions.sql','20261010103840_portal_section_authorization.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 await db.exec("insert into account_deletion_requests(auth_user_id,team_member_id) values ('00000000-0000-0000-0000-000000000101','rep'),('00000000-0000-0000-0000-000000000102','admin')");
 async function asUser(uid,role='authenticated'){await db.exec(`reset role;select set_config('request.test_uid','${uid||''}',false);select set_config('request.test_jwt','{"role":"${role}"}',false);set role ${role};`);}
 await asUser(null,'anon');assert.equal((await db.query('select * from invoices')).rows.length,0);checks++;
 assert.equal((await db.query('select * from team_members')).rows.length,0);checks++;
 assert.equal((await db.query('select * from app_state')).rows.length,0);checks++;
 await assert.rejects(()=>db.query('select public.unclassified_privileged_rpc()'),/permission denied/);checks++;
 await asUser('00000000-0000-0000-0000-000000000101');
 assert.equal((await db.query('select * from invoices')).rows.length,0);checks++;
 assert.equal((await db.query('select * from sales_orders')).rows.length,1);checks++;
 assert.equal((await db.query("update team_members set role='admin' where id='rep' returning id")).rows.length,0);checks++;
 assert.equal((await db.query('select * from commission_snapshots')).rows.length,1);checks++;
 assert.deepEqual((await db.query('select id from app_state order by id')).rows.map(x=>x.id),['so_history']);checks++;
 await assert.rejects(()=>db.query("select app_state_cas('labor_rates',0,'changed')"),/Section access required/);checks++;
 assert.equal((await db.query("select app_state_cas('so_history',0,'changed')")).rows[0].app_state_cas,1);checks++;
 assert.equal((await db.query('select reserve_po_number()')).rows[0].reserve_po_number,123);checks++;
 await asUser('00000000-0000-0000-0000-000000000103');
 assert.equal((await db.query('select * from account_deletion_requests')).rows.length,0);checks++;
 assert.equal((await db.query("update team_members set access=array['settings'] where id='rep' returning id")).rows.length,0);checks++;
 assert.equal((await db.query('select * from invoices')).rows.length,0);checks++;
 await asUser('00000000-0000-0000-0000-000000000102');
 assert.equal((await db.query('select * from commission_snapshots')).rows.length,1);checks++;
 assert.equal((await db.query("select * from app_state where id='comm_rep_comp'")).rows.length,0);checks++;
 await assert.rejects(()=>db.query("select app_state_cas('comm_rep_comp',0,'changed')"),/Section access required/);checks++;
 assert.equal((await db.query('select * from account_deletion_requests')).rows.length,2);checks++;
 assert.equal((await db.query("update team_members set access=array['orders','commissions'] where id='rep' returning id")).rows.length,1);checks++;
 await db.exec('reset role');await db.query("update team_members set access=array['messages'] where id='rep'");await asUser('00000000-0000-0000-0000-000000000101');
 assert.equal((await db.query('select * from sales_orders')).rows.length,0);checks++;
 await asUser('00000000-0000-0000-0000-000000000104');assert.equal((await db.query('select * from invoices')).rows.length,0);checks++;
 await db.exec("reset role;insert into team_members(id,auth_id,name,role,is_active,access) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000106','Steve','admin',true,array['commissions'])");
 await asUser('00000000-0000-0000-0000-000000000106');
 assert.equal((await db.query('select * from commission_snapshots')).rows.length,2);checks++;
 assert.equal((await db.query("select * from app_state where id='comm_rep_comp'")).rows.length,1);checks++;
 assert.equal((await db.query("select app_state_cas('comm_rep_comp',0,'changed')")).rows[0].app_state_cas,1);checks++;
 // Coach roster reads must never inherit a sibling account from a shared parent tag.
 await db.exec(`reset role;
 insert into auth.users values ('00000000-0000-0000-0000-000000000201','coach@test.invalid',now());
 insert into coach_accounts values ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201','coach@test.invalid','active','own-club');
 insert into roster_order_sessions values ('00000000-0000-0000-0000-000000000401','own-club'),('00000000-0000-0000-0000-000000000402','sibling-club');`);
 await asUser('00000000-0000-0000-0000-000000000201');
 assert.deepEqual((await db.query('select customer_id from roster_order_sessions')).rows.map(r=>r.customer_id),['own-club']);checks++;
 assert.equal((await db.query('select * from invoices')).rows.length,0);checks++;
 await db.exec(`reset role;update coach_accounts set status='disabled';`);
 await asUser('00000000-0000-0000-0000-000000000201');
 assert.equal((await db.query('select * from roster_order_sessions')).rows.length,0);checks++;
 // The SQL and JS policies must agree for every role, page and explicit/default/empty assignment.
 await db.exec('reset role');
 for(const role of Object.keys(config.defaults))for(const access of [null,[],['orders'],['settings','financials','receive_payments','ai_inbox','commissions']])for(const page of config.pages){
  const id='ordinary-staff';const result=await db.query('select private.portal_section_allowed($1,$2,$3::text[],$4) allowed',[id,role,access,page]);assert.equal(result.rows[0].allowed,canViewPortalPage({id,role,access},page),`${role}/${page}/${access}`);checks++;
 }
 for(const [page,ids]of Object.entries(config.identities))for(const id of ids)for(const access of [null,[],[page]]){assert.equal((await db.query('select private.portal_section_allowed($1,$2,$3::text[],$4) allowed',[id,'admin',access,page])).rows[0].allowed,canViewPortalPage({id,role:'admin',access},page));checks++;}
 console.log(`PASS: ${checks} PostgreSQL permission and JS/SQL parity assertions. Both migrations apply.`);
 await db.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
