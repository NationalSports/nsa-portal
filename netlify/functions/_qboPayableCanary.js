const {hash}=require('./_qboPayableSnapshot');

const clean=value=>String(value==null?'':value).trim();
const money=value=>Math.round((Number(value)||0)*100)/100;
const dateValue=value=>{
  const raw=clean(value);let match=raw.match(/^(\d{4})-(\d{2})-(\d{2})/),y,m,d;
  if(match){[,y,m,d]=match}else{match=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/);if(!match)return null;[,m,d,y]=match;if(y.length===2)y='20'+y}
  const dt=new Date(Date.UTC(+y,+m-1,+d));
  return dt.getUTCFullYear()===+y&&dt.getUTCMonth()===+m-1&&dt.getUTCDate()===+d?`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
};
const payableCanaryAttemptKey=(realm,ledgerId)=>'_qb_payable_canary_attempt_'+clean(realm).replace(/[^A-Za-z0-9_-]/g,'_')+'_'+clean(ledgerId).replace(/[^A-Za-z0-9_-]/g,'_');
const payableCanaryReceiptKey=(realm,billId)=>'_qb_canary_bill_'+clean(realm).replace(/[^A-Za-z0-9_-]/g,'_')+'_'+clean(billId).replace(/[^A-Za-z0-9_-]/g,'_');

function selectCanaryCandidate(report){
  if(!report||report.reviewerVersion!==2||report.replay?.identical!==true||report.replay?.runs!==2)throw new Error('verified_review_required');
  const guards=report.safeguards||{};
  if(guards.qboWrites!==0||guards.portalWrites!==0||guards.historicalPayablesProposed!==0||guards.historicalPurchaseOrdersProposed!==0)throw new Error('verified_review_required');
  const rows=(report.results||[]).filter(row=>row.action==='ready'&&row.transactionType==='Bill'&&clean(row.ledgerId)&&clean(row.qboVendorId)&&money(row.total)>0);
  rows.sort((a,b)=>money(a.total)-money(b.total)||Number(a.ledgerId)-Number(b.ledgerId));
  if(!rows.length)throw new Error('no_canary_candidate');
  return rows[0];
}

function buildCanaryPlan({run,row,candidate,realm}){
  const raw=row?.raw_meta||{},date=dateValue(raw.doc_date),docNumber=clean(row?.doc_number||candidate?.documentNumber);
  const total=money(row?.doc_total),freight=money(raw.freight),sportsFee=money(raw.si_upcharge),poOrigin=clean(raw.po_origin),paymentMethod=clean(raw?.matchedPO?.po?._payment_method||raw?.matchedPO?.deco_po?._payment_method);
  if(!row||clean(row.id)!==clean(candidate.ledgerId)||row.status!=='pushed'||row.portal_status!=='success'||row.is_credit)throw new Error('candidate_changed');
  if(row.qb_status==='success'||clean(row.qb_bill_id))throw new Error('candidate_already_synced');
  if(docNumber!==clean(candidate.documentNumber)||clean(row.vendor)!==clean(candidate.vendor)||total!==money(candidate.total)||date!==candidate.date||clean(candidate.qboVendorId)==='')throw new Error('candidate_changed');
  if(poOrigin!=='portal'||paymentMethod||freight!==0||sportsFee!==0)throw new Error('candidate_changed');
  const purchase=run.report?.accounts?.purchases_account,ap=run.report?.accounts?.ap_account;
  if(!purchase?.id||purchase.number!=='51300'||!ap?.id||ap.number!=='21100')throw new Error('approved_accounts_required');
  const description=`Merchandise (${Array.isArray(raw.items)?raw.items.length:0} line item${Array.isArray(raw.items)&&raw.items.length===1?'':'s'}) — vendor doc #${docNumber} — PO ${clean(raw.po_number)||'unmatched'} — ${clean(row.vendor)}`;
  const payload={VendorRef:{value:clean(candidate.qboVendorId)},APAccountRef:{value:clean(ap.id)},TxnDate:date,DocNumber:docNumber,PrivateNote:`NSA-QB-CANARY:ledger-${clean(row.id)} | PO: ${clean(raw.po_number)||'unmatched'} | Doc #${docNumber}`,Line:[{Amount:total,DetailType:'AccountBasedExpenseLineDetail',Description:description,AccountBasedExpenseLineDetail:{AccountRef:{value:clean(purchase.id)},BillableStatus:'NotBillable',TaxCodeRef:{value:'NON'}}}]};
  const summary={realm:clean(realm),reviewRunId:clean(run.id),snapshotId:clean(run.snapshot_id),sourceHash:clean(run.report?.sourceHash),ledgerId:clean(row.id),documentNumber:docNumber,vendor:clean(row.vendor),qboVendorId:clean(candidate.qboVendorId),date,total,poNumber:clean(raw.po_number),purchaseAccount:{id:clean(purchase.id),number:'51300'},apAccount:{id:clean(ap.id),number:'21100'},posting:'one account-based merchandise line',itemsCreated:0,inventoryQuantityPosted:false};
  return{summary,payload,previewHash:hash({summary,payload})};
}

function verifyQboPrerequisites({plan,vendor,accounts,bills=[],credits=[]}){
  if(!vendor||clean(vendor.Id)!==plan.summary.qboVendorId||vendor.Active===false)throw new Error('vendor_changed');
  const purchase=(accounts||[]).filter(a=>a.Active!==false&&clean(a.Id)===plan.summary.purchaseAccount.id&&clean(a.AcctNum)==='51300');
  const ap=(accounts||[]).filter(a=>a.Active!==false&&clean(a.Id)===plan.summary.apAccount.id&&clean(a.AcctNum)==='21100');
  if(purchase.length!==1||ap.length!==1||clean(purchase[0].AccountType)!=='Cost of Goods Sold'||clean(ap[0].AccountType)!=='Accounts Payable')throw new Error('accounts_changed');
  if((bills||[]).length||(credits||[]).length)throw new Error('duplicate_document');
  return true;
}

function verifyCanaryReadback(plan,bill,documentBills=[],documentCredits=[]){
  const expected=plan.payload.Line.map(line=>'A|'+clean(line.AccountBasedExpenseLineDetail?.AccountRef?.value)+'|'+money(line.Amount).toFixed(2)).sort();
  const actual=(bill?.Line||[]).filter(line=>line.DetailType==='AccountBasedExpenseLineDetail').map(line=>'A|'+clean(line.AccountBasedExpenseLineDetail?.AccountRef?.value)+'|'+money(line.Amount).toFixed(2)).sort();
  const unexpected=(bill?.Line||[]).some(line=>line.DetailType==='ItemBasedExpenseLineDetail'||(line.DetailType!=='AccountBasedExpenseLineDetail'&&line.DetailType!=='SubTotalLineDetail'&&Math.abs(money(line.Amount))>=.005));
  const valid=clean(bill?.Id)&&clean(bill.DocNumber)===plan.summary.documentNumber&&clean(bill.VendorRef?.value)===plan.summary.qboVendorId&&clean(bill.APAccountRef?.value)===plan.summary.apAccount.id&&clean(bill.TxnDate).slice(0,10)===plan.summary.date&&Math.abs(money(bill.TotalAmt)-plan.summary.total)<.005&&!unexpected&&JSON.stringify(expected)===JSON.stringify(actual);
  if(!valid||documentCredits.length!==0||documentBills.length!==1||clean(documentBills[0]?.Id)!==clean(bill?.Id))throw new Error('readback_mismatch');
  return{id:clean(bill.Id),docNumber:clean(bill.DocNumber),vendorId:clean(bill.VendorRef?.value),date:clean(bill.TxnDate).slice(0,10),total:money(bill.TotalAmt),apAccountId:clean(bill.APAccountRef?.value),lines:actual};
}

module.exports={buildCanaryPlan,dateValue,payableCanaryAttemptKey,payableCanaryReceiptKey,selectCanaryCandidate,verifyCanaryReadback,verifyQboPrerequisites};
