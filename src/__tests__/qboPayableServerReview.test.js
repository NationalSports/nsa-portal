const {analyzeBillPayments,analyzeNativePOLinks,analyzePayables,analyzePurchaseOrders,failureCode,PAYABLE_CUTOVER_DATE,runPayableReview}=require('../../netlify/functions/_qboPayableServerReview');
const {SNAPSHOT_LIMITS}=require('../../netlify/functions/_qboPayableReviewStore');

const ledger={id:'L1',status:'pushed',portal_status:'success',doc_number:'B-1',vendor:'Acme LLC',doc_total:100,is_credit:false,raw_meta:{doc_date:'2026-09-10',freight:10,si_upcharge:5,po_origin:'portal'}};
const portal={id:'V1',name:'Acme LLC',is_active:true};
const qboVendor={Id:'9',DisplayName:'Acme',Active:true};
const accounts={purchases_account:'1',freight_account:'2',sports_inc_fee_account:'3',deco_account:'4'};
const base={ledgerRows:[ledger],portalVendors:[portal],vendorLinks:{V1:'9'},qboVendors:[qboVendor],qboBills:[],qboVendorCredits:[],accountIds:accounts};

test('product snapshot ceiling covers the current catalog without removing the safety cap',()=>{
  expect(SNAPSHOT_LIMITS.products).toBe(100000);
  expect(SNAPSHOT_LIMITS.portalRows).toBe(50000);
});
test('failure diagnostics expose only fixed internal stage and error labels',()=>{
  expect(failureCode('qbo_primary_reads',new Error('qbo_read_failed'))).toBe('payable_review_qbo_primary_reads_qbo_read_failed');
  expect(failureCode('analysis',new Error('vendor secret 123'))).toBe('payable_review_analysis_unexpected');
});

test('classifies a fully routed unmatched bill as ready without writes',()=>{
  expect(analyzePayables(base).rows[0]).toMatchObject({action:'ready',qboVendorId:'9',transactionType:'Bill'});
});
test('parses four-digit years in slash-formatted payable dates without truncating the year',()=>{
  const fourDigitYear={...ledger,id:'L2',raw_meta:{...ledger.raw_meta,doc_date:'09/15/2026'}};
  expect(analyzePayables({...base,ledgerRows:[fourDigitYear]}).rows[0]).toMatchObject({date:'2026-09-15',action:'ready'});
});
test('blocks paid and source-unverified bills from becoming open QBO payables',()=>{
  const prepaid={...ledger,id:'P1',raw_meta:{...ledger.raw_meta,matchedPO:{po:{_payment_method:'credit_card'}}}};
  expect(analyzePayables({...base,ledgerRows:[prepaid]}).rows[0]).toMatchObject({action:'blocked',code:'prepaid_purchase',paymentMethod:'credit_card'});
  const unverified={...ledger,id:'U1',raw_meta:{...ledger.raw_meta,po_origin:'unknown'}};
  expect(analyzePayables({...base,ledgerRows:[unverified]}).rows[0]).toMatchObject({action:'blocked',code:'payment_status_unverified',poOrigin:'unknown'});
});
test('duplicate review still recognizes a paid purchase that already exists in QBO',()=>{
  const prepaid={...ledger,id:'P2',raw_meta:{...ledger.raw_meta,matchedPO:{po:{_payment_method:'credit_card'}}}};
  const exact={Id:'80',DocNumber:'B-1',VendorRef:{value:'9'},TotalAmt:100,TxnDate:'2026-09-10'};
  expect(analyzePayables({...base,ledgerRows:[prepaid],qboBills:[exact]}).rows[0]).toMatchObject({action:'already_exists',qboBillId:'80'});
});
test('excludes unmatched pre-cutover payables without proposing a historical write',()=>{
  const old={...ledger,id:'OLD1',raw_meta:{...ledger.raw_meta,doc_date:'2026-09-08'}};
  expect(PAYABLE_CUTOVER_DATE).toBe('2026-09-09');
  expect(analyzePayables({...base,ledgerRows:[old]}).rows[0]).toMatchObject({action:'excluded_historical',code:'historical_cutover'});
});
test('recognizes exact existing bill and holds changed collisions',()=>{
  const exact={Id:'80',DocNumber:'B-1',VendorRef:{value:'9'},TotalAmt:100,TxnDate:'2026-09-10'};
  expect(analyzePayables({...base,qboBills:[exact]}).rows[0]).toMatchObject({action:'already_exists',qboBillId:'80'});
  expect(analyzePayables({...base,qboBills:[{...exact,TotalAmt:101}]}).rows[0].action).toBe('conflict');
});
test('uses the correct QBO VendorCredit entity and never proposes credit creation',()=>{
  const credit={...ledger,id:'C1',is_credit:true,doc_total:-20,doc_number:'VC-1'};
  expect(analyzePayables({...base,ledgerRows:[credit]}).rows[0]).toMatchObject({action:'blocked',transactionType:'VendorCredit'});
  const found={Id:'81',DocNumber:'VC-1',VendorRef:{value:'9'},TotalAmt:20,TxnDate:'2026-09-10'};
  expect(analyzePayables({...base,ledgerRows:[credit],qboVendorCredits:[found]}).rows[0].action).toBe('already_exists');
});
test('durable runner persists source hash and needs-review exceptions',async()=>{
  const snapshot={ledger:[ledger],portalVendors:[portal],links:{vendorQBMap:{V1:'9'},prodQBMap:{},qbPOMap:{},qbPOBillMap:{}},salesOrders:[],soItems:[],poLines:[],products:[],qbConfig:{}};
  const store={claim:jest.fn(async()=>true),snapshot:jest.fn(async()=>snapshot),finish:jest.fn(async()=>{})};
  const accountNumbers=[['40000','Income'],['51300','Cost of Goods Sold'],['51000','Cost of Goods Sold'],['67000','Expense'],['58000','Cost of Goods Sold'],['52000','Cost of Goods Sold'],['55200','Cost of Goods Sold'],['55400','Cost of Goods Sold'],['12000','Other Current Asset'],['50000','Cost of Goods Sold'],['21100','Accounts Payable'],['10100','Bank']];
  const queryAll=jest.fn(async entity=>entity==='Vendor'?[qboVendor]:entity==='Account'?accountNumbers.map(([AcctNum,AccountType],i)=>({Id:String(i+1),AcctNum,AccountType,Active:true})):[]);
  const result=await runPayableReview({store,queryAll,realm:'123',requestedBy:'staff'});
  expect(result.status).toBe('complete');expect(result.report).toMatchObject({mode:'read_only',population:1,sourceChanged:false,counts:{billsAndCreditsAwaitingAction:1,missingAccountMappings:0},billCounts:{ready:1},safeguards:{qboWrites:0,inventoryQuantitiesPosted:false}});
  expect(queryAll.mock.calls.filter(([entity])=>entity==='Bill'||entity==='VendorCredit').every(([,fields])=>fields==='*')).toBe(true);
  expect(store.finish).toHaveBeenCalledTimes(1);
});
test('durable runner reports a configured account that resolves away from the approved number',async()=>{
  const snapshot={ledger:[],portalVendors:[],links:{vendorQBMap:{},prodQBMap:{},qbPOMap:{},qbPOBillMap:{}},salesOrders:[],soItems:[],poLines:[],products:[],qbConfig:{mapping:{purchases_account:'99999'}}};
  const store={claim:jest.fn(async()=>true),snapshot:jest.fn(async()=>snapshot),finish:jest.fn(async()=>{})};
  const accountNumbers=[['40000','Income'],['51300','Cost of Goods Sold'],['51000','Cost of Goods Sold'],['67000','Expense'],['58000','Cost of Goods Sold'],['52000','Cost of Goods Sold'],['55200','Cost of Goods Sold'],['55400','Cost of Goods Sold'],['12000','Other Current Asset'],['50000','Cost of Goods Sold'],['21100','Accounts Payable'],['10100','Bank'],['99999','Cost of Goods Sold']];
  const queryAll=jest.fn(async entity=>entity==='Account'?accountNumbers.map(([AcctNum,AccountType],i)=>({Id:String(i+1),AcctNum,AccountType,Active:true})):[]);
  const result=await runPayableReview({store,queryAll,realm:'123',requestedBy:'staff'});
  expect(result.status).toBe('needs_review');expect(result.report.missingAccounts).toContainEqual(expect.objectContaining({key:'purchases_account',configured:'99999',reason:'Configured mapping resolves to a different account'}));
});
test('purchase-order review reports backlog, historical exclusions, durable links and unlinked SKUs',()=>{
  const snapshot={portalVendors:[portal],salesOrders:[{id:'SO-1',created_at:'2026-09-10'}],soItems:[{id:1,so_id:'SO-1',product_id:'P1',sku:'SKU-1',name:'Shirt',nsa_cost:10}],poLines:[
    {id:11,so_item_id:1,po_id:'PO 60001 TEST',vendor:'Acme LLC',created_at:'2026-09-10',sizes:{M:2,unit_cost:10}},
    {id:12,so_item_id:1,po_id:'PO5999 OLD',vendor:'Acme LLC',created_at:'2026-08-01',sizes:{M:1,unit_cost:10}},
  ],links:{vendorQBMap:{V1:'9'},prodQBMap:{},qbPOMap:{},qbPOBillMap:{}},qbConfig:{parkedPurchaseOrderIds:[]}};
  const result=analyzePurchaseOrders({snapshot,qboVendors:[qboVendor],qboPurchaseOrders:[],qboItems:[],accountIds:accounts});
  expect(result.awaiting).toHaveLength(1);expect(result.awaiting[0]).toMatchObject({poId:'PO 60001 TEST',total:20,action:'ready_create'});
  expect(result.excluded).toHaveLength(1);expect(result.unlinkedItems).toEqual([{sourceId:'P1',sku:'SKU-1',poIds:['PO 60001 TEST'],disposition:'reviewed_item_creation',qboCandidates:[]}]);
});
test('purchase-order review resolves stored vendor ids and classifies exact NonInventory item candidates',()=>{
  const snapshot={portalVendors:[portal],products:[{id:'P1',sku:'SKU-1'}],salesOrders:[{id:'SO-1',created_at:'2026-09-10'}],soItems:[{id:1,so_id:'SO-1',sku:'SKU-1',name:'Shirt',nsa_cost:10}],poLines:[
    {id:11,so_item_id:1,po_id:'PO 60002 TEST',vendor:'V1',created_at:'2026-09-10',sizes:{M:2,unit_cost:10}},
  ],links:{vendorQBMap:{V1:'9'},prodQBMap:{},qbPOMap:{},qbPOBillMap:{}},qbConfig:{parkedPurchaseOrderIds:[]}};
  const result=analyzePurchaseOrders({snapshot,qboVendors:[qboVendor],qboPurchaseOrders:[],qboItems:[{Id:'I1',Name:'SKU-1',Sku:'SKU-1',Type:'NonInventory',Active:true,IncomeAccountRef:{value:'5'},ExpenseAccountRef:{value:'1'}}],accountIds:{...accounts,income_account:'5'}});
  expect(result.awaiting[0]).toMatchObject({vendor:'Acme LLC',qboVendorId:'9',vendorMatchSource:'durable_link'});
  expect(result.unlinkedItems).toEqual([{sourceId:'P1',sku:'SKU-1',poIds:['PO 60002 TEST'],disposition:'link_verified_existing',qboCandidates:[expect.objectContaining({id:'I1',type:'NonInventory'})]}]);
});
test('purchase-order review flags mapped items that are inactive or use the wrong accounts',()=>{
  const snapshot={portalVendors:[portal],salesOrders:[{id:'SO-1'}],soItems:[{id:1,so_id:'SO-1',product_id:'P1',sku:'SKU-1',nsa_cost:10}],poLines:[{id:11,so_item_id:1,po_id:'PO 60003 TEST',vendor:'Acme LLC',created_at:'2026-09-10',sizes:{M:1}}],links:{vendorQBMap:{V1:'9'},prodQBMap:{P1:'I1'},qbPOMap:{},qbPOBillMap:{}},qbConfig:{parkedPurchaseOrderIds:[]}};
  const result=analyzePurchaseOrders({snapshot,qboVendors:[qboVendor],qboPurchaseOrders:[],qboItems:[{Id:'I1',Type:'Inventory',Active:false,IncomeAccountRef:{value:'bad'},ExpenseAccountRef:{value:'bad'}}],accountIds:{...accounts,income_account:'5'}});
  expect(result.invalidItemLinks).toEqual([{sourceId:'P1',qboId:'I1',reason:expect.stringContaining('inactive QBO item')}]);
});
test('payment review detects missing applications and historical print queue',()=>{
  const payments=[{Id:'P1',TxnDate:'2026-08-01',TotalAmt:55,CheckPayment:{PrintStatus:'NeedToPrint'},Line:[{LinkedTxn:[{TxnId:'B404',TxnType:'Bill'}]}]}];
  const result=analyzeBillPayments(payments,[],[]);
  expect(result.missingApplications).toHaveLength(1);expect(result.historicalPrintQueue).toHaveLength(1);expect(result.historicalPrintTotal).toBe(55);
});
test('native PO-to-bill review requires same vendor, reciprocal links, freight reconciliation and durable ids',()=>{
  const snapshot={links:{qbPOMap:{'PO 1':'10'},qbPOBillMap:{'PO 1':'20'}}};
  const po={Id:'10',DocNumber:'PO 1',VendorRef:{value:'9'},TotalAmt:100,LinkedTxn:[{TxnId:'20',TxnType:'Bill'}]};
  const bill={Id:'20',DocNumber:'B1',VendorRef:{value:'9'},TotalAmt:110,Line:[{Amount:100,LinkedTxn:[{TxnId:'10',TxnType:'PurchaseOrder'}]},{Amount:10,AccountBasedExpenseLineDetail:{AccountRef:{value:'2'}}}]};
  const result=analyzeNativePOLinks({snapshot,qboPurchaseOrders:[po],qboBills:[bill],accountIds:{freight_account:'2'}});
  expect(result.verified).toHaveLength(1);expect(result.verified[0]).toMatchObject({portalPOId:'PO 1',qboPOId:'10',billId:'20',freight:10,reconciles:true,reciprocalLink:true});
});
test('overlapping run performs no source or QBO reads',async()=>{
  const store={claim:jest.fn(async()=>false),snapshot:jest.fn()};const queryAll=jest.fn();
  expect(await runPayableReview({store,queryAll,realm:'123',requestedBy:'staff'})).toEqual({status:'busy'});
  expect(store.snapshot).not.toHaveBeenCalled();expect(queryAll).not.toHaveBeenCalled();
});
