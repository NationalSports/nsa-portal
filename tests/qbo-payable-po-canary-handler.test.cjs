const test=require('node:test');
const assert=require('node:assert/strict');

const candidate={poId:'PO 60000 TEST',vendor:'S&S Activewear',date:'2026-09-18',total:25,qboVendorId:'2382',vendorMatchSource:'durable_link',action:'ready_create',sourceLineIds:['10']};
const report={reviewerVersion:2,replay:{identical:true,runs:2},safeguards:{qboWrites:0,portalWrites:0,historicalPayablesProposed:0,historicalPurchaseOrdersProposed:0},purchaseOrders:{awaiting:[candidate]},accounts:{purchases_account:{id:'1150040071',number:'51300'}},sourceHash:'source'};
const run={id:'run',snapshot_id:'snap',report};
const group={poId:candidate.poId,vendor:candidate.vendor,date:candidate.date,total:25,accountKey:'purchases_account',historical:false,lines:[{sourceLineId:'10',sourceOrderId:'SO-1'}]};
const vendor={Id:'2382',Active:true},account={Id:'1150040071',AcctNum:'51300',AccountType:'Cost of Goods Sold',Active:true};
let created=false,postCount=0;
const po={Id:'999',DocNumber:candidate.poId,VendorRef:{value:'2382'},TxnDate:candidate.date,TotalAmt:25,Line:[{Amount:25,DetailType:'AccountBasedExpenseLineDetail',AccountBasedExpenseLineDetail:{AccountRef:{value:'1150040071'}}}]};

function inject(path,exports){const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports}}
const state=new Map();
const admin={from(table){
  const query={table,filters:{},values:null,op:'select',select(){if(this.op==='update')return Promise.resolve(this.finishUpdate());return this},eq(field,value){this.filters[field]=value;return this},in(){return this},not(){return this},order(){return this},
    limit(){return Promise.resolve({data:table==='qbo_payable_review_runs'?[run]:[],error:null})},
    maybeSingle(){if(table==='app_state')return Promise.resolve({data:state.has(this.filters.id)?{value:state.get(this.filters.id).value}:null,error:null});return Promise.resolve({data:null,error:null})},
    update(values){this.op='update';this.values=values;return this},finishUpdate(){if(table==='app_state'&&state.has(this.filters.id)){state.set(this.filters.id,{...state.get(this.filters.id),...this.values});return{data:[{id:this.filters.id}],error:null}}return{data:[],error:null}},
    insert:async value=>{if(state.has(value.id))return{error:{code:'23505'}};state.set(value.id,value);return{error:null}},
    upsert:async value=>{state.set(value.id,value);return{error:null}},
  };return query;
}};
inject('../netlify/functions/_shared',{verifyQBOUser:async()=>({ok:true,userId:'accounting-user'}),getSupabaseAdmin:()=>admin});
inject('../netlify/functions/_qboReviewConfig',{reviewEnabled:()=>true});
inject('../netlify/functions/_qboPayableReviewStore',{payableReviewStore:()=>({snapshot:async()=>({links:{qbPOMap:{}}})})});
inject('../netlify/functions/_qboPayableServerReview',{buildPortalPOGroups:()=>[group]});
inject('../netlify/functions/_qb',{getValidAccessToken:async()=>({realm_id:'9341456492604246',access_token:'token'}),qbRequest:async(method,url,_token,payload)=>{
  if(method==='POST'){postCount++;created=true;assert.equal(payload.DocNumber,candidate.poId);return{status:200,data:{PurchaseOrder:po}}}
  const sql=decodeURIComponent(url.split('query=')[1]||'');
  if(sql.includes('FROM Vendor'))return{status:200,data:{QueryResponse:{Vendor:[vendor]}}};if(sql.includes('FROM Account'))return{status:200,data:{QueryResponse:{Account:[account]}}};
  if(sql.includes('FROM PurchaseOrder WHERE Id'))return{status:200,data:{QueryResponse:{PurchaseOrder:created?[po]:[]}}};if(sql.includes('FROM PurchaseOrder WHERE DocNumber'))return{status:200,data:{QueryResponse:{PurchaseOrder:created?[po]:[]}}};throw new Error('unexpected query '+sql);
}});
process.env.QBO_REVIEW_REALM_ID='9341456492604246';
const {handler}=require('../netlify/functions/qbo-payable-po-canary');

test('previews with fresh QBO reads, then creates and verifies exactly one PO',async()=>{
  const preview=JSON.parse((await handler({httpMethod:'POST',body:JSON.stringify({action:'preview'})})).body);assert.equal(preview.mode,'preview');assert.equal(preview.writes,0);assert.equal(postCount,0);
  const result=JSON.parse((await handler({httpMethod:'POST',body:JSON.stringify({action:'execute',approved:true,previewHash:preview.previewHash})})).body);assert.equal(result.status,'complete');assert.equal(result.qboPurchaseOrderId,'999');assert.equal(postCount,1);
  assert.equal(JSON.parse(state.get('_qb_payable_po_canary_attempt_9341456492604246').value).status,'complete');
  const link=[...state.entries()].find(([key])=>decodeURIComponent(key)==='_qb_link_v1_["9341456492604246","qbPOMap","PO 60000 TEST"]');assert.ok(link);assert.equal(JSON.parse(link[1].value).evidence.inventory_quantity_posted,false);
  const recovered=JSON.parse((await handler({httpMethod:'POST',body:JSON.stringify({action:'preview'})})).body);assert.equal(recovered.status,'complete');assert.equal(postCount,1);
});
