// Offline PGlite proof for supabase/migrations/20261014160000_permanent_art_ids.sql.
// Run from the repo root with @electric-sql/pglite available (see README).
const fs=require('fs');const path=require('path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
(async()=>{
 const db=new PGlite();
 let ok=0;const eq=(a,b,m)=>{if(JSON.stringify(a)!==JSON.stringify(b)){console.error('FAIL',m,a,b);process.exit(1)}ok++};
 await db.exec(`create schema auth; create function auth.role() returns text language sql as $$ select current_setting('test.role',true) $$;
  create role authenticated; create role anon; create role service_role;
  create function public.is_team_member() returns boolean language sql as $$ select coalesce(current_setting('test.staff',true),'')='yes' $$;
  create table public.customers(id text primary key, parent_id text, art_files jsonb);
  insert into customers values ('c-b',null,'[{"id":"caf2"},{"id":"caf3"}]'),('c-a',null,'[{"id":"caf1"}]'),('c-x',null,null),('c-y',null,'{"bad":1}');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261014160000_permanent_art_ids.sql','utf8'));
 // re-run safety
 await db.exec(fs.readFileSync('supabase/migrations/20261014160000_permanent_art_ids.sql','utf8'));
 const q=async s=>(await db.query(s)).rows;
 eq(await q(`select art_number::int n,customer_id,art_id from art_ids order by 1`),[{n:1,customer_id:'c-a',art_id:'caf1'},{n:2,customer_id:'c-b',art_id:'caf2'},{n:3,customer_id:'c-b',art_id:'caf3'}],'backfill stable, rerun adds nothing');
 // non-staff denied
 let denied=false;try{await q(`select assign_art_code('c-a','caf1','Red','v1')`)}catch(e){denied=/staff/.test(e.message)}
 eq(denied,true,'anonymous caller denied');
 await db.exec(`set test.staff='yes'`);
 const code=async(c,a,v,r)=>(await q(`select assign_art_code(${[c,a,v,r].map(x=>x==null?'null':`'${x}'`).join(',')}) c`))[0].c;
 eq(await code('c-a','caf1',null,null),'ART-000001','master only');
 eq(await code('c-a','caf1','Black','vb1'),'ART-000001-V01-R01','first color');
 eq(await code('c-a','caf1','Red ','vr1'),'ART-000001-V02-R01','second color');
 eq(await code('c-a','caf1','  red','vr1'),'ART-000001-V02-R01','idempotent');
 eq(await code('c-a','caf1','RED','vr2'),'ART-000001-V02-R02','new revision same color (normalized)');
 eq(await code('c-a','caf1','Black','vb1'),'ART-000001-V01-R01','old still same');
 eq(await code('c-z','caf9','Navy','vn1'),'ART-000004-V01-R01','unknown folder entry numbered on demand');
 eq(await code('c-b','caf1','Black','vb1'),'ART-000005-V01-R01','same art id other customer = different logo');
 let bad=false;try{await code('c-a','caf1','','x')}catch(e){bad=/garment color/.test(e.message)}eq(bad,true,'blank color rejected');
 // trigger: new art, bad shapes never block saves
 await db.exec(`update customers set art_files=art_files||'[{"id":"caf10"},{"name":"no id"},"junk"]' where id='c-a'`);
 eq((await q(`select art_number::int n from art_ids where customer_id='c-a' and art_id='caf10'`)).length,1,'trigger registers new art');
 await db.exec(`update customers set art_files='"oops"' where id='c-a'; insert into customers values ('c-new',null,'[{"id":"n1"}]')`);
 eq((await q(`select 1 from art_ids where customer_id='c-new'`)).length,1,'insert trigger');
 // removing art from folder keeps its number
 await db.exec(`update customers set art_files='[]' where id='c-b'`);
 await db.exec(`update customers set art_files='[{"id":"caf10"}]' where id='c-a'`);await db.exec(`update customers set art_files='[{"id":"caf10"}]' where id='c-a'`);
 eq((await q(`select count(*)::int c from art_ids where customer_id='c-b'`))[0].c,3,'numbers never deleted');
 eq((await q(`select count(distinct art_number)::int c, count(*)::int t, max(art_number)::int m from art_ids`))[0],{c:7,t:7,m:7},'unique numbers, no gaps from repeat saves');
 console.log('PASS',ok,'permanent Art ID checks');
})().catch(e=>{console.error(e);process.exit(1)});
