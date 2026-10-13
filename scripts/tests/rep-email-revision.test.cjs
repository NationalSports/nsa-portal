const {test}=require('node:test');const assert=require('node:assert/strict');
const {authored,normalizeRevision,matchRemoval,prepareRevision}=require('../../netlify/functions/_repEmailRevision');
const item={id:1,sku:'5159394',name:'Adidas Defender 5 Backpack',color:'Black/Black'};
const request={kind:'remove_items',estimate_ref:'EST-2618',requests:[{name:'backpacks',message_id:'m',evidence:'without the backpacks'}]};
const messages=[{id:'m',from:'fisherc@smccd.edu',subject:'Gear',text:'Update the quote without the backpacks',attachments:['EST-2618.pdf']}];
const snapshot={estimate:{id:'EST-2618',status:'open',customer_id:'c'},items:[item,{id:2,name:'Polo'}],sales_orders:[]};
const work={customer_id:'c'};
function db(s=snapshot,audit=[]){return {rpc:async()=>({data:s}),from:()=>{const q={select:()=>q,eq:()=>q,then:(a,b)=>Promise.resolve({data:audit}).then(a,b)};return q}}}
test('authored text excludes quoted history and removal matching is exact for SKU/color',()=>{
 assert.equal(authored('Thank you\nFrom: Steve\nremove backpacks'),'Thank you');
 assert.equal(authored('Thanks\nOn Tuesday Steve wrote:\nremove backpacks'),'Thanks');
 assert.deepEqual(matchRemoval({name:'backpacks'},[item]),[item]);
 assert.equal(matchRemoval({sku:'5159394',color:'Navy'},[item]).length,0);
 assert.equal(normalizeRevision({kind:'injected'}),null);
});
test('verified removal prepares original graph and exact line without writes',async()=>{
 const p=await prepareRevision(db(),request,work,messages);assert.equal(p.state,'ready');assert.deepEqual(p.removed,[item]);assert.equal(p.snapshot,snapshot);
});
test('customer mismatch, multiple estimates, ambiguous lines and conversion stop revisions',async()=>{
 assert.equal((await prepareRevision(db(),request,{customer_id:'other'},messages)).state,'blocked');
 assert.equal((await prepareRevision(db({...snapshot,sales_orders:[{id:'SO-123'}]}),request,work,messages)).state,'blocked');
 assert.equal((await prepareRevision(db({...snapshot,items:[item,{...item,id:3}]}),request,work,messages)).state,'blocked');
 assert.equal((await prepareRevision(db(),{...request,estimate_ref:null},work,[{...messages[0],attachments:['EST-2618.pdf','EST-2619.pdf']}])).state,'blocked');
});
test('quoted requests, invented evidence/message ids and other alterations require manual review',async()=>{
 for(const r of [{...request,kind:'other'},{...request,requests:[{...request.requests[0],message_id:'invented'}]},{...request,requests:[{...request.requests[0],evidence:'remove all polos'}]}])assert.equal((await prepareRevision(db(),r,work,messages)).state,'blocked');
 assert.equal((await prepareRevision(db(),request,work,[{...messages[0],text:'Thanks\nFrom: Christina\nwithout the backpacks'}])).state,'blocked');
});
test('already removed requires audit evidence; absent or partial matches remain blocked',async()=>{
 const s={...snapshot,items:[{id:2,name:'Polo'}]};
 assert.equal((await prepareRevision(db(s),request,work,messages)).state,'blocked');
 assert.equal((await prepareRevision(db(s,[{item_snapshot:item}]),request,work,messages)).state,'already_removed');
});
