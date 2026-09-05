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
 const query=async(sql,args=[]) => (await db.query(sql,args.map(a=>a!==null&&typeof a==='object'?JSON.stringify(a):a))).rows;
 const token=async id=>(await query('select sales_order_save_token($1) t',[id]))[0].t;
 const estToken=async id=>(await query('select estimate_save_token($1) t',[id]))[0].t;
 const save=async(id,t,plan)=>(await query('select save_sales_order_atomic($1,$2,$3) result',[id,t,plan]))[0].result;
 const plan=(id,base,items)=>({header:{id,memo:'saved',status:'open'},base_version:base,is_new:base==null,items,art_upserts:[{id:'ART',name:'new art'}],art_deletes:[],job_upserts:[{id:'JOB',art_name:'new job'}],job_deletes:[],firm_dates:[{date:'2026-10-01'}]});
 const item=(sku,index,extra={})=>({sku,item_index:index,sizes:{M:3},invoice_line_keys:[],decorations:[{deco_index:0,kind:'art',art_file_id:'ART'}],pick_lines:[{pick_id:'IF-1',sizes:{M:1}}],po_lines:[{po_id:'PO-1',sizes:{M:2}}],...extra});
 let id='SO-TEST';let t=await token(id);let p=plan(id,null,[item('A',0),item('B',1)]);
 const first=await save(id,t,p);assert.equal(first.saved,true);assert.equal(first.version,1);assert.equal((await query('select * from so_items')).length,2);
 assert.deepEqual(await save(id,t,p),first,'lost HTTP response retry returns same acknowledgement');
 assert.equal((await query('select * from so_item_decorations')).length,2,'retry never duplicates children');
 console.log('PASS full SO creation and identical-response retry');
 let before=await token(id);p=plan(id,1,[item('A',0),item('B',1,{po_lines:[{po_id:'PO-X',bogus_schema_column:true}]})]);
 await assert.rejects(save(id,before,p),/SAVE_SCHEMA_MISMATCH/);assert.equal(await token(id),before,'late child failure rolls back header/jobs/art/dates/items');
 console.log('PASS rollback after late child insert failure');
 // A child-only update advances no parent version. The aggregate token still
 // rejects the stale prepared plan, preserving another user's receiving edit.
 p=plan(id,1,[item('A',0)]);before=await token(id);await query("update so_item_po_lines set received='{"+'"M":1'+"}' where po_id='PO-1'");
 await assert.rejects(save(id,before,p),/STALE_SO_WRITE/);
 console.log('PASS concurrent child-only change rejects stale plan');
 before=await token(id);p=plan(id,1,null);p.firm_dates=null;p.art_upserts=[];p.job_upserts=[];
 await save(id,before,p);assert.equal((await query('select * from so_items')).length,2);assert.equal((await query('select * from so_firm_dates')).length,1);
 console.log('PASS missing collections preserved');
 before=await token(id);p=plan(id,1,[item('A',0)]);await assert.rejects(save(id,before,p),/different version/);assert.equal(await token(id),before);
 console.log('PASS stale edit base rejected even with freshly fetched token');
 before=await token(id);const artPlan={header:{id},write_header:false,art_upserts:[{id:'ART',name:'art only'}],art_deletes:[]};
 const artResult=await save(id,before,artPlan);assert.equal(artResult.version,2);assert.equal((await query('select name from so_art_files'))[0].name,'art only');
 assert.deepEqual(await save(id,before,artPlan),artResult);assert.equal((await query('select * from so_items')).length,2);
 console.log('PASS art-only atomic save preserves parent revision and items');
 before=await token(id);await assert.rejects(save(id,before,{...artPlan,items:{}}),/INVALID_SAVE_COLLECTION/);assert.equal(await token(id),before);
 await assert.rejects(save(id,before,{...artPlan,items:[{sku:'BROKEN',item_index:0}]}),/INVALID_SAVE_ITEM_COLLECTION/);assert.equal(await token(id),before);
 console.log('PASS malformed collections roll back without deleting saved children');

 // Exact screenshot structure: four decorated polos, two undecorated pants,
 // a plain short and decorated crew. Removing earlier lines shifts pants to 0/1.
 const eid='EST-2429';await query("insert into estimates(id,memo) values($1,'original')",[eid]);
 const skus=['JM5226','KE8824','KB9113','KD5431','IU2837','IQ2957','IP9746','IY8738'];
 for(let i=0;i<skus.length;i++){
   const row=(await query('insert into estimate_items(estimate_id,item_index,sku,sizes) values($1,$2,$3,$4) returning id',[eid,i,skus[i],{M:3}]))[0];
   if(i<4||i===7)await query("insert into estimate_item_decorations(estimate_item_id,deco_index,kind) values($1,0,'art')",[row.id]);
 }
 const old=await query('select * from estimate_items order by item_index');
 const estSave=async(items,base,intents={},arts=[])=>query('select save_estimate($1,$2,$3,false,$4,$5,$6,$7) result',[{id:eid,memo:'edited'},items,base,intents,arts,[],await estToken(eid)]);
 const pants=old.slice(4,6).map((r,i)=>({line_id:r.line_id,sku:r.sku,item_index:i,sizes:r.sizes,decorations:[]}));
 await estSave(pants,1);assert.equal((await query('select * from estimate_items')).length,2);assert.deepEqual((await query('select sku,id from estimate_items order by item_index')).map(x=>[x.sku,x.id]),old.slice(4,6).map(x=>[x.sku,x.id]));
 console.log('PASS eight-to-two screenshot regression; garment identities and row IDs survive');
 // A true decoration removal still needs intent after a reorder.
 const r=(await query('select * from estimate_items order by item_index'))[0];await query("insert into estimate_item_decorations(estimate_item_id,deco_index,kind) values($1,0,'art')",[r.id]);
 const swapped=[{...pants[1],item_index:0},{...pants[0],item_index:1}];let estBefore=await estToken(eid);
 await assert.rejects(estSave(swapped,2),/ESTIMATE_DECORATION_SHRINK_BLOCKED/);assert.equal(await estToken(eid),estBefore);
 await estSave(swapped,2,{['line:'+r.line_id]:{from:1,to:0}});
 assert.deepEqual((await query('select sku from estimate_items order by item_index')).map(x=>x.sku),['IQ2957','IU2837']);
 console.log('PASS reorder plus explicit decoration removal; unapproved removal rolls back');
 estBefore=await estToken(eid);await assert.rejects(estSave(swapped,3,{},[{id:'ART',nonexistent_column:true}]),/SAVE_SCHEMA_MISMATCH/);assert.equal(await estToken(eid),estBefore);
 console.log('PASS estimate artwork failure rolls back item/header changes');
 // Legacy outbox without line_id can recover a uniquely identifiable garment.
 await estSave(swapped.map(({line_id,...r})=>r),3);assert.equal(Number((await query('select count(*) n from estimate_items'))[0].n),2);
 console.log('PASS legacy draft recovery matches garments without using their positions');
 const retryArgs=[{id:eid,memo:'retry'},swapped,4,{},[],[],await estToken(eid)];
 const retrySql='select save_estimate($1,$2,$3,false,$4,$5,$6,$7) result';
 const estAck=await query(retrySql,retryArgs);assert.deepEqual(await query(retrySql,retryArgs),estAck);
 console.log('PASS estimate repeated request returns original commit acknowledgement');

 await db.exec('grant usage on schema public to authenticated,anon;set role authenticated;');
 await assert.rejects(query("select sales_order_save_token('SO-TEST')"),/STAFF_REQUIRED/);await db.exec('reset role;set role anon;');
 await assert.rejects(query("select save_sales_order_atomic('SO-TEST','x','{}')"),/permission denied/);await db.exec('reset role;');
 console.log('PASS anonymous and nonstaff access blocked');
 await db.close();console.log('ALL_ORDER_SAVE_SCENARIOS_PASSED');
})().catch(e=>{console.error(e.message,e.where||'');process.exit(1)});
