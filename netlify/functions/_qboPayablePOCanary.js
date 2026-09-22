const {hash}=require('./_qboPayableSnapshot');

const clean=value=>String(value==null?'':value).trim();
const money=value=>Math.round((Number(value)||0)*100)/100;
const safeKey=value=>clean(value).replace(/[^A-Za-z0-9_-]/g,'_');
const attemptKey=realm=>`_qb_payable_po_canary_attempt_${safeKey(realm)}`;
const linkKey=(realm,poId)=>'_qb_link_v1_'+encodeURIComponent(JSON.stringify([clean(realm),'qbPOMap',clean(poId)]));

function listCandidates(report){
  if(!report||report.reviewerVersion!==2||report.replay?.identical!==true||report.replay?.runs!==2)throw new Error('verified_review_required');
  const guards=report.safeguards||{};
  if(guards.qboWrites!==0||guards.portalWrites!==0||guards.historicalPayablesProposed!==0||guards.historicalPurchaseOrdersProposed!==0)throw new Error('verified_review_required');
  const rows=(report.purchaseOrders?.awaiting||[]).filter(row=>row.action==='ready_create'&&clean(row.poId)&&clean(row.qboVendorId)&&row.vendorMatchSource==='durable_link'&&money(row.total)>0);
  rows.sort((a,b)=>money(a.total)-money(b.total)||clean(a.poId).localeCompare(clean(b.poId)));
  if(!rows.length)throw new Error('no_po_canary_candidate');
  return rows;
}

function buildPlan({run,candidate,group,realm,purchaseAccount}){
  const sourceIds=(group?.lines||[]).map(line=>clean(line.sourceLineId)).filter(Boolean).sort();
  const reviewedIds=(candidate?.sourceLineIds||[]).map(clean).filter(Boolean).sort();
  if(!group||clean(group.poId)!==clean(candidate.poId)||group.historical||group.invalidReason||group.accountKey!=='purchases_account')throw new Error('po_candidate_changed');
  if(clean(group.vendor)!==clean(candidate.vendor)||clean(group.date)!==clean(candidate.date)||money(group.total)!==money(candidate.total)||JSON.stringify(sourceIds)!==JSON.stringify(reviewedIds))throw new Error('po_candidate_changed');
  if(!purchaseAccount?.id||purchaseAccount.number!=='51300')throw new Error('approved_accounts_required');
  const soIds=[...new Set((group.lines||[]).map(line=>clean(line.sourceOrderId)).filter(Boolean))].sort();
  const description=`Portal merchandise (${group.lines.length} source line${group.lines.length===1?'':'s'}) — ${clean(group.poId)}${soIds.length?' — SO '+soIds.join(', '):''}`;
  const payload={DocNumber:clean(group.poId),VendorRef:{value:clean(candidate.qboVendorId)},TxnDate:clean(group.date),PrivateNote:`NSA-QB-PO-CANARY:${clean(group.poId)} | Portal source lines: ${sourceIds.join(',')}`,Line:[{Amount:money(group.total),DetailType:'AccountBasedExpenseLineDetail',Description:description,AccountBasedExpenseLineDetail:{AccountRef:{value:clean(purchaseAccount.id)},BillableStatus:'NotBillable',TaxCodeRef:{value:'NON'}}}]};
  const summary={realm:clean(realm),reviewRunId:clean(run.id),snapshotId:clean(run.snapshot_id),sourceHash:clean(run.report?.sourceHash),poId:clean(group.poId),sourceLineIds:sourceIds,vendor:clean(group.vendor),qboVendorId:clean(candidate.qboVendorId),date:clean(group.date),total:money(group.total),purchaseAccount:{id:clean(purchaseAccount.id),number:'51300'},posting:'one account-based purchase-order line',itemsCreated:0,inventoryQuantityPosted:false};
  return{summary,payload,previewHash:hash({summary,payload})};
}

function selectSource({run,groups,realm}){
  const byId=new Map((groups||[]).map(group=>[clean(group.poId),group]));
  for(const candidate of listCandidates(run?.report)){
    const group=byId.get(clean(candidate.poId));
    if(!group)continue;
    try{return{candidate,group,plan:buildPlan({run,candidate,group,realm,purchaseAccount:run.report?.accounts?.purchases_account})}}
    catch(error){if(error?.message!=='po_candidate_changed')throw error}
  }
  throw new Error('no_po_canary_candidate');
}

function verifyPrerequisites({plan,vendor,account,purchaseOrders=[]}){
  if(!vendor||vendor.Active===false||clean(vendor.Id)!==plan.summary.qboVendorId)throw new Error('vendor_changed');
  if(!account||account.Active===false||clean(account.Id)!==plan.summary.purchaseAccount.id||clean(account.AcctNum)!=='51300'||clean(account.AccountType)!=='Cost of Goods Sold')throw new Error('accounts_changed');
  if(purchaseOrders.length)throw new Error('duplicate_po');
  return true;
}

function verifyReadback(plan,po,numbered=[]){
  const lines=(po?.Line||[]).filter(line=>line.DetailType!=='SubTotalLineDetail');
  const line=lines[0];
  const valid=clean(po?.Id)&&clean(po.DocNumber)===plan.summary.poId&&clean(po.VendorRef?.value)===plan.summary.qboVendorId&&clean(po.TxnDate).slice(0,10)===plan.summary.date&&Math.abs(money(po.TotalAmt)-plan.summary.total)<.005&&lines.length===1&&line?.DetailType==='AccountBasedExpenseLineDetail'&&clean(line.AccountBasedExpenseLineDetail?.AccountRef?.value)===plan.summary.purchaseAccount.id&&Math.abs(money(line.Amount)-plan.summary.total)<.005;
  if(!valid||numbered.length!==1||clean(numbered[0]?.Id)!==clean(po?.Id))throw new Error('po_readback_mismatch');
  return{id:clean(po.Id),docNumber:clean(po.DocNumber),vendorId:clean(po.VendorRef?.value),date:clean(po.TxnDate).slice(0,10),total:money(po.TotalAmt),balance:money(po.Balance),lines:[`A|${clean(line.AccountBasedExpenseLineDetail?.AccountRef?.value)}|${money(line.Amount).toFixed(2)}`]};
}

module.exports={attemptKey,buildPlan,linkKey,listCandidates,selectSource,verifyPrerequisites,verifyReadback};
