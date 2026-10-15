const {test}=require('node:test');
const {PGlite}=require(process.env.VENDOR_PRICE_LIST_PGLITE_PATH || '@electric-sql/pglite');
const fs=require('fs'),assert=require('assert');
test('vendor price-list publication, lifecycle, search and access controls',async()=>{
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table public.vendors(id text primary key,name text,is_active boolean); insert into vendors values('v1','Adidas',true),('v2','Under Armour',true),('v3','No catalog vendor',true); grant select on public.vendors to service_role;`);
 const migration=fs.readFileSync('supabase/migrations/20261011075229_vendor_price_lists.sql','utf8');
 await db.exec(migration);
 const actor='00000000-0000-4000-8000-000000000001';
 const docs=[['v1','ready',null,null],['v2','ready',null,null],['v1','ready','2099-01-01',null],['v1','ready',null,'2000-01-01'],['v1','archived',null,null],['v1','uploading',null,null],['v3','ready',null,null]];
 for(let i=0;i<docs.length;i++){
  const [vendor,status,effective,expires]=docs[i],id=`00000000-0000-4000-8000-00000000001${i}`;
  await db.query('insert into vendor_price_lists(id,vendor_id,file_name,storage_path,file_size,status,effective_date,expires_on,created_by) values($1,$2,$3,$4,100,$5,$6,$7,$8)',[id,vendor,'Price.xlsx',id,status,effective,expires,actor]);
  await db.query('insert into vendor_price_list_chunks values($1,1,$2,$3)',[id,'Sheet 1 rows 1-8','JY6033 Navy Tee | USD Cost $12.50']);
 }
 let r=await db.query("select * from search_vendor_price_lists('JY6033',null)");assert.equal(r.rows.length,3);
 r=await db.query("select * from search_vendor_price_lists('navy tee','v1')");assert.equal(r.rows.length,1);assert.equal(r.rows[0].vendor_name,'Adidas');
 assert.equal((await db.query("select * from search_vendor_price_lists('missing','v1')")).rows.length,0);
 // Every unprivileged role is denied both direct tables and search/publish RPCs.
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  for(const sql of ["select * from vendor_price_lists","select * from vendor_price_list_chunks","select * from search_vendor_price_lists('JY6033',null)"]){let denied=false;try{await db.query(sql);}catch(e){denied=e.message.includes('permission denied');}assert(denied,role+' must be denied');}
  await db.exec('reset role');
 }
 const id='00000000-0000-4000-8000-000000000099';
 await db.query("insert into vendor_price_lists(id,vendor_id,file_name,storage_path,file_size,created_by) values($1::uuid,'v3','New.pdf',$1::text,100,$2)",[id,actor]);
 await db.exec('set role service_role');
 await db.query('select publish_vendor_price_list($1,$2,$3)',[id,actor,JSON.stringify([{location:'PDF page 1',content:'ABC123 Cost $25.00'}])]);
 assert.equal((await db.query("select * from search_vendor_price_lists('ABC123','v3')")).rows.length,1);
 let rejected=false;try{await db.query('select publish_vendor_price_list($1,$2,$3)',[id,actor,'[]']);}catch{rejected=true;}assert(rejected,'cannot republish completed upload');
 await db.exec('reset role');
 assert.equal((await db.query("select public from storage.buckets where id='vendor-price-lists'")).rows[0].public,false);
 console.log('PASS: migration, source citations, vendor scoping, date/archive/incomplete exclusion, service-role publish, private bucket and anonymous/staff direct-access denial.');
 await db.close();
});
