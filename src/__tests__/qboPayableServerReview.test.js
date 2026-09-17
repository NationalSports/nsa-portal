const {analyzePayables,runPayableReview}=require('../../netlify/functions/_qboPayableServerReview');

const ledger={id:'L1',status:'pushed',portal_status:'success',doc_number:'B-1',vendor:'Acme LLC',doc_total:100,is_credit:false,raw_meta:{doc_date:'2026-09-01',freight:10,si_upcharge:5}};
const portal={id:'V1',name:'Acme LLC',is_active:true};
const qboVendor={Id:'9',DisplayName:'Acme',Active:true};
const accounts={purchases_account:'1',freight_account:'2',sports_inc_fee_account:'3',deco_account:'4'};
const base={ledgerRows:[ledger],portalVendors:[portal],vendorLinks:{V1:'9'},qboVendors:[qboVendor],qboBills:[],qboVendorCredits:[],accountIds:accounts};

test('classifies a fully routed unmatched bill as ready without writes',()=>{
  expect(analyzePayables(base).rows[0]).toMatchObject({action:'ready',qboVendorId:'9',transactionType:'Bill'});
});
test('recognizes exact existing bill and holds changed collisions',()=>{
  const exact={Id:'80',DocNumber:'B-1',VendorRef:{value:'9'},TotalAmt:100,TxnDate:'2026-09-01'};
  expect(analyzePayables({...base,qboBills:[exact]}).rows[0]).toMatchObject({action:'already_exists',qboBillId:'80'});
  expect(analyzePayables({...base,qboBills:[{...exact,TotalAmt:101}]}).rows[0].action).toBe('conflict');
});
test('uses the correct QBO VendorCredit entity and never proposes credit creation',()=>{
  const credit={...ledger,id:'C1',is_credit:true,doc_total:-20,doc_number:'VC-1'};
  expect(analyzePayables({...base,ledgerRows:[credit]}).rows[0]).toMatchObject({action:'blocked',transactionType:'VendorCredit'});
  const found={Id:'81',DocNumber:'VC-1',VendorRef:{value:'9'},TotalAmt:20,TxnDate:'2026-09-01'};
  expect(analyzePayables({...base,ledgerRows:[credit],qboVendorCredits:[found]}).rows[0].action).toBe('already_exists');
});
test('durable runner persists source hash and needs-review exceptions',async()=>{
  const snapshot={ledger:[ledger],portalVendors:[portal],vendorLinks:{V1:'9'}};
  const store={claim:jest.fn(async()=>true),snapshot:jest.fn(async()=>snapshot),finish:jest.fn(async()=>{})};
  const queryAll=jest.fn(async entity=>entity==='Vendor'?[qboVendor]:entity==='Account'?Object.entries({purchases_account:'51300',freight_account:'51000',sports_inc_fee_account:'58000',deco_account:'52000'}).map(([key,AcctNum],i)=>({Id:String(i+1),AcctNum,Active:true})):[]);
  const result=await runPayableReview({store,queryAll,realm:'123',requestedBy:'staff'});
  expect(result.status).toBe('complete');expect(result.report).toMatchObject({mode:'read_only',population:1,sourceChanged:false,counts:{ready:1}});
  expect(store.finish).toHaveBeenCalledTimes(1);
});
test('overlapping run performs no source or QBO reads',async()=>{
  const store={claim:jest.fn(async()=>false),snapshot:jest.fn()};const queryAll=jest.fn();
  expect(await runPayableReview({store,queryAll,realm:'123',requestedBy:'staff'})).toEqual({status:'busy'});
  expect(store.snapshot).not.toHaveBeenCalled();expect(queryAll).not.toHaveBeenCalled();
});
