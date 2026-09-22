const {buildPlan,buildSource,listCandidates,repairPlan,verifyPrerequisites,verifyReadback,verifyRepairSource}=require('../../netlify/functions/_qboPayablePOBillCanary');

const candidate={ledgerId:'4000',documentNumber:'INV-4000',vendor:'SanMar',date:'2026-09-10',total:25,transactionType:'Bill',action:'ready',qboVendorId:'10',vendorMatchSource:'durable_link'};
const report={reviewerVersion:2,replay:{identical:true,runs:2},safeguards:{qboWrites:0,portalWrites:0,historicalPayablesProposed:0,historicalPurchaseOrdersProposed:0},results:[candidate],accounts:{purchases_account:{id:'50',number:'51300'},ap_account:{id:'60',number:'21100'}},sourceHash:'source'};
const run={id:'run',snapshot_id:'snap',report};
const row={id:4000,status:'pushed',portal_status:'success',qb_status:null,qb_bill_id:null,doc_number:'INV-4000',vendor:'SanMar',doc_total:25,is_credit:false,raw_meta:{doc_date:'09/10/2026',freight:0,si_upcharge:0,po_origin:'portal',po_number:'PO 4000',matchedPO:{po:{_payment_method:''}}}};
const po={Id:'70',DocNumber:'PO 4000',VendorRef:{value:'10'},POStatus:'Open',TotalAmt:25,Line:[{Id:'1',Amount:25,DetailType:'AccountBasedExpenseLineDetail',AccountBasedExpenseLineDetail:{AccountRef:{value:'50'}}}]};

function plan(){return buildPlan(buildSource({run,row,candidate,realm:'9341456492604246',qboPurchaseOrderId:'70'}),po)}

test('selects only reviewed bills with durable vendor identity',()=>{
  expect(listCandidates(report)).toEqual([candidate]);
  expect(()=>listCandidates({...report,results:[{...candidate,vendorMatchSource:'unique_normalized_name'}]})).toThrow('no_po_bill_canary_candidate');
});

test('builds account-only bill lines linked to exact existing PO lines',()=>{
  const built=plan();
  expect(built.summary).toEqual(expect.objectContaining({ledgerId:'4000',poNumber:'PO 4000',qboPurchaseOrderId:'70',itemsCreated:0,inventoryQuantityPosted:false}));
  expect(built.payload.LinkedTxn).toEqual([{TxnId:'70',TxnType:'PurchaseOrder'}]);
  expect(built.payload.Line).toBeUndefined();
  expect(built.expectedLines).toEqual([{Amount:25,accountId:'50'}]);
  expect(built.previewHash).toHaveLength(64);
});

test('blocks paid sources, item lines, used POs, and duplicate documents',()=>{
  expect(()=>buildSource({run,row:{...row,raw_meta:{...row.raw_meta,matchedPO:{po:{_payment_method:'Credit Card'}}}},candidate,realm:'9341456492604246',qboPurchaseOrderId:'70'})).toThrow('po_bill_candidate_changed');
  const source=buildSource({run,row,candidate,realm:'9341456492604246',qboPurchaseOrderId:'70'});
  expect(()=>buildPlan(source,{...po,Line:[{...po.Line[0],DetailType:'ItemBasedExpenseLineDetail'}]})).toThrow('purchase_order_not_linkable');
  expect(()=>buildPlan(source,{...po,LinkedTxn:[{TxnId:'80',TxnType:'Bill'}]})).toThrow('purchase_order_not_linkable');
  expect(()=>verifyPrerequisites({source,vendor:{Id:'10',Active:true},accounts:[{Id:'50',AcctNum:'51300',AccountType:'Cost of Goods Sold',Active:true},{Id:'60',AcctNum:'21100',AccountType:'Accounts Payable',Active:true}],bills:[{Id:'80'}],credits:[]})).toThrow('duplicate_document');
});

test('requires exact bill identity, open balance, account lines and reciprocal PO link',()=>{
  const built=plan();
  const line={Amount:25,DetailType:'AccountBasedExpenseLineDetail',LinkedTxn:[{TxnId:'70',TxnType:'PurchaseOrder',TxnLineId:'1'}],AccountBasedExpenseLineDetail:{AccountRef:{value:'50'}}};
  const bill={Id:'80',DocNumber:'INV-4000',VendorRef:{value:'10'},APAccountRef:{value:'60'},TxnDate:'2026-09-10',TotalAmt:25,Balance:25,Line:[line]};
  const linkedPO={...po,POStatus:'Closed',LinkedTxn:[{TxnId:'80',TxnType:'Bill'}]};
  expect(verifyReadback(built,bill,linkedPO,[bill],[])).toEqual(expect.objectContaining({id:'80',purchaseOrderId:'70',reciprocalLink:true}));
  expect(()=>verifyReadback(built,{...bill,Balance:0},linkedPO,[bill],[])).toThrow('po_bill_readback_mismatch');
  expect(()=>verifyReadback(built,bill,po,[bill],[])).toThrow('po_bill_readback_mismatch');
});

test('links only merchandise to the PO and preserves reviewed freight and fees on approved accounts',()=>{
  const freightRun={...run,report:{...report,accounts:{...report.accounts,freight_account:{id:'55',number:'51000'},sports_inc_fee_account:{id:'56',number:'58000'}}}};
  const freightRow={...row,doc_total:32,raw_meta:{...row.raw_meta,freight:5,si_upcharge:2}};
  const freightCandidate={...candidate,total:32};
  const source=buildSource({run:freightRun,row:freightRow,candidate:freightCandidate,realm:'9341456492604246',qboPurchaseOrderId:'70'});
  const built=buildPlan(source,po);
  expect(built.summary).toEqual(expect.objectContaining({total:32,merchandise:25,freight:5,sportsFee:2,freightAccount:{id:'55',number:'51000'},sportsFeeAccount:{id:'56',number:'58000'}}));
  expect(built.payload.LinkedTxn).toEqual([{TxnId:'70',TxnType:'PurchaseOrder'}]);expect(built.payload.Line).toHaveLength(2);expect(built.payload.Line[0]).toEqual(expect.objectContaining({Amount:5,AccountBasedExpenseLineDetail:expect.objectContaining({AccountRef:{value:'55'}})}));expect(built.payload.Line[1]).toEqual(expect.objectContaining({Amount:2,AccountBasedExpenseLineDetail:expect.objectContaining({AccountRef:{value:'56'}})}));expect(built.expectedLines).toEqual([{Amount:25,accountId:'50'},{Amount:5,accountId:'55'},{Amount:2,accountId:'56'}]);
  const accounts=[{Id:'50',AcctNum:'51300',AccountType:'Cost of Goods Sold',Active:true},{Id:'55',AcctNum:'51000',AccountType:'Cost of Goods Sold',Active:true},{Id:'56',AcctNum:'58000',AccountType:'Cost of Goods Sold',Active:true},{Id:'60',AcctNum:'21100',AccountType:'Accounts Payable',Active:true}];
  expect(verifyPrerequisites({source,vendor:{Id:'10',Active:true},accounts})).toBe(true);
  const bill={Id:'81',DocNumber:'INV-4000',VendorRef:{value:'10'},APAccountRef:{value:'60'},TxnDate:'2026-09-10',TotalAmt:32,Balance:32,LinkedTxn:[{TxnId:'70',TxnType:'PurchaseOrder'}],Line:[{Amount:25,DetailType:'AccountBasedExpenseLineDetail',AccountBasedExpenseLineDetail:{AccountRef:{value:'50'}}},built.payload.Line[0],built.payload.Line[1]]};
  expect(verifyReadback(built,bill,{...po,POStatus:'Closed',LinkedTxn:[{TxnId:'81',TxnType:'Bill'}]},[bill],[])).toEqual(expect.objectContaining({id:'81',total:32,reciprocalLink:true}));
});


test('repairs the observed partial bill only when its exact unlinked fees and open PO remain unchanged',()=>{
  const freightRun={...run,report:{...report,accounts:{...report.accounts,freight_account:{id:'55',number:'51000'},sports_inc_fee_account:{id:'56',number:'58000'}}}};
  const freightRow={...row,doc_total:32,raw_meta:{...row.raw_meta,freight:5,si_upcharge:2}},freightCandidate={...candidate,total:32};
  const original=buildPlan(buildSource({run:freightRun,row:freightRow,candidate:freightCandidate,realm:'9341456492604246',qboPurchaseOrderId:'70'}),po);
  const legacy={...original,payload:{...original.payload,LinkedTxn:undefined,Line:[{Amount:25,DetailType:'AccountBasedExpenseLineDetail',LinkedTxn:[{TxnId:'70',TxnType:'PurchaseOrder',TxnLineId:'1'}],AccountBasedExpenseLineDetail:{AccountRef:{value:'50'}}},...original.payload.Line]},expectedLines:undefined};
  const repaired=repairPlan(legacy);
  expect(repaired.payload.LinkedTxn).toEqual([{TxnId:'70',TxnType:'PurchaseOrder'}]);expect(repaired.payload.Line).toHaveLength(2);
  const partial={Id:'80',SyncToken:'0',DocNumber:'INV-4000',VendorRef:{value:'10'},APAccountRef:{value:'60'},TxnDate:'2026-09-10',TotalAmt:7,Balance:7,Line:repaired.payload.Line};
  expect(verifyRepairSource(repaired,partial,po,[partial],[])).toBe(true);
  expect(()=>verifyRepairSource(repaired,{...partial,TotalAmt:32},po,[partial],[])).toThrow('repair_source_changed');
  expect(()=>verifyRepairSource(repaired,partial,{...po,POStatus:'Closed'},[partial],[])).toThrow('repair_source_changed');
});
