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
  const merchandise=money(total-freight-sportsFee);
  if(clean(raw.po_origin)!=='portal'||paymentMethod||freight<0||sportsFee<0||merchandise<=0||!poNumber||!clean(qboPurchaseOrderId))throw new Error('po_bill_candidate_changed');
  const purchase=run.report?.accounts?.purchases_account,freightAccount=run.report?.accounts?.freight_account,sportsFeeAccount=run.report?.accounts?.sports_inc_fee_account,ap=run.report?.accounts?.ap_account;
  if(!purchase?.id||purchase.number!=='51300'||!ap?.id||ap.number!=='21100'||(freight>0&&(!freightAccount?.id||freightAccount.number!=='51000'))||(sportsFee>0&&(!sportsFeeAccount?.id||sportsFeeAccount.number!=='58000')))throw new Error('approved_accounts_required');
  return{run,row,candidate,realm:clean(realm),documentNumber,poNumber,qboPurchaseOrderId:clean(qboPurchaseOrderId),date,total,freight,sportsFee,merchandise,purchase,freightAccount,sportsFeeAccount,ap};
}

function buildPlan(source,purchaseOrder){
  const poLines=(purchaseOrder?.Line||[]).filter(line=>line.DetailType!=='SubTotalLineDetail'&&Math.abs(money(line.Amount))>=.005);
  const poLinks=[...(purchaseOrder?.LinkedTxn||[]),...(purchaseOrder?.Line||[]).flatMap(line=>line.LinkedTxn||[])].filter(link=>clean(link?.TxnType)==='Bill');
  const validPO=clean(purchaseOrder?.Id)===source.qboPurchaseOrderId&&clean(purchaseOrder.DocNumber)===source.poNumber&&clean(purchaseOrder.VendorRef?.value)===clean(source.candidate.qboVendorId)&&clean(purchaseOrder.POStatus).toLowerCase()==='open'&&Math.abs(money(purchaseOrder.TotalAmt)-source.merchandise)<.005&&!poLinks.length;
  const validLines=poLines.length>0&&poLines.every(line=>clean(line.Id)&&line.DetailType==='AccountBasedExpenseLineDetail'&&clean(line.AccountBasedExpenseLineDetail?.AccountRef?.value)===clean(source.purchase.id)&&money(line.Amount)>0)&&Math.abs(money(poLines.reduce((sum,line)=>sum+money(line.Amount),0))-source.merchandise)<.005;
  if(!validPO||!validLines)throw new Error('purchase_order_not_linkable');
  // QBO copies the PO's lines only when the BillAdd links the purchase order as
  // a transaction. Supplying a new account line with a line-level LinkedTxn is
  // accepted but silently drops that line, leaving only unlinked charges on the
  // bill. Link the whole (fully matched) PO here and send only reviewed charges
  // that are not part of it.
  const extraLines=[...(source.freight>0?[{Amount:source.freight,DetailType:'AccountBasedExpenseLineDetail',Description:`Freight In — vendor doc #${source.documentNumber} — PO ${source.poNumber}`,AccountBasedExpenseLineDetail:{AccountRef:{value:clean(source.freightAccount.id)},BillableStatus:'NotBillable',TaxCodeRef:{value:'NON'}}}]:[]),...(source.sportsFee>0?[{Amount:source.sportsFee,DetailType:'AccountBasedExpenseLineDetail',Description:`Sports Inc fee — vendor doc #${source.documentNumber} — PO ${source.poNumber}`,AccountBasedExpenseLineDetail:{AccountRef:{value:clean(source.sportsFeeAccount.id)},BillableStatus:'NotBillable',TaxCodeRef:{value:'NON'}}}]:[])];
  const payload={VendorRef:{value:clean(source.candidate.qboVendorId)},APAccountRef:{value:clean(source.ap.id)},TxnDate:source.date,DocNumber:source.documentNumber,PrivateNote:`NSA-QB-PO-BILL-CANARY:ledger-${clean(source.row.id)} | PO: ${source.poNumber} | Doc #${source.documentNumber}`,LinkedTxn:[{TxnId:source.qboPurchaseOrderId,TxnType:'PurchaseOrder'}],...(extraLines.length?{Line:extraLines}:{})};
  const expectedLines=[...poLines.map(line=>({Amount:money(line.Amount),accountId:clean(line.AccountBasedExpenseLineDetail?.AccountRef?.value)})),...extraLines.map(line=>({Amount:money(line.Amount),accountId:clean(line.AccountBasedExpenseLineDetail?.AccountRef?.value)}))];
  const summary={realm:source.realm,reviewRunId:clean(source.run.id),snapshotId:clean(source.run.snapshot_id),sourceHash:clean(source.run.report?.sourceHash),ledgerId:clean(source.row.id),documentNumber:source.documentNumber,vendor:clean(source.row.vendor),qboVendorId:clean(source.candidate.qboVendorId),date:source.date,total:source.total,merchandise:source.merchandise,freight:source.freight,sportsFee:source.sportsFee,poNumber:source.poNumber,qboPurchaseOrderId:source.qboPurchaseOrderId,purchaseAccount:{id:clean(source.purchase.id),number:'51300'},...(source.freight>0?{freightAccount:{id:clean(source.freightAccount.id),number:'51000'}}:{}),...(source.sportsFee>0?{sportsFeeAccount:{id:clean(source.sportsFeeAccount.id),number:'58000'}}:{}),apAccount:{id:clean(source.ap.id),number:'21100'},posting:`${poLines.length} account-based merchandise line${poLines.length===1?'':'s'} linked to the existing QBO PO${source.freight>0?' plus one 51000 Freight In line':''}${source.sportsFee>0?' plus one 58000 Sports Inc fee line':''}`,itemsCreated:0,inventoryQuantityPosted:false};
  return{summary,payload,expectedLines,previewHash:hash({summary,payload,expectedLines})};
}

function verifyPrerequisites({source,vendor,accounts,bills=[],credits=[]}){
  if(!vendor||vendor.Active===false||clean(vendor.Id)!==clean(source.candidate.qboVendorId))throw new Error('vendor_changed');
  const purchase=(accounts||[]).filter(a=>a.Active!==false&&clean(a.Id)===clean(source.purchase.id)&&clean(a.AcctNum)==='51300');
  const freight=(accounts||[]).filter(a=>a.Active!==false&&clean(a.Id)===clean(source.freightAccount?.id)&&clean(a.AcctNum)==='51000');
  const sportsFee=(accounts||[]).filter(a=>a.Active!==false&&clean(a.Id)===clean(source.sportsFeeAccount?.id)&&clean(a.AcctNum)==='58000');
  const ap=(accounts||[]).filter(a=>a.Active!==false&&clean(a.Id)===clean(source.ap.id)&&clean(a.AcctNum)==='21100');
  if(purchase.length!==1||ap.length!==1||(source.freight>0&&freight.length!==1)||(source.sportsFee>0&&sportsFee.length!==1)||clean(purchase[0].AccountType)!=='Cost of Goods Sold'||(source.freight>0&&clean(freight[0].AccountType)!=='Cost of Goods Sold')||(source.sportsFee>0&&clean(sportsFee[0].AccountType)!=='Cost of Goods Sold')||clean(ap[0].AccountType)!=='Accounts Payable')throw new Error('accounts_changed');
  if((bills||[]).length||(credits||[]).length)throw new Error('duplicate_document');
  return true;
}

function linkedTransactions(entity,type){
  return [...(entity?.LinkedTxn||[]),...(entity?.Line||[]).flatMap(line=>line.LinkedTxn||[])].filter(link=>clean(link?.TxnType)===type);
}

function repairPlan(plan){
  if(!plan?.summary||!plan?.payload)throw new Error('repair_source_changed');
  const sourceLines=plan.payload.Line||[],extraLines=sourceLines.filter(line=>!linkedTransactions(line,'PurchaseOrder').length);
  const expectedLines=(plan.expectedLines?.length?plan.expectedLines:sourceLines.map(line=>({Amount:money(line.Amount),accountId:clean(line.AccountBasedExpenseLineDetail?.AccountRef?.value)}))).map(line=>({Amount:money(line.Amount),accountId:clean(line.accountId)}));
  const payload={...plan.payload,LinkedTxn:[{TxnId:plan.summary.qboPurchaseOrderId,TxnType:'PurchaseOrder'}],...(extraLines.length?{Line:extraLines}:{})};
  if(!extraLines.length)delete payload.Line;
  return{...plan,payload,expectedLines,previewHash:hash({summary:plan.summary,payload,expectedLines})};
}

function verifyRepairSource(plan,bill,purchaseOrder,documentBills=[],documentCredits=[]){
  const expected=plan.payload.Line||[],signature=line=>`A|${clean(line.AccountBasedExpenseLineDetail?.AccountRef?.value)}|${money(line.Amount).toFixed(2)}`;
  const actual=(bill?.Line||[]).filter(line=>line.DetailType==='AccountBasedExpenseLineDetail').map(signature).sort(),extras=expected.map(signature).sort();
  const expectedPartial=money(plan.summary.freight)+money(plan.summary.sportsFee),hasLinks=linkedTransactions(bill,'PurchaseOrder').length||linkedTransactions(purchaseOrder,'Bill').length;
  const valid=clean(bill?.Id)&&clean(bill.SyncToken)!==''&&clean(bill.DocNumber)===plan.summary.documentNumber&&clean(bill.VendorRef?.value)===plan.summary.qboVendorId&&clean(bill.APAccountRef?.value)===plan.summary.apAccount.id&&clean(bill.TxnDate).slice(0,10)===plan.summary.date&&Math.abs(money(bill.TotalAmt)-expectedPartial)<.005&&Math.abs(money(bill.Balance)-expectedPartial)<.005&&JSON.stringify(actual)===JSON.stringify(extras)&&!hasLinks&&clean(purchaseOrder?.Id)===plan.summary.qboPurchaseOrderId&&clean(purchaseOrder.VendorRef?.value)===plan.summary.qboVendorId&&clean(purchaseOrder.POStatus).toLowerCase()==='open'&&Math.abs(money(purchaseOrder.TotalAmt)-money(plan.summary.merchandise))<.005;
  if(!valid||documentCredits.length||documentBills.length!==1||clean(documentBills[0]?.Id)!==clean(bill?.Id))throw new Error('repair_source_changed');
  return true;
}

function verifyReadback(plan,bill,purchaseOrder,documentBills=[],documentCredits=[],ignoredDocumentBillIds=[]){
  const expected=(plan.expectedLines||[]).map(line=>`A|${clean(line.accountId)}|${money(line.Amount).toFixed(2)}`).sort();
  const actual=(bill?.Line||[]).filter(line=>line.DetailType==='AccountBasedExpenseLineDetail').map(line=>`A|${clean(line.AccountBasedExpenseLineDetail?.AccountRef?.value)}|${money(line.Amount).toFixed(2)}`).sort();
  const unexpected=(bill?.Line||[]).some(line=>line.DetailType==='ItemBasedExpenseLineDetail'||(line.DetailType!=='AccountBasedExpenseLineDetail'&&line.DetailType!=='SubTotalLineDetail'&&Math.abs(money(line.Amount))>=.005));
  const billLinks=linkedTransactions(bill,'PurchaseOrder'),poLinks=linkedTransactions(purchaseOrder,'Bill');
  const valid=clean(bill?.Id)&&clean(bill.DocNumber)===plan.summary.documentNumber&&clean(bill.VendorRef?.value)===plan.summary.qboVendorId&&clean(bill.APAccountRef?.value)===plan.summary.apAccount.id&&clean(bill.TxnDate).slice(0,10)===plan.summary.date&&Math.abs(money(bill.TotalAmt)-plan.summary.total)<.005&&Math.abs(money(bill.Balance)-plan.summary.total)<.005&&!unexpected&&JSON.stringify(expected)===JSON.stringify(actual)&&billLinks.some(link=>clean(link.TxnId)===plan.summary.qboPurchaseOrderId)&&billLinks.every(link=>clean(link.TxnId)===plan.summary.qboPurchaseOrderId)&&clean(purchaseOrder?.Id)===plan.summary.qboPurchaseOrderId&&clean(purchaseOrder.VendorRef?.value)===plan.summary.qboVendorId&&clean(purchaseOrder.POStatus).toLowerCase()==='closed'&&poLinks.some(link=>clean(link.TxnId)===clean(bill.Id));
  const ignored=new Set(ignoredDocumentBillIds.map(clean)),relevantBills=documentBills.filter(item=>!ignored.has(clean(item?.Id)));
  if(!valid||documentCredits.length!==0||relevantBills.length!==1||clean(relevantBills[0]?.Id)!==clean(bill?.Id))throw new Error('po_bill_readback_mismatch');
  return{id:clean(bill.Id),docNumber:clean(bill.DocNumber),vendorId:clean(bill.VendorRef?.value),date:clean(bill.TxnDate).slice(0,10),total:money(bill.TotalAmt),balance:money(bill.Balance),apAccountId:clean(bill.APAccountRef?.value),purchaseOrderId:plan.summary.qboPurchaseOrderId,lines:actual,reciprocalLink:true};
}

module.exports={attemptKey,buildPlan,buildSource,dateValue,linkKey,listCandidates,receiptKey,repairPlan,verifyPrerequisites,verifyReadback,verifyRepairSource};
