const {buildCanaryPlan,payableCanaryAttemptKey,selectCanaryCandidate,selectCanarySource,verifyCanaryReadback,verifyQboPrerequisites}=require('../netlify/functions/_qboPayableCanary');
const test=require('node:test');
const assert=require('node:assert/strict');

const candidate={ledgerId:'3910',documentNumber:'102609587',vendor:'S&S Activewear',date:'2026-09-09',total:50,transactionType:'Bill',action:'ready',qboVendorId:'2382'};
const report={reviewerVersion:2,replay:{identical:true,runs:2},safeguards:{qboWrites:0,portalWrites:0,historicalPayablesProposed:0,historicalPurchaseOrdersProposed:0},results:[{...candidate,total:75,ledgerId:'9'},{...candidate}],accounts:{purchases_account:{id:'p',number:'51300'},ap_account:{id:'a',number:'21100'}},sourceHash:'source'};
const run={id:'run',snapshot_id:'snap',report};
const row={id:3910,status:'pushed',portal_status:'success',qb_status:null,qb_bill_id:null,doc_number:'102609587',vendor:'S&S Activewear',doc_total:50,is_credit:false,raw_meta:{doc_date:'09/09/2026',freight:0,si_upcharge:0,po_origin:'portal',po_number:'PO 57840 MISSW',items:[{sku:'AT106'}],matchedPO:{po:{_payment_method:''}}}};

test('selects the smallest ready bill from a deterministic zero-write review',()=>assert.equal(selectCanaryCandidate(report).ledgerId,'3910'));
test('skips lower-value ready bills that fail the stricter canary source gates',()=>{
  const chargedCandidate={...candidate,ledgerId:'3987',documentNumber:'6166286847',vendor:'ADIDAS US TEAM SERVICES',qboVendorId:'2379',date:'2026-09-11',total:31.33};
  const chargedRow={...row,id:3987,doc_number:'6166286847',vendor:'ADIDAS US TEAM SERVICES',doc_total:31.33,raw_meta:{...row.raw_meta,doc_date:'09/11/2026',freight:8.58,si_upcharge:.25}};
  const chargedRun={...run,report:{...report,results:[chargedCandidate,candidate]}};
  const selected=selectCanarySource({run:chargedRun,rows:[chargedRow,row],realm:'934'});
  assert.equal(selected.candidate.ledgerId,'3910');assert.equal(selected.plan.summary.total,50);
});
test('builds one account-based bill with document number and no item or inventory payload',()=>{
  const plan=buildCanaryPlan({run,row,candidate,realm:'934'});
  assert.deepEqual({...plan.summary,purchaseAccount:undefined,apAccount:undefined},{realm:'934',reviewRunId:'run',snapshotId:'snap',sourceHash:'source',ledgerId:'3910',documentNumber:'102609587',vendor:'S&S Activewear',qboVendorId:'2382',date:'2026-09-09',total:50,poNumber:'PO 57840 MISSW',purchaseAccount:undefined,apAccount:undefined,posting:'one account-based merchandise line',itemsCreated:0,inventoryQuantityPosted:false});
  assert.equal(plan.payload.DocNumber,'102609587');assert.equal(plan.payload.TxnDate,'2026-09-09');assert.equal(plan.payload.VendorRef.value,'2382');assert.equal(plan.payload.APAccountRef.value,'a');assert.equal(plan.payload.Line.length,1);assert.equal(plan.payload.Line[0].Amount,50);assert.equal(plan.payload.Line[0].AccountBasedExpenseLineDetail.AccountRef.value,'p');
  assert.equal(plan.previewHash.length,64);
});
test('blocks changed, paid, or already-synced source rows',()=>{
  assert.throws(()=>buildCanaryPlan({run,row:{...row,doc_total:51},candidate,realm:'934'}),/candidate_changed/);
  assert.throws(()=>buildCanaryPlan({run,row:{...row,qb_status:'success',qb_bill_id:'1'},candidate,realm:'934'}),/candidate_already_synced/);
  assert.throws(()=>buildCanaryPlan({run,row:{...row,raw_meta:{...row.raw_meta,matchedPO:{po:{_payment_method:'credit_card'}}}},candidate,realm:'934'}),/candidate_changed/);
});
test('requires exact active vendor/accounts and a clean document number',()=>{
  const plan=buildCanaryPlan({run,row,candidate,realm:'934'}),vendor={Id:'2382',Active:true},accounts=[{Id:'p',AcctNum:'51300',AccountType:'Cost of Goods Sold',Active:true},{Id:'a',AcctNum:'21100',AccountType:'Accounts Payable',Active:true}];
  assert.equal(verifyQboPrerequisites({plan,vendor,accounts}),true);
  assert.throws(()=>verifyQboPrerequisites({plan,vendor,accounts,bills:[{Id:'existing'}]}),/duplicate_document/);
  assert.throws(()=>verifyQboPrerequisites({plan,vendor,accounts:accounts.map(a=>a.Id==='p'?{...a,AcctNum:'999'}:a)}),/accounts_changed/);
});
test('read-back requires the only matching document and identical identity, total, A/P and lines',()=>{
  const plan=buildCanaryPlan({run,row,candidate,realm:'934'}),bill={Id:'99',DocNumber:'102609587',VendorRef:{value:'2382'},APAccountRef:{value:'a'},TxnDate:'2026-09-09',TotalAmt:50,Balance:50,Line:plan.payload.Line};
  assert.deepEqual(verifyCanaryReadback(plan,bill,[bill],[]),{id:'99',docNumber:'102609587',vendorId:'2382',date:'2026-09-09',total:50,balance:50,apAccountId:'a',lines:['A|p|50.00'],poLinks:[]});
  assert.throws(()=>verifyCanaryReadback(plan,{...bill,TotalAmt:49},[bill],[]),/readback_mismatch/);
  assert.throws(()=>verifyCanaryReadback(plan,bill,[bill,{...bill,Id:'100'}],[]),/readback_mismatch/);
  assert.throws(()=>verifyCanaryReadback(plan,{...bill,Line:[...bill.Line,{Amount:1,DetailType:'ItemBasedExpenseLineDetail',ItemBasedExpenseLineDetail:{ItemRef:{value:'unsafe'}}}]},[bill],[]),/readback_mismatch/);
  assert.throws(()=>verifyCanaryReadback(plan,{...bill,Balance:0},[bill],[]),/readback_mismatch/);
  assert.throws(()=>verifyCanaryReadback(plan,{...bill,Line:[{...bill.Line[0],LinkedTxn:[{TxnId:'1',TxnType:'PurchaseOrder'}]}]},[bill],[]),/readback_mismatch/);
});
test('attempt key is stable and scoped by realm and ledger',()=>assert.equal(payableCanaryAttemptKey('934','3910'),'_qb_payable_canary_attempt_934_3910'));
