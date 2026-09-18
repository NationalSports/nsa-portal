const {hash}=require('./_qboPayableSnapshot');

const clean=value=>String(value==null?'':value).trim();
const money=value=>Math.round((Number(value)||0)*100)/100;
const safeKey=value=>clean(value).replace(/[^A-Za-z0-9_-]/g,'_');
const attemptKey=realm=>`_qb_payable_po_bill_canary_attempt_${safeKey(realm)}`;
const receiptKey=(realm,billId)=>`_qb_canary_po_bill_${safeKey(realm)}_${safeKey(billId)}`;
const linkKey=(realm,mapKey,sourceId)=>'_qb_link_v1_'+encodeURIComponent(JSON.stringify([clean(realm),clean(mapKey),clean(sourceId)]));

const dateValue=value=>{
  const raw=clean(value);let match=raw.match(/^(\d{4})-(\d{2})-(\d{2})/),y,m,d;
  if(match){[,y,m,d]=match}else{match=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/);if(!match)return null;[,m,d,y]=match;if(y.length===2)y='20'+y}
  const dt=new Date(Date.UTC(+y,+m-1,+d));
  return dt.getUTCFullYear()===+y&&dt.getUTCMonth()===+m-1&&dt.getUTCDate()===+d?`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
};

function listCandidates(report){
  if(!report||report.reviewerVersion!==2||report.replay?.identical!==true||report.replay?.runs!==2)throw new Error('verified_review_required');
  const guards=report.safeguards||{};
  if(guards.qboWrites!==0||guards.portalWrites!==0||guards.historicalPayablesProposed!==0||guards.historicalPurchaseOrdersProposed!==0)throw new Error('verified_review_required');
  const rows=(report.results||[]).filter(row=>row.action==='ready'&&row.transactionType==='Bill'&&row.vendorMatchSource==='durable_link'&&clean(row.ledgerId)&&clean(row.qboVendorId)&&money(row.total)>0);
  rows.sort((a,b)=>money(a.total)-money(b.total)||Number(a.ledgerId)-Number(b.ledgerId));
  if(!rows.length)throw new Error('no_po_bill_canary_candidate');
  return rows;
}

function buildSource({run,row,candidate,realm,qboPurchaseOrderId}){
  const raw=row?.raw_meta||{},date=dateValue(raw.doc_date),documentNumber=clean(row?.doc_number||candidate?.documentNumber),poNumber=clean(raw.po_number);
  const total=money(row?.doc_total),freight=money(raw.freight),sportsFee=money(raw.si_upcharge),paymentMethod=clean(raw?.matchedPO?.po?._payment_method||raw?.matchedPO?.deco_po?._payment_method);
  if(!row||clean(row.id)!==clean(candidate.ledgerId)||row.status!=='pushed'||row.portal_status!=='success'||row.is_credit)throw new Error('po_bill_candidate_changed');
  if(row.qb_status==='success'||clean(row.qb_bill_id))throw new Error('po_bill_candidate_changed');
  if(documentNumber!==clean(candidate.documentNumber)||clean(row.vendor)!==clean(candidate.vendor)||total!==money(candidate.total)||date!==candidate.date||clean(candidate.qboVendorId)==='')throw new Error('po_bill_candidate_changed');
  const merchandise=money(total-freight);
  if(clean(raw.po_origin)!=='portal'||paymentMethod||freight<0||sportsFee!==0||merchandise<=0||!poNumber||!clean(qboPurchaseOrderId))throw new Error('po_bill_candidate_changed');
  const purchase=run.report?.accounts?.purchases_account,freightAccount=run.report?.accounts?.freight_account,ap=run.report?.accounts?.ap_account;
  if(!purchase?.id||purchase.number!=='51300'||!ap?.id||ap.number!=='21100'||(freight>0&&(!freightAccount?.id||freightAccount.number!=='51000')))throw new Error('approved_accounts_required');
  return{run,row,candidate,realm:clean(realm),documentNumber,poNumber,qboPurchaseOrderId:clean(qboPurchaseOrderId),date,total,freight,merchandise,purchase,freightAccount,ap};
}

function buildPlan(source,purchaseOrder){
  const poLines=(purchaseOrder?.Line||[]).filter(line=>line.DetailType!=='SubTotalLineDetail'&&Math.abs(money(line.Amount))>=.005);
  const poLinks=[...(purchaseOrder?.LinkedTxn||[]),...(purchaseOrder?.Line||[]).flatMap(line=>line.LinkedTxn||[])].filter(link=>clean(link?.TxnType)==='Bill');
  const validPO=clean(purchaseOrder?.Id)===source.qboPurchaseOrderId&&clean(purchaseOrder.DocNumber)===source.poNumber&&clean(purchaseOrder.VendorRef?.value)===clean(source.candidate.qboVendorId)&&clean(purchaseOrder.POStatus).toLowerCase()==='open'&&Math.abs(money(purchaseOrder.TotalAmt)-source.merchandise)<.005&&!poLinks.length;
  const validLines=poLines.length>0&&poLines.every(line=>clean(line.Id)&&line.DetailType==='AccountBasedExpenseLineDetail'&&clean(line.AccountBasedExpenseLineDetail?.AccountRef?.value)===clean(source.purchase.id)&&money(line.Amount)>0)&&Math.abs(money(poLines.reduce((sum,line)=>sum+money(line.Amount),0))-source.merchandise)<.005;
  if(!validPO||!validLines)throw new Error('purchase_order_not_linkable');
  const linkedLines=poLines.map(line=>({Amount:money(line.Amount),DetailType:'AccountBasedExpenseLineDetail',Description:`PO ${source.poNumber} — vendor doc #${source.documentNumber}`,LinkedTxn:[{TxnId:source.qboPurchaseOrderId,TxnType:'PurchaseOrder',TxnLineId:clean(line.Id)}],AccountBasedExpenseLineDetail:{AccountRef:{value:clean(source.purchase.id)},BillableStatus:'NotBillable',TaxCodeRef:{value:'NON'}}}));
  const lines=[...linkedLines,...(source.freight>0?[{Amount:source.freight,DetailType:'AccountBasedExpenseLineDetail',Description:`Freight In — vendor doc #${source.documentNumber} — PO ${source.poNumber}`,AccountBasedExpenseLineDetail:{AccountRef:{value:clean(source.freightAccount.id)},BillableStatus:'NotBillable',TaxCodeRef:{value:'NON'}}}]:[])];
  const payload={VendorRef:{value:clean(source.candidate.qboVendorId)},APAccountRef:{value:clean(source.ap.id)},TxnDate:source.date,DocNumber:source.documentNumber,PrivateNote:`NSA-QB-PO-BILL-CANARY:ledger-${clean(source.row.id)} | PO: ${source.poNumber} | Doc #${source.documentNumber}`,Line:lines};
  const summary={realm:source.realm,reviewRunId:clean(source.run.id),snapshotId:clean(source.run.snapshot_id),sourceHash:clean(source.run.report?.sourceHash),ledgerId:clean(source.row.id),documentNumber:source.documentNumber,vendor:clean(source.row.vendor),qboVendorId:clean(source.candidate.qboVendorId),date:source.date,total:source.total,merchandise:source.merchandise,freight:source.freight,poNumber:source.poNumber,qboPurchaseOrderId:source.qboPurchaseOrderId,purchaseAccount:{id:clean(source.purchase.id),number:'51300'},...(source.freight>0?{freightAccount:{id:clean(source.freightAccount.id),number:'51000'}}:{}),apAccount:{id:clean(source.ap.id),number:'21100'},posting:`${linkedLines.length} account-based merchandise line${linkedLines.length===1?'':'s'} linked to the existing QBO PO${source.freight>0?' plus one 51000 Freight In line':''}`,itemsCreated:0,inventoryQuantityPosted:false};
  return{summary,payload,previewHash:hash({summary,payload})};
}

function verifyPrerequisites({source,vendor,accounts,bills=[],credits=[]}){
  if(!vendor||vendor.Active===false||clean(vendor.Id)!==clean(source.candidate.qboVendorId))throw new Error('vendor_changed');
  const purchase=(accounts||[]).filter(a=>a.Active!==false&&clean(a.Id)===clean(source.purchase.id)&&clean(a.AcctNum)==='51300');
  const freight=(accounts||[]).filter(a=>a.Active!==false&&clean(a.Id)===clean(source.freightAccount?.id)&&clean(a.AcctNum)==='51000');
  const ap=(accounts||[]).filter(a=>a.Active!==false&&clean(a.Id)===clean(source.ap.id)&&clean(a.AcctNum)==='21100');
  if(purchase.length!==1||ap.length!==1||(source.freight>0&&freight.length!==1)||clean(purchase[0].AccountType)!=='Cost of Goods Sold'||(source.freight>0&&clean(freight[0].AccountType)!=='Cost of Goods Sold')||clean(ap[0].AccountType)!=='Accounts Payable')throw new Error('accounts_changed');
  if((bills||[]).length||(credits||[]).length)throw new Error('duplicate_document');
  return true;
}

function linkedTransactions(entity,type){
  return [...(entity?.LinkedTxn||[]),...(entity?.Line||[]).flatMap(line=>line.LinkedTxn||[])].filter(link=>clean(link?.TxnType)===type);
}

function verifyReadback(plan,bill,purchaseOrder,documentBills=[],documentCredits=[]){
  const expected=plan.payload.Line.map(line=>`A|${clean(line.AccountBasedExpenseLineDetail?.AccountRef?.value)}|${money(line.Amount).toFixed(2)}|${clean(line.LinkedTxn?.[0]?.TxnLineId)}`).sort();
  const actual=(bill?.Line||[]).filter(line=>line.DetailType==='AccountBasedExpenseLineDetail').map(line=>{const link=(line.LinkedTxn||[]).find(item=>clean(item.TxnType)==='PurchaseOrder'&&clean(item.TxnId)===plan.summary.qboPurchaseOrderId);return`A|${clean(line.AccountBasedExpenseLineDetail?.AccountRef?.value)}|${money(line.Amount).toFixed(2)}|${clean(link?.TxnLineId)}`}).sort();
  const unexpected=(bill?.Line||[]).some(line=>line.DetailType==='ItemBasedExpenseLineDetail'||(line.DetailType!=='AccountBasedExpenseLineDetail'&&line.DetailType!=='SubTotalLineDetail'&&Math.abs(money(line.Amount))>=.005));
  const billLinks=linkedTransactions(bill,'PurchaseOrder'),poLinks=linkedTransactions(purchaseOrder,'Bill');
  const valid=clean(bill?.Id)&&clean(bill.DocNumber)===plan.summary.documentNumber&&clean(bill.VendorRef?.value)===plan.summary.qboVendorId&&clean(bill.APAccountRef?.value)===plan.summary.apAccount.id&&clean(bill.TxnDate).slice(0,10)===plan.summary.date&&Math.abs(money(bill.TotalAmt)-plan.summary.total)<.005&&Math.abs(money(bill.Balance)-plan.summary.total)<.005&&!unexpected&&JSON.stringify(expected)===JSON.stringify(actual)&&billLinks.length===plan.payload.Line.filter(line=>line.LinkedTxn?.length).length&&billLinks.every(link=>clean(link.TxnId)===plan.summary.qboPurchaseOrderId)&&clean(purchaseOrder?.Id)===plan.summary.qboPurchaseOrderId&&clean(purchaseOrder.VendorRef?.value)===plan.summary.qboVendorId&&poLinks.some(link=>clean(link.TxnId)===clean(bill.Id));
  if(!valid||documentCredits.length!==0||documentBills.length!==1||clean(documentBills[0]?.Id)!==clean(bill?.Id))throw new Error('po_bill_readback_mismatch');
  return{id:clean(bill.Id),docNumber:clean(bill.DocNumber),vendorId:clean(bill.VendorRef?.value),date:clean(bill.TxnDate).slice(0,10),total:money(bill.TotalAmt),balance:money(bill.Balance),apAccountId:clean(bill.APAccountRef?.value),purchaseOrderId:plan.summary.qboPurchaseOrderId,lines:actual,reciprocalLink:true};
}

module.exports={attemptKey,buildPlan,buildSource,dateValue,linkKey,listCandidates,receiptKey,verifyPrerequisites,verifyReadback};
