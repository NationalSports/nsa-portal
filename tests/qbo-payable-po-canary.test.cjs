const test=require('node:test');
const assert=require('node:assert/strict');
const {attemptKey,buildPlan,linkKey,listCandidates,verifyPrerequisites,verifyReadback}=require('../netlify/functions/_qboPayablePOCanary');

const candidate={poId:'PO 60000 TEST',vendor:'S&S Activewear',date:'2026-09-18',total:25,qboVendorId:'2382',vendorMatchSource:'durable_link',action:'ready_create',sourceLineIds:['10']};
const report={reviewerVersion:2,replay:{identical:true,runs:2},safeguards:{qboWrites:0,portalWrites:0,historicalPayablesProposed:0,historicalPurchaseOrdersProposed:0},purchaseOrders:{awaiting:[candidate]},accounts:{purchases_account:{id:'p',number:'51300'}},sourceHash:'source'};
const run={id:'run',snapshot_id:'snap',report};
const group={poId:'PO 60000 TEST',vendor:'S&S Activewear',date:'2026-09-18',total:25,accountKey:'purchases_account',historical:false,lines:[{sourceLineId:'10',sourceOrderId:'SO-1'}]};

test('selects only deterministic create candidates with durable vendors',()=>{
  assert.equal(listCandidates(report)[0].poId,candidate.poId);
  assert.throws(()=>listCandidates({...report,purchaseOrders:{awaiting:[{...candidate,vendorMatchSource:'unique_normalized_name'}]}}),/no_po_canary_candidate/);
});
test('builds one account line and no item or inventory payload',()=>{
  const plan=buildPlan({run,candidate,group,realm:'934',purchaseAccount:report.accounts.purchases_account});
  assert.equal(plan.payload.Line.length,1);assert.equal(plan.payload.Line[0].DetailType,'AccountBasedExpenseLineDetail');assert.equal(plan.payload.Line[0].AccountBasedExpenseLineDetail.AccountRef.value,'p');
  assert.equal(plan.summary.itemsCreated,0);assert.equal(plan.summary.inventoryQuantityPosted,false);assert.equal(plan.previewHash.length,64);
});
test('blocks source drift, duplicate numbers, and changed vendor or account',()=>{
  assert.throws(()=>buildPlan({run,candidate,group:{...group,total:26},realm:'934',purchaseAccount:report.accounts.purchases_account}),/po_candidate_changed/);
  const plan=buildPlan({run,candidate,group,realm:'934',purchaseAccount:report.accounts.purchases_account}),vendor={Id:'2382',Active:true},account={Id:'p',AcctNum:'51300',AccountType:'Cost of Goods Sold',Active:true};
  assert.equal(verifyPrerequisites({plan,vendor,account}),true);assert.throws(()=>verifyPrerequisites({plan,vendor,account,purchaseOrders:[{Id:'1'}]}),/duplicate_po/);assert.throws(()=>verifyPrerequisites({plan,vendor:{...vendor,Id:'x'},account}),/vendor_changed/);
});
test('read-back requires one exact PO and the reviewed account line',()=>{
  const plan=buildPlan({run,candidate,group,realm:'934',purchaseAccount:report.accounts.purchases_account}),po={Id:'99',DocNumber:candidate.poId,VendorRef:{value:'2382'},TxnDate:candidate.date,TotalAmt:25,Line:plan.payload.Line};
  assert.deepEqual(verifyReadback(plan,po,[po]),{id:'99',docNumber:candidate.poId,vendorId:'2382',date:candidate.date,total:25,balance:0,lines:['A|p|25.00']});
  assert.throws(()=>verifyReadback(plan,{...po,TotalAmt:24},[po]),/po_readback_mismatch/);assert.throws(()=>verifyReadback(plan,po,[po,{...po,Id:'100'}]),/po_readback_mismatch/);
});
test('keys are stable and scoped',()=>{assert.equal(attemptKey('934'),'_qb_payable_po_canary_attempt_934');assert.equal(decodeURIComponent(linkKey('934','PO 1')),'_qb_link_v1_["934","qbPOMap","PO 1"]')});
