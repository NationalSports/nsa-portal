jest.mock('../../netlify/functions/_shared',()=>({verifyQBOUser:jest.fn(),getSupabaseAdmin:jest.fn()}));
jest.mock('../../netlify/functions/_qb',()=>({getValidAccessToken:jest.fn(),qbRequest:jest.fn()}));
jest.mock('../../netlify/functions/_qboReviewConfig',()=>({reviewEnabled:()=>true}));

const {verifyQBOUser,getSupabaseAdmin}=require('../../netlify/functions/_shared');
const {getValidAccessToken,qbRequest}=require('../../netlify/functions/_qb');
const {handler}=require('../../netlify/functions/qbo-payable-canary');

const candidate={ledgerId:'3910',documentNumber:'102609587',vendor:'S&S Activewear',date:'2026-09-09',total:50,transactionType:'Bill',action:'ready',qboVendorId:'2382'};
const report={reviewerVersion:2,replay:{identical:true,runs:2},safeguards:{qboWrites:0,portalWrites:0,historicalPayablesProposed:0,historicalPurchaseOrdersProposed:0},results:[candidate],accounts:{purchases_account:{id:'1150040071',number:'51300'},ap_account:{id:'146',number:'21100'}},sourceHash:'source'};
const run={id:'run',snapshot_id:'snap',status:'complete',report,finished_at:'2026-09-18T12:00:00Z'};
const sourceRow={id:3910,status:'pushed',portal_status:'success',qb_status:null,qb_bill_id:null,doc_number:'102609587',vendor:'S&S Activewear',doc_total:50,is_credit:false,raw_meta:{doc_date:'09/09/2026',freight:0,si_upcharge:0,po_origin:'portal',po_number:'PO 57840 MISSW',items:[{sku:'AT106'}],matchedPO:{po:{_payment_method:''}}}};

function fakeAdmin(){
  const state=new Map();
  const makeQuery=table=>{
    const query={table,op:'select',filters:{},values:null,
      select(){if(this.op==='update')return Promise.resolve(this.finishUpdate());this.op='select';return this},
      update(values){this.op='update';this.values=values;return this},
      eq(field,value){this.filters[field]=value;return this},in(){return table==='applied_bills'?Promise.resolve({data:[{...sourceRow}],error:null}):this},not(){return this},order(){return this},is(){return this},
      limit(){return Promise.resolve({data:table==='qbo_payable_review_runs'?[run]:[],error:null})},
      maybeSingle(){
        if(table==='applied_bills')return Promise.resolve({data:{...sourceRow},error:null});
        if(table==='app_state')return Promise.resolve({data:state.has(this.filters.id)?{value:state.get(this.filters.id).value}:null,error:null});
        return Promise.resolve({data:null,error:null});
      },
      finishUpdate(){
        if(table==='app_state'&&state.has(this.filters.id)){state.set(this.filters.id,{...state.get(this.filters.id),...this.values});return{data:[{id:this.filters.id}],error:null}}
        if(table==='applied_bills'){Object.assign(sourceRow,this.values);return{data:[{id:sourceRow.id}],error:null}}
        return{data:[],error:null};
      },
    };
    return query;
  };
  return{state,from:jest.fn(table=>({
    ...makeQuery(table),
    insert:async value=>{if(state.has(value.id))return{error:{code:'23505'}};state.set(value.id,value);return{error:null}},
    upsert:async value=>{state.set(value.id,value);return{error:null}},
  }))};
}

const vendor={Id:'2382',Active:true};
const accounts=[{Id:'1150040071',AcctNum:'51300',AccountType:'Cost of Goods Sold',Active:true},{Id:'146',AcctNum:'21100',AccountType:'Accounts Payable',Active:true}];
const bill={Id:'999',DocNumber:'102609587',VendorRef:{value:'2382'},APAccountRef:{value:'146'},TxnDate:'2026-09-09',TotalAmt:50,Line:[{Amount:50,DetailType:'AccountBasedExpenseLineDetail',AccountBasedExpenseLineDetail:{AccountRef:{value:'1150040071'}}}]};

function mockQbo(){
  let created=false;
  qbRequest.mockImplementation(async(method,url,_token,payload)=>{
    if(method==='POST'){created=true;expect(payload.DocNumber).toBe('102609587');return{status:200,data:{Bill:bill}}}
    const sql=decodeURIComponent(url.split('query=')[1]||'');
    if(sql.includes('FROM Vendor WHERE'))return{status:200,data:{QueryResponse:{Vendor:[vendor]}}};
    if(sql.includes('FROM Account'))return{status:200,data:{QueryResponse:{Account:accounts}}};
    if(sql.includes("FROM Bill WHERE Id"))return{status:200,data:{QueryResponse:{Bill:created?[bill]:[]}}};
    if(sql.includes('FROM Bill WHERE DocNumber'))return{status:200,data:{QueryResponse:{Bill:created?[bill]:[]}}};
    if(sql.includes('FROM VendorCredit'))return{status:200,data:{QueryResponse:{VendorCredit:[]}}};
    throw new Error('unexpected query: '+sql);
  });
}

beforeEach(()=>{
  jest.clearAllMocks();
  process.env.QBO_REVIEW_REALM_ID='9341456492604246';
  sourceRow.qb_status=null;sourceRow.qb_bill_id=null;
  verifyQBOUser.mockResolvedValue({ok:true,userId:'accounting-user'});
  getValidAccessToken.mockResolvedValue({realm_id:'9341456492604246',access_token:'private-token'});
  mockQbo();
});

test('preview performs live checks without any QBO or receipt write',async()=>{
  const admin=fakeAdmin();getSupabaseAdmin.mockReturnValue(admin);
  const response=await handler({httpMethod:'POST',body:JSON.stringify({action:'preview'})});
  const body=JSON.parse(response.body);
  expect(response.statusCode).toBe(200);expect(body.writes).toBe(0);expect(body.candidate.ledgerId).toBe('3910');expect(body.previewHash).toHaveLength(64);
  expect(qbRequest.mock.calls.filter(([method])=>method==='POST')).toHaveLength(0);expect(admin.state.size).toBe(0);
});

test('approved execution creates exactly one bill, verifies it, and saves both receipts',async()=>{
  const admin=fakeAdmin();getSupabaseAdmin.mockReturnValue(admin);
  const preview=JSON.parse((await handler({httpMethod:'POST',body:JSON.stringify({action:'preview'})})).body);
  const response=await handler({httpMethod:'POST',body:JSON.stringify({action:'execute',approved:true,previewHash:preview.previewHash})});
  expect(response.statusCode).toBe(200);expect(JSON.parse(response.body)).toEqual(expect.objectContaining({status:'complete',qboBillId:'999'}));
  expect(qbRequest.mock.calls.filter(([method])=>method==='POST')).toHaveLength(1);
  expect(sourceRow).toEqual(expect.objectContaining({qb_status:'success',qb_bill_id:'999'}));
  expect([...admin.state.keys()]).toEqual(expect.arrayContaining(['_qb_payable_canary_attempt_9341456492604246_3910','_qb_canary_bill_9341456492604246_999']));
  expect(JSON.parse(admin.state.get('_qb_payable_canary_attempt_9341456492604246_3910').value).status).toBe('complete');
});
