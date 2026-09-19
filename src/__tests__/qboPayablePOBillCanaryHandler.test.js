jest.mock('../../netlify/functions/_shared',()=>({verifyQBOUser:jest.fn(),getSupabaseAdmin:jest.fn()}));
jest.mock('../../netlify/functions/_qb',()=>({getValidAccessToken:jest.fn(),qbRequest:jest.fn()}));
jest.mock('../../netlify/functions/_qboReviewConfig',()=>({reviewEnabled:()=>true}));

const {verifyQBOUser,getSupabaseAdmin}=require('../../netlify/functions/_shared');
const {getValidAccessToken,qbRequest}=require('../../netlify/functions/_qb');
const {linkKey}=require('../../netlify/functions/_qboPayablePOBillCanary');
const {handler}=require('../../netlify/functions/qbo-payable-po-bill-canary');

const realm='9341456492604246';
const candidate={ledgerId:'4000',documentNumber:'INV-4000',vendor:'SanMar',date:'2026-09-10',total:25,transactionType:'Bill',action:'ready',qboVendorId:'10',vendorMatchSource:'durable_link'};
const report={reviewerVersion:2,replay:{identical:true,runs:2},safeguards:{qboWrites:0,portalWrites:0,historicalPayablesProposed:0,historicalPurchaseOrdersProposed:0},results:[candidate],accounts:{purchases_account:{id:'50',number:'51300'},ap_account:{id:'60',number:'21100'}},sourceHash:'source'};
const run={id:'run',snapshot_id:'snap',status:'complete',report};
const sourceRow={id:4000,status:'pushed',portal_status:'success',qb_status:null,qb_bill_id:null,doc_number:'INV-4000',vendor:'SanMar',doc_total:25,is_credit:false,raw_meta:{doc_date:'09/10/2026',freight:0,si_upcharge:0,po_origin:'portal',po_number:'PO 4000',matchedPO:{po:{_payment_method:''}}}};

function fakeAdmin(){
  const state=new Map(),poKey=linkKey(realm,'qbPOMap','PO 4000');
  state.set(poKey,{id:poKey,value:JSON.stringify({realm_id:realm,map_key:'qbPOMap',source_id:'PO 4000',qbo_id:'70',active:true})});
  const query=table=>({table,op:'select',filters:{},values:null,
    select(){if(this.op==='update')return Promise.resolve(this.finishUpdate());this.op='select';return this},update(values){this.op='update';this.values=values;return this},eq(field,value){this.filters[field]=value;return this},is(){return this},not(){return this},order(){return this},
    in(field,values){if(table==='applied_bills')return Promise.resolve({data:[{...sourceRow}],error:null});if(table==='app_state')return Promise.resolve({data:values.map(id=>state.get(id)).filter(Boolean),error:null});return this},
    limit(){return table==='qbo_payable_review_runs'?Promise.resolve({data:[run],error:null}):Promise.resolve({data:[],error:null})},
    maybeSingle(){if(table==='app_state')return Promise.resolve({data:state.has(this.filters.id)?{value:state.get(this.filters.id).value}:null,error:null});if(table==='applied_bills')return Promise.resolve({data:{qb_status:sourceRow.qb_status,qb_bill_id:sourceRow.qb_bill_id},error:null});return Promise.resolve({data:null,error:null})},
    finishUpdate(){if(table==='app_state'&&state.has(this.filters.id)){state.set(this.filters.id,{...state.get(this.filters.id),...this.values});return{data:[{id:this.filters.id}],error:null}}if(table==='applied_bills'){Object.assign(sourceRow,this.values);return{data:[{id:sourceRow.id}],error:null}}return{data:[],error:null}},
  });
  return{state,from:jest.fn(table=>{const q=query(table);q.insert=async value=>{if(state.has(value.id))return{error:{code:'23505'}};state.set(value.id,value);return{error:null}};q.upsert=async value=>{state.set(value.id,value);return{error:null}};return q})};
}

const vendor={Id:'10',Active:true},accounts=[{Id:'50',AcctNum:'51300',AccountType:'Cost of Goods Sold',Active:true},{Id:'60',AcctNum:'21100',AccountType:'Accounts Payable',Active:true}];
const bill={Id:'80',DocNumber:'INV-4000',VendorRef:{value:'10'},APAccountRef:{value:'60'},TxnDate:'2026-09-10',TotalAmt:25,Balance:25,Line:[{Amount:25,DetailType:'AccountBasedExpenseLineDetail',LinkedTxn:[{TxnId:'70',TxnType:'PurchaseOrder',TxnLineId:'1'}],AccountBasedExpenseLineDetail:{AccountRef:{value:'50'}}}]};

function mockQbo(){
  let created=false;
  qbRequest.mockImplementation(async(method,url,_token,payload)=>{
    if(method==='POST'){created=true;expect(payload.LinkedTxn).toEqual([{TxnId:'70',TxnType:'PurchaseOrder'}]);expect(payload.Line).toBeUndefined();return{status:200,data:{Bill:bill}}}
    const sql=decodeURIComponent(url.split('query=')[1]||'');
    if(sql.includes('FROM PurchaseOrder'))return{status:200,data:{QueryResponse:{PurchaseOrder:[{Id:'70',DocNumber:'PO 4000',VendorRef:{value:'10'},POStatus:created?'Closed':'Open',TotalAmt:25,Line:[{Id:'1',Amount:25,DetailType:'AccountBasedExpenseLineDetail',AccountBasedExpenseLineDetail:{AccountRef:{value:'50'}}}],...(created?{LinkedTxn:[{TxnId:'80',TxnType:'Bill'}]}:{})}]}}};
    if(sql.includes('FROM Vendor WHERE'))return{status:200,data:{QueryResponse:{Vendor:[vendor]}}};
    if(sql.includes('FROM Account'))return{status:200,data:{QueryResponse:{Account:accounts}}};
    if(sql.includes('FROM Bill WHERE Id'))return{status:200,data:{QueryResponse:{Bill:created?[bill]:[]}}};
    if(sql.includes('FROM Bill WHERE DocNumber'))return{status:200,data:{QueryResponse:{Bill:created?[bill]:[]}}};
    if(sql.includes('FROM VendorCredit'))return{status:200,data:{QueryResponse:{VendorCredit:[]}}};
    throw new Error('unexpected query: '+sql);
  });
}

beforeEach(()=>{
  jest.clearAllMocks();process.env.QBO_REVIEW_REALM_ID=realm;sourceRow.qb_status=null;sourceRow.qb_bill_id=null;
  verifyQBOUser.mockResolvedValue({ok:true,userId:'accounting'});getValidAccessToken.mockResolvedValue({realm_id:realm,access_token:'token'});mockQbo();
});

test('previews without writes, then creates one linked bill and stores durable receipts',async()=>{
  const admin=fakeAdmin();getSupabaseAdmin.mockReturnValue(admin);
  const previewResponse=await handler({httpMethod:'POST',body:JSON.stringify({action:'preview'})}),preview=JSON.parse(previewResponse.body);
  expect(previewResponse.statusCode).toBe(200);expect(preview.writes).toBe(0);expect(preview.candidate.qboPurchaseOrderId).toBe('70');expect(qbRequest.mock.calls.filter(([method])=>method==='POST')).toHaveLength(0);
  const executeResponse=await handler({httpMethod:'POST',body:JSON.stringify({action:'execute',approved:true,previewHash:preview.previewHash})});
  expect(executeResponse.statusCode).toBe(200);expect(JSON.parse(executeResponse.body)).toEqual(expect.objectContaining({status:'complete',qboBillId:'80',qboPurchaseOrderId:'70'}));expect(qbRequest.mock.calls.filter(([method])=>method==='POST')).toHaveLength(1);
  expect(sourceRow).toEqual(expect.objectContaining({qb_status:'success',qb_bill_id:'80'}));expect([...admin.state.values()].some(value=>String(value.value).includes('qbPOBillMap'))).toBe(true);
});
