const { createHash, randomUUID } = require('crypto');

const clean = value => String(value == null ? '' : value).trim();
const money = value => Math.round((Number(value) || 0) * 100) / 100;
const norm = value => clean(value).toLowerCase();
const sumMoney = rows => money((rows || []).reduce((sum, row) => sum + Math.abs(Number(row?.total) || 0), 0));
const suffixes = new Set(['co','company','corp','corporation','inc','incorporated','llc','llp','lp','ltd','limited']);
const aliases = new Map([
  ['adidas us team services','adidas'],['rawlings sporting goods','rawlings'],['richardson cap','richardson'],
  ['badger sportswear','badger'],['badger for under armour','badger'],['twin city knitting','twin city tck'],
  ['champion sports','champion'],['outdoor cap co inc a','outdoor cap'],
  ['all star sptg goods products','all star sporting goods'],['augusta sportswear asi','augusta sportswear'],
]);
const normalizeVendor = value => {
  const tokens = norm(value).replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && suffixes.has(tokens[tokens.length - 1])) tokens.pop();
  const result = tokens.join(' '); return aliases.get(result) || result;
};
const dateValue = value => {
  const raw=clean(value); let match=raw.match(/^(\d{4})-(\d{2})-(\d{2})/), y,m,d;
  if(match){[,y,m,d]=match}else{match=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})/);if(!match)return null;[,m,d,y]=match;if(y.length===2)y='20'+y}
  const dt=new Date(Date.UTC(+y,+m-1,+d));
  return dt.getUTCFullYear()===+y&&dt.getUTCMonth()===+m-1&&dt.getUTCDate()===+d?`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
};
const fingerprint = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const accountTypeMatches=(actual,expected)=>{const value=norm(actual).replace(/\s*\(.*\)$/,'');return expected.some(type=>{const target=norm(type);return value===target||value===target+'s'||value+'s'===target})};
const safeFailureCodes=new Set(['snapshot_failed','snapshot_limit','qbo_read_failed','qbo_population_limit','realm_changed','invalid_realm','run_finish_failed']);
const failureCode=(stage,error)=>`payable_review_${stage}_${safeFailureCodes.has(clean(error?.message))?clean(error.message):'unexpected'}`;
const actionSummary = rows => (rows || []).reduce((out,row)=>{
  const key=clean(row.action)||'unknown';
  out.counts[key]=(out.counts[key]||0)+1;
  out.totals[key]=money((out.totals[key]||0)+Math.abs(Number(row.total)||0));
  return out;
},{counts:{},totals:{}});

function buildRows(ledgerRows) {
  return (ledgerRows||[]).filter(row=>row?.status==='pushed'&&row?.portal_status==='success'&&!(row?.qb_status==='success'&&clean(row.qb_bill_id))).map(row=>{
    const raw=row.raw_meta&&typeof row.raw_meta==='object'?row.raw_meta:{};
    const total=money(row.doc_total==null?raw.doc_total:row.doc_total);
    return {ledgerId:clean(row.id),documentNumber:clean(row.doc_number||raw.doc_number||row.doc_norm),vendor:clean(row.vendor||raw.vendor||raw.supplier),
      date:dateValue(raw.doc_date),total,isCredit:!!row.is_credit,transactionType:row.is_credit?'VendorCredit':'Bill',
      freight:money(raw.freight),sportsFee:money(raw.si_upcharge),kind:clean(raw.kind),source:clean(row.source||raw.source)};
  });
}

function resolveVendor(row, portalVendors, qboVendors, vendorLinks) {
  const key=normalizeVendor(row.vendor);
  const portals=(portalVendors||[]).filter(v=>v?.is_active!==false&&normalizeVendor(v.name)===key);
  if(portals.length>1)return {error:`Multiple active portal vendors match "${row.vendor}"`,code:'ambiguous_portal_vendor'};
  const saved=portals[0]&&clean(vendorLinks[portals[0].id]);
  if(saved){const hits=qboVendors.filter(v=>v?.Active!==false&&clean(v.Id)===saved);return hits.length===1?{vendor:hits[0],portalVendorId:clean(portals[0].id),matchSource:'durable_link'}:{error:`Saved vendor link for "${row.vendor}" points to a missing or inactive QBO vendor`,code:'invalid_vendor_link'}}
  const hits=qboVendors.filter(v=>v?.Active!==false&&[v.DisplayName,v.CompanyName].some(name=>normalizeVendor(name)===key));
  return hits.length===1?{vendor:hits[0],portalVendorId:clean(portals[0]?.id),matchSource:'unique_normalized_name'}:{error:`Vendor "${row.vendor}" is not linked or uniquely present in QBO`,code:'unlinked_vendor'};
}

function analyzePayables({ledgerRows=[],portalVendors=[],vendorLinks={},qboVendors=[],qboBills=[],qboVendorCredits=[],accountIds={}}={}) {
  const required=['purchases_account','freight_account','sports_inc_fee_account','deco_account'];
  const accountError=required.find(key=>!clean(accountIds[key]));
  const payables=[...qboBills.map(x=>({...x,_type:'Bill'})),...qboVendorCredits.map(x=>({...x,_type:'VendorCredit'}))];
  const rows=buildRows(ledgerRows).map(row=>{
    const blocked=(reason,code)=>({...row,action:'blocked',reason,code});
    if(!row.ledgerId)return blocked('Bill ledger row is missing its immutable ID','missing_source_id');
    if(!row.documentNumber)return blocked('Vendor document number is missing','missing_document_number');
    if(!row.vendor)return blocked('Canonical portal vendor is missing','missing_vendor');
    if(!row.date)return blocked('Bill date is missing or invalid','invalid_date');
    if(!(Math.abs(row.total)>0))return blocked(`${row.transactionType} total must be non-zero`,'zero_total');
    const resolved=resolveVendor(row,portalVendors,qboVendors,vendorLinks);if(resolved.error)return blocked(resolved.error,resolved.code);
    if(!row.isCredit&&accountError)return blocked(`Required QBO account ${accountError} was not uniquely resolved`,'missing_account');
    const qboVendorId=clean(resolved.vendor.Id),vendorEvidence={portalVendorId:resolved.portalVendorId||null,vendorMatchSource:resolved.matchSource}, numbered=payables.filter(x=>norm(x.DocNumber)===norm(row.documentNumber));
    const exact=numbered.filter(x=>x._type===row.transactionType&&clean(x.VendorRef?.value)===qboVendorId&&Math.abs(money(x.TotalAmt)-Math.abs(row.total))<.005&&clean(x.TxnDate).slice(0,10)===row.date);
    if(numbered.length>1||(numbered.length===1&&exact.length!==1))return {...row,qboVendorId,...vendorEvidence,action:'conflict',code:'ambiguous_duplicate',reason:`QBO document ${row.documentNumber} exists with a different vendor, date, total, or type`,qboCandidates:numbered.map(x=>({id:clean(x.Id),type:x._type,vendorId:clean(x.VendorRef?.value),date:clean(x.TxnDate).slice(0,10),total:money(x.TotalAmt)}))};
    if(exact.length===1)return {...row,qboVendorId,...vendorEvidence,action:'already_exists',code:'exact_existing_match',reason:`Exact QBO ${row.transactionType} #${exact[0].Id}`,qboBillId:clean(exact[0].Id)};
    if(row.isCredit)return blocked('Vendor credit creation is not enabled; no exact QBO VendorCredit was found','credit_creation_disabled');
    const merchandise=money(row.total-row.freight-row.sportsFee);
    if(row.freight<0||row.sportsFee<0||row.total<=0||merchandise<=0)return blocked('Approved account lines do not produce a positive, fully categorized bill total','invalid_account_lines');
    return {...row,qboVendorId,...vendorEvidence,action:'ready',code:'ready'};
  });
  return {rows,...actionSummary(rows)};
}

const poMeta=row=>row?.sizes&&typeof row.sizes==='object'?row.sizes:{};
const poQty=row=>Object.entries(poMeta(row)).filter(([key,value])=>typeof value==='number'&&value>0&&!key.startsWith('_')
  &&!['unit_cost','po_type','deco_type','drop_ship','billed','tracking_numbers'].includes(key)&&/^[A-Z0-9]/.test(key))
  .reduce((sum,[,value])=>sum+value,0);
const poHistorical=(row,order)=>{
  const meta=poMeta(row), source=norm(meta._import_source||row?._import_source), memo=clean(row?.memo), raw=clean(row?.po_id);
  if(meta.preexisting===true||row?.preexisting===true||source==='netsuite'||order?._doc_type==='po'||/preexisting\s+po.*netsuite/i.test(memo))return true;
  const created=dateValue(row?.created_at); if(created&&created<'2026-09-09')return true;
  return /^(?:D?PO)\d/i.test(raw);
};

function buildPortalPOGroups(snapshot={}) {
  const items=new Map((snapshot.soItems||[]).map(item=>[clean(item.id),item]));
  const orders=new Map((snapshot.salesOrders||[]).map(order=>[clean(order.id),order]));
  const vendorNames=new Map((snapshot.portalVendors||[]).map(vendor=>[clean(vendor.id),clean(vendor.name)]));
  const productsBySku=new Map((snapshot.products||[]).map(product=>[clean(product.sku).toUpperCase(),product]));
  const groups=new Map();
  for(const row of snapshot.poLines||[]){
    const poId=clean(row?.po_id);if(!poId)continue;
    const item=items.get(clean(row.so_item_id))||{}, order=orders.get(clean(item.so_id))||{}, meta=poMeta(row);
    const qty=poQty(row),rate=money(meta.unit_cost==null?item.nsa_cost:meta.unit_cost),amount=money(qty*rate);
    const savedVendor=clean(row.vendor||meta.deco_vendor),vendor=vendorNames.get(savedVendor)||savedVendor||clean(item.brand),accountKey=meta.po_type==='outside_deco'?'deco_account':'purchases_account';
    const productId=clean(item.product_id||productsBySku.get(clean(item.sku).toUpperCase())?.id);
    const line={sourceLineId:clean(row.id),sourceOrderId:clean(item.so_id),sourceItemId:clean(item.id),productId,sku:clean(item.sku),qty,rate,amount,vendor,accountKey};
    let group=groups.get(poId);if(!group){group={poId,date:dateValue(row.created_at),vendor,accountKey,total:0,lines:[],historical:false};groups.set(poId,group)}
    if(group.vendor!==vendor)group.invalidReason='mixed vendors share this PO number';
    if(group.accountKey!==accountKey)group.invalidReason='merchandise and outside-decoration lines share this PO number';
    if(!group.date)group.date=dateValue(row.created_at);
    group.total=money(group.total+amount);group.lines.push(line);group.historical=group.historical||poHistorical(row,order);
  }
  return [...groups.values()];
}

function analyzePurchaseOrders({snapshot={},qboVendors=[],qboPurchaseOrders=[],qboItems=[],accountIds={}}={}) {
  const groups=buildPortalPOGroups(snapshot),links=snapshot.links||{},poMap=links.qbPOMap||{},itemMap=links.prodQBMap||{};
  const parked=new Set((snapshot.qbConfig?.parkedPurchaseOrderIds||[]).map(clean));
  const qboPoById=new Map(qboPurchaseOrders.map(row=>[clean(row.Id),row])),qboItemById=new Map(qboItems.map(row=>[clean(row.Id),row]));
  const excluded=[],awaiting=[],linked=[],unlinkedItems=new Map(),invalidItemLinks=[];
  const pendingGroups=groups.filter(group=>!poMap[group.poId]&&!parked.has(group.poId)&&!group.historical),usedProductIds=new Set(pendingGroups.flatMap(group=>group.lines.map(line=>line.productId)).filter(Boolean));
  for(const [sourceId,qboId] of Object.entries(itemMap)){
    if(!usedProductIds.has(clean(sourceId)))continue;
    const item=qboItemById.get(clean(qboId)),issues=[];
    if(!item)issues.push('missing QBO item');else{if(item.Active===false)issues.push('inactive QBO item');if(clean(item.Type)!=='NonInventory')issues.push('QBO item is not NonInventory');if(clean(item.IncomeAccountRef?.value)!==clean(accountIds.income_account))issues.push('income account is not 40000');if(clean(item.ExpenseAccountRef?.value)!==clean(accountIds.purchases_account))issues.push('purchase expense account is not 51300')}
    if(issues.length)invalidItemLinks.push({sourceId:clean(sourceId),qboId:clean(qboId),reason:'Durable item link points to an invalid item: '+issues.join('; ')});
  }
  for(const group of groups){
    const linkedId=clean(poMap[group.poId]);
    if(linkedId){const qbo=qboPoById.get(linkedId);linked.push({poId:group.poId,qboId:linkedId,total:money(qbo?.TotalAmt),sourceTotal:group.total,status:qbo?'linked':'missing_qbo_record',reason:qbo?'':'Durable PO link points to a missing QBO purchase order'});continue}
    if(parked.has(group.poId)){excluded.push({...group,action:'excluded_parked',reason:'Explicitly parked for later review'});continue}
    if(group.historical){excluded.push({...group,action:'excluded_historical',reason:'Historical/cutover PO intentionally excluded'});continue}
    for(const line of group.lines){if(!line.productId||!itemMap[line.productId]){const key=line.productId||line.sku||'(blank)',sku=clean(line.sku).toUpperCase();const candidates=qboItems.filter(item=>item?.Active!==false&&clean(item.Type)==='NonInventory'&&clean(item.Sku||item.Name).toUpperCase()===sku);const verified=candidates.filter(item=>clean(item.IncomeAccountRef?.value)===clean(accountIds.income_account)&&clean(item.ExpenseAccountRef?.value)===clean(accountIds.purchases_account));const disposition=verified.length===1?'link_verified_existing':candidates.length?'manual_review':'reviewed_item_creation';const prior=unlinkedItems.get(key)||{sourceId:line.productId,sku:line.sku,poIds:new Set(),disposition,qboCandidates:candidates.map(item=>({id:clean(item.Id),name:clean(item.Name),sku:clean(item.Sku),type:clean(item.Type),incomeAccountId:clean(item.IncomeAccountRef?.value),expenseAccountId:clean(item.ExpenseAccountRef?.value)}))};prior.poIds.add(group.poId);unlinkedItems.set(key,prior)}}
    const blocked=(reason,code)=>awaiting.push({...group,action:'blocked',code,reason});
    if(group.invalidReason){blocked(group.invalidReason,'invalid_source_group');continue}
    if(!group.vendor){blocked('Missing saved vendor','missing_vendor');continue}
    if(!group.date){blocked('Invalid or missing PO date','invalid_date');continue}
    if(!(group.total>0)){blocked('No positive purchase-order lines','zero_total');continue}
    if(!clean(accountIds[group.accountKey])){blocked(`Required QBO account ${group.accountKey} was not uniquely resolved`,'missing_account');continue}
    const resolved=resolveVendor(group,snapshot.portalVendors||[],qboVendors,links.vendorQBMap||{});if(resolved.error){blocked(resolved.error,resolved.code);continue}
    const qboVendorId=clean(resolved.vendor.Id),vendorEvidence={portalVendorId:resolved.portalVendorId||null,vendorMatchSource:resolved.matchSource},numbered=qboPurchaseOrders.filter(po=>clean(po.DocNumber)===group.poId);
    const exact=numbered.filter(po=>clean(po.VendorRef?.value)===qboVendorId&&clean(po.TxnDate).slice(0,10)===group.date&&Math.abs(money(po.TotalAmt)-group.total)<.005);
    if(numbered.length>1||(numbered.length===1&&exact.length!==1)){awaiting.push({...group,qboVendorId,...vendorEvidence,action:'conflict',code:'ambiguous_duplicate',reason:'QBO purchase-order number exists with a different vendor, date, or total',qboCandidates:numbered.map(po=>({id:clean(po.Id),vendorId:clean(po.VendorRef?.value),date:clean(po.TxnDate).slice(0,10),total:money(po.TotalAmt)}))});continue}
    awaiting.push({...group,qboVendorId,...vendorEvidence,action:exact.length?'ready_link_existing':'ready_create',code:exact.length?'exact_existing_match':'ready',qboId:clean(exact[0]?.Id)});
  }
  const groupedIds=new Set(groups.map(group=>group.poId));
  for(const [poId,qboIdRaw] of Object.entries(poMap)){if(groupedIds.has(poId))continue;const qboId=clean(qboIdRaw),qbo=qboPoById.get(qboId);linked.push({poId,qboId,total:money(qbo?.TotalAmt),sourceTotal:null,status:qbo?'linked':'missing_qbo_record',reason:qbo?'Source PO is no longer present; durable QBO link retained':'Durable PO link points to a missing QBO purchase order'})}
  const compactUnlinked=[...unlinkedItems.values()].map(row=>({...row,poIds:[...row.poIds].sort()}));
  return {groups,awaiting,excluded,linked,unlinkedItems:compactUnlinked,invalidItemLinks,awaitingSummary:actionSummary(awaiting),excludedSummary:actionSummary(excluded),linkedTotal:money(linked.reduce((sum,row)=>sum+row.total,0))};
}

const linkedTransactions=entity=>[
  ...((Array.isArray(entity?.LinkedTxn)?entity.LinkedTxn:[])),
  ...((entity?.Line||[]).flatMap(line=>Array.isArray(line?.LinkedTxn)?line.LinkedTxn:[])),
].filter(link=>link?.TxnId&&link?.TxnType).map(link=>({id:clean(link.TxnId),type:clean(link.TxnType)}));
const paymentPrintStatus=payment=>clean(payment?.CheckPayment?.PrintStatus||payment?.PrintStatus);

function analyzeBillPayments(qboBillPayments=[],qboBills=[],qboVendorCredits=[]) {
  const billIds=new Set([...qboBills,...qboVendorCredits].map(row=>clean(row.Id))),applications=[],missingApplications=[],historicalPrintQueue=[];
  for(const payment of qboBillPayments){
    const linked=linkedTransactions(payment).filter(link=>link.type==='Bill'||link.type==='VendorCredit');
    const missing=linked.filter(link=>!billIds.has(link.id));
    const row={qboPaymentId:clean(payment.Id),documentNumber:clean(payment.DocNumber),vendorId:clean(payment.VendorRef?.value),date:clean(payment.TxnDate).slice(0,10),total:money(payment.TotalAmt),printStatus:paymentPrintStatus(payment),applications:linked,missingApplications:missing};
    applications.push(row);if(missing.length)missingApplications.push(row);
    if(row.date&&row.date<'2026-09-09'&&row.printStatus==='NeedToPrint')historicalPrintQueue.push(row);
  }
  return {applications,missingApplications,historicalPrintQueue,missingTotal:sumMoney(missingApplications),historicalPrintTotal:sumMoney(historicalPrintQueue)};
}

const accountLineTotal=(entity,accountId)=>money((entity?.Line||[]).reduce((sum,line)=>sum+(clean(line?.AccountBasedExpenseLineDetail?.AccountRef?.value)===clean(accountId)?Number(line.Amount)||0:0),0));
function analyzeNativePOLinks({snapshot={},qboPurchaseOrders=[],qboBills=[],accountIds={}}={}) {
  const poById=new Map(qboPurchaseOrders.map(row=>[clean(row.Id),row])),billById=new Map(qboBills.map(row=>[clean(row.Id),row]));
  const billsByPOId=new Map();for(const bill of qboBills){for(const link of linkedTransactions(bill).filter(item=>item.type==='PurchaseOrder')){const rows=billsByPOId.get(link.id)||[];rows.push(clean(bill.Id));billsByPOId.set(link.id,rows)}}
  const poMap=snapshot.links?.qbPOMap||{},billMap=snapshot.links?.qbPOBillMap||{},results=[];
  for(const [portalPOId,qboPOIdRaw] of Object.entries(poMap)){
    const qboPOId=clean(qboPOIdRaw),po=poById.get(qboPOId);if(!po){results.push({portalPOId,qboPOId,status:'exception',reason:'Durable PO link points to a missing QBO purchase order'});continue}
    const billIds=new Set();const durableBillId=clean(billMap[portalPOId]);if(durableBillId)billIds.add(durableBillId);
    linkedTransactions(po).filter(link=>link.type==='Bill').forEach(link=>billIds.add(link.id));
    (billsByPOId.get(qboPOId)||[]).forEach(billId=>billIds.add(billId));
    if(!billIds.size)continue;
    if(billIds.size>1){results.push({portalPOId,qboPOId,status:'exception',reason:'More than one QBO bill references this purchase order',billIds:[...billIds]});continue}
    const billId=[...billIds][0],bill=billById.get(billId);if(!bill){results.push({portalPOId,qboPOId,billId,status:'exception',reason:'Durable/native bill link points to a missing QBO bill'});continue}
    const sameVendor=clean(po.VendorRef?.value)===clean(bill.VendorRef?.value),billHas=linkedTransactions(bill).some(link=>link.type==='PurchaseOrder'&&link.id===qboPOId),poHas=linkedTransactions(po).some(link=>link.type==='Bill'&&link.id===billId);
    const freight=accountLineTotal(bill,accountIds.freight_account),poTotal=money(po.TotalAmt),billTotal=money(bill.TotalAmt),reconciles=Math.abs(money(billTotal-freight)-poTotal)<.005;
    const durableOk=!durableBillId||durableBillId===billId,issues=[];if(!sameVendor)issues.push('vendor differs');if(!billHas||!poHas)issues.push('reciprocal QBO link missing');if(!reconciles)issues.push('bill total less explicit freight does not equal PO total');if(!durableOk)issues.push('durable PO-to-bill receipt differs');
    results.push({portalPOId,qboPOId,billId,billDocumentNumber:clean(bill.DocNumber),vendorId:clean(po.VendorRef?.value),poTotal,billTotal,freight,reconciles,sameVendor,reciprocalLink:billHas&&poHas,durableReceipt:durableBillId||null,status:issues.length?'exception':'verified',reason:issues.join('; ')});
  }
  return {results,verified:results.filter(row=>row.status==='verified'),exceptions:results.filter(row=>row.status==='exception')};
}

const apSnapshot=(bills,credits)=>({
  openBills:money((bills||[]).reduce((sum,row)=>sum+(Number(row.Balance)||0),0)),
  openVendorCredits:money((credits||[]).reduce((sum,row)=>sum+(Number(row.Balance)||0),0)),
  net:money((bills||[]).reduce((sum,row)=>sum+(Number(row.Balance)||0),0)-(credits||[]).reduce((sum,row)=>sum+(Number(row.Balance)||0),0)),
});
const sourceProjection=snapshot=>({ledger:snapshot.ledger||[],products:snapshot.products||[],salesOrders:(snapshot.salesOrders||[]).map(row=>({id:row.id,created_at:row.created_at,_doc_type:row._doc_type})),soItems:snapshot.soItems||[],poLines:snapshot.poLines||[],links:snapshot.links||{},parkedPurchaseOrderIds:snapshot.qbConfig?.parkedPurchaseOrderIds||[]});

async function runPayableReview({store,queryAll,realm,requestedBy,now=Date.now}) {
  if(!/^\d+$/.test(clean(realm)))throw new Error('invalid_realm');
  const id=randomUUID(); if(!await store.claim({id,realm_id:realm,company_key:'national',status:'running',requested_by:requestedBy}))return {status:'busy'};
  let stage='source_snapshot_before';
  try{
    const before=await store.snapshot(); if(!Array.isArray(before.ledger)||before.ledger.length>20000)throw new Error('snapshot_limit');
    stage='qbo_primary_reads';
    const [qboVendors,qboBills,qboVendorCredits,qboAccounts,qboPurchaseOrders,qboBillPayments,qboItems]=await Promise.all([
      queryAll('Vendor','Id, DisplayName, CompanyName, Active'),queryAll('Bill','*'),queryAll('VendorCredit','*'),
      queryAll('Account','Id, AcctNum, Name, FullyQualifiedName, AccountType, Active'),queryAll('PurchaseOrder','*'),queryAll('BillPayment','*'),queryAll('Item','*'),
    ]);
    stage='analysis';
    const specs={income_account:{number:'40000',types:['Income']},purchases_account:{number:'51300',types:['Cost of Goods Sold']},freight_account:{number:'51000',types:['Cost of Goods Sold']},outbound_freight_account:{number:'67000',types:['Expense']},sports_inc_fee_account:{number:'58000',types:['Cost of Goods Sold']},deco_account:{number:'52000',types:['Cost of Goods Sold']},decoration_account:{number:'55200',types:['Cost of Goods Sold']},in_house_art_account:{number:'55400',types:['Cost of Goods Sold']},inventory_asset_account:{number:'12000',types:['Other Current Asset']},cogs_account:{number:'50000',types:['Cost of Goods Sold']},ap_account:{number:'21100',types:['Accounts Payable']},operating_bank_account:{number:'10100',types:['Bank']}};
    const accountRows=Object.entries(specs).map(([key,spec])=>{const active=qboAccounts.filter(account=>account.Active!==false),expected=active.filter(account=>clean(account.AcctNum)===spec.number),configuredValue=clean(before.qbConfig?.mapping?.[key]||spec.number),configured=active.filter(account=>clean(account.AcctNum)===configuredValue||norm(account.Name)===norm(configuredValue)||norm(account.FullyQualifiedName)===norm(configuredValue));let reason='';if(expected.length!==1)reason=expected.length?'Expected account number is duplicated':'Expected account number is missing';else if(configured.length!==1)reason=configured.length?'Configured mapping is ambiguous':'Configured mapping does not resolve';else if(clean(configured[0].Id)!==clean(expected[0].Id))reason='Configured mapping resolves to a different account';else if(!accountTypeMatches(expected[0].AccountType,spec.types))reason=`Account type ${clean(expected[0].AccountType)||'(blank)'} is not ${spec.types.join(' or ')}`;return {key,number:spec.number,configured:configuredValue,id:reason?null:clean(expected[0].Id),reason}});
    const accountIds=Object.fromEntries(accountRows.map(row=>[row.key,row.id||''])),missingAccounts=accountRows.filter(row=>row.reason);
    const bills=analyzePayables({ledgerRows:before.ledger,portalVendors:before.portalVendors,vendorLinks:before.links?.vendorQBMap||{},qboVendors,qboBills,qboVendorCredits,accountIds});
    const purchaseOrders=analyzePurchaseOrders({snapshot:before,qboVendors,qboPurchaseOrders,qboItems,accountIds});
    const payments=analyzeBillPayments(qboBillPayments,qboBills,qboVendorCredits);
    const nativeLinks=analyzeNativePOLinks({snapshot:before,qboPurchaseOrders,qboBills,accountIds});
    const apBefore=apSnapshot(qboBills,qboVendorCredits);
    stage='source_snapshot_after';
    const after=await store.snapshot();
    stage='qbo_final_ap_reads';
    const [qboBillsAfter,qboVendorCreditsAfter]=await Promise.all([queryAll('Bill','Id, Balance'),queryAll('VendorCredit','Id, Balance')]);
    const apAfter=apSnapshot(qboBillsAfter,qboVendorCreditsAfter),sourceHash=fingerprint(sourceProjection(before)),sourceChanged=sourceHash!==fingerprint(sourceProjection(after));
    const compact=bills.rows.map(({ledgerId,documentNumber,vendor,date,total,transactionType,action,code,reason,qboBillId,qboVendorId,portalVendorId,vendorMatchSource,qboCandidates})=>({ledgerId,documentNumber,vendor,date,total,transactionType,action,code,reason,qboBillId,qboVendorId,portalVendorId,vendorMatchSource,qboCandidates}));
    const vendorRows=[...bills.rows,...purchaseOrders.awaiting],unlinkedVendorRows=vendorRows.filter(row=>['unlinked_vendor','ambiguous_portal_vendor','invalid_vendor_link'].includes(row.code));
    const unlinkedVendorGroups=new Map();for(const row of unlinkedVendorRows){const key=normalizeVendor(row.vendor)||'(blank)';const group=unlinkedVendorGroups.get(key)||{vendor:row.vendor,sourceIds:[],documents:[],transactionTypes:new Set(),reasons:new Set()};group.sourceIds.push(row.ledgerId||row.poId);group.documents.push(row.documentNumber||row.poId);group.transactionTypes.add(row.transactionType||'PurchaseOrder');group.reasons.add(row.reason);unlinkedVendorGroups.set(key,group)}
    const unlinkedVendors=[...unlinkedVendorGroups.values()].map(row=>({...row,transactionTypes:[...row.transactionTypes],reasons:[...row.reasons]}));
    const vendorSuggestionGroups=new Map();for(const row of vendorRows.filter(item=>item.vendorMatchSource==='unique_normalized_name'&&item.portalVendorId&&item.qboVendorId)){const key=row.portalVendorId+'|'+row.qboVendorId,prior=vendorSuggestionGroups.get(key)||{portalVendorId:row.portalVendorId,portalVendorName:row.vendor,qboVendorId:row.qboVendorId,documents:new Set()};prior.documents.add(row.documentNumber||row.poId);vendorSuggestionGroups.set(key,prior)}
    const vendorLinkSuggestions=[...vendorSuggestionGroups.values()].map(row=>({...row,documents:[...row.documents].filter(Boolean).sort()}));
    const billAwaiting=bills.rows.filter(row=>row.action==='ready'||row.action==='blocked'||row.action==='conflict');
    const exactMatches=bills.rows.filter(row=>row.action==='already_exists');
    const conflicts=bills.rows.filter(row=>row.action==='conflict'),poConflicts=purchaseOrders.awaiting.filter(row=>row.action==='conflict'),poExact=purchaseOrders.awaiting.filter(row=>row.action==='ready_link_existing');
    const linkedQboPOs=purchaseOrders.linked.filter(row=>row.status==='linked');
    const counts={
      portalPOsAwaitingAction:purchaseOrders.awaiting.length,existingLinkedQboPOs:linkedQboPOs.length,historicalOrParkedPOsExcluded:purchaseOrders.excluded.length,
      billsAndCreditsAwaitingAction:billAwaiting.length,exactExistingMatches:exactMatches.length,purchaseOrderExactExistingMatches:poExact.length,ambiguousDuplicates:conflicts.length+poConflicts.length,ambiguousPayableDuplicates:conflicts.length,ambiguousPurchaseOrderDuplicates:poConflicts.length,
      unlinkedVendors:unlinkedVendors.length+vendorLinkSuggestions.length,unresolvedVendors:unlinkedVendors.length,vendorLinkSuggestions:vendorLinkSuggestions.length,unlinkedItems:purchaseOrders.unlinkedItems.length,invalidDurableItemLinks:purchaseOrders.invalidItemLinks.length,
      missingAccountMappings:missingAccounts.length,paymentsMissingUnderlyingBills:payments.missingApplications.length,historicalPaymentsQueuedForPrinting:payments.historicalPrintQueue.length,
      nativePOLinksVerified:nativeLinks.verified.length,nativePOLinkExceptions:nativeLinks.exceptions.length,
    };
    const totals={portalPOsAwaitingAction:sumMoney(purchaseOrders.awaiting),existingLinkedQboPOs:purchaseOrders.linkedTotal,billsAndCreditsAwaitingAction:sumMoney(billAwaiting),exactExistingMatches:sumMoney(exactMatches),purchaseOrderExactExistingMatches:sumMoney(poExact),ambiguousDuplicates:money(sumMoney(conflicts)+sumMoney(poConflicts)),ambiguousPayableDuplicates:sumMoney(conflicts),ambiguousPurchaseOrderDuplicates:sumMoney(poConflicts),paymentsMissingUnderlyingBills:payments.missingTotal,historicalPaymentsQueuedForPrinting:payments.historicalPrintTotal};
    const report={mode:'read_only',source:'portal_payables_and_live_qbo',reviewedAt:new Date(now()).toISOString(),sourceHash,sourceChanged,population:before.ledger.length,
      populations:{billLedger:before.ledger.length,portalPurchaseOrders:purchaseOrders.groups.length,qboVendors:qboVendors.length,qboBills:qboBills.length,qboVendorCredits:qboVendorCredits.length,qboBillPayments:qboBillPayments.length,qboPurchaseOrders:qboPurchaseOrders.length,qboItems:qboItems.length},
      counts,totals,billCounts:bills.counts,billTotals:bills.totals,results:compact,
      purchaseOrders:{counts:purchaseOrders.awaitingSummary.counts,totals:purchaseOrders.awaitingSummary.totals,excludedCounts:purchaseOrders.excludedSummary.counts,excludedTotals:purchaseOrders.excludedSummary.totals,awaiting:purchaseOrders.awaiting.map(({poId,vendor,date,total,action,code,reason,qboId,qboVendorId,portalVendorId,vendorMatchSource,qboCandidates,lines})=>({poId,vendor,date,total,action,code,reason,qboId,qboVendorId,portalVendorId,vendorMatchSource,qboCandidates,sourceLineIds:(lines||[]).map(line=>line.sourceLineId)})),excluded:purchaseOrders.excluded.map(({poId,total,action,reason})=>({poId,total,action,reason})),linked:purchaseOrders.linked,unlinkedItems:purchaseOrders.unlinkedItems,invalidItemLinks:purchaseOrders.invalidItemLinks},
      unlinkedVendors,vendorLinkSuggestions,missingAccounts,
      payments:{missingApplications:payments.missingApplications,historicalPrintQueue:payments.historicalPrintQueue},nativePOLinks:{verified:nativeLinks.verified,exceptions:nativeLinks.exceptions},
      accounts:Object.fromEntries(accountRows.map(row=>[row.key,{number:row.number,configured:row.configured,id:row.id,reason:row.reason||null}])),ap:{before:apBefore,after:apAfter,delta:money(apAfter.net-apBefore.net),changedDuringReview:Math.abs(apAfter.net-apBefore.net)>=.005},
      safeguards:{qboWrites:0,portalWrites:0,inventoryQuantitiesPosted:false,vendorCreation:false,itemCreation:false,billCreditCreation:false,recurringAutomationEnabled:false,historicalPurchaseOrdersProposed:0},
    };
    const hasBlockedPO=purchaseOrders.awaiting.some(row=>['blocked','conflict'].includes(row.action));
    const cleanRun=!sourceChanged&&!bills.counts.blocked&&!bills.counts.conflict&&!hasBlockedPO&&!counts.unlinkedItems&&!counts.invalidDurableItemLinks&&!counts.missingAccountMappings&&!counts.paymentsMissingUnderlyingBills&&!counts.historicalPaymentsQueuedForPrinting&&!counts.nativePOLinkExceptions&&!report.ap.changedDuringReview;
    const status=cleanRun?'complete':'needs_review';stage='persist_report';await store.finish(id,{status,report,finished_at:new Date(now()).toISOString()}); return {id,status,report};
  }catch(error){await store.finish(id,{status:'failed',finished_at:new Date(now()).toISOString(),error_code:failureCode(stage,error)});throw new Error('QBO payable review failed; inspect run '+id)}
}

module.exports={analyzeBillPayments,analyzeNativePOLinks,analyzePayables,analyzePurchaseOrders,apSnapshot,buildPortalPOGroups,buildRows,failureCode,fingerprint,runPayableReview};
