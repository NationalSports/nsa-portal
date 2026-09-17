const { createHash, randomUUID } = require('crypto');

const clean = value => String(value == null ? '' : value).trim();
const money = value => Math.round((Number(value) || 0) * 100) / 100;
const norm = value => clean(value).toLowerCase();
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
  if(portals.length>1)return {error:`Multiple active portal vendors match "${row.vendor}"`};
  const saved=portals[0]&&clean(vendorLinks[portals[0].id]);
  if(saved){const hits=qboVendors.filter(v=>v?.Active!==false&&clean(v.Id)===saved);if(hits.length===1)return {vendor:hits[0]}}
  const hits=qboVendors.filter(v=>v?.Active!==false&&[v.DisplayName,v.CompanyName].some(name=>normalizeVendor(name)===key));
  return hits.length===1?{vendor:hits[0]}:{error:`Vendor "${row.vendor}" is not linked or uniquely present in QBO`};
}

function analyzePayables({ledgerRows=[],portalVendors=[],vendorLinks={},qboVendors=[],qboBills=[],qboVendorCredits=[],accountIds={}}={}) {
  const required=['purchases_account','freight_account','sports_inc_fee_account','deco_account'];
  const accountError=required.find(key=>!clean(accountIds[key]));
  const payables=[...qboBills.map(x=>({...x,_type:'Bill'})),...qboVendorCredits.map(x=>({...x,_type:'VendorCredit'}))];
  const rows=buildRows(ledgerRows).map(row=>{
    const blocked=reason=>({...row,action:'blocked',reason});
    if(!row.ledgerId)return blocked('Bill ledger row is missing its immutable ID');
    if(!row.documentNumber)return blocked('Vendor document number is missing');
    if(!row.vendor)return blocked('Canonical portal vendor is missing');
    if(!row.date)return blocked('Bill date is missing or invalid');
    if(!(Math.abs(row.total)>0))return blocked(`${row.transactionType} total must be non-zero`);
    const resolved=resolveVendor(row,portalVendors,qboVendors,vendorLinks);if(resolved.error)return blocked(resolved.error);
    if(!row.isCredit&&accountError)return blocked(`Required QBO account ${accountError} was not uniquely resolved`);
    const qboVendorId=clean(resolved.vendor.Id), numbered=payables.filter(x=>norm(x.DocNumber)===norm(row.documentNumber));
    const exact=numbered.filter(x=>x._type===row.transactionType&&clean(x.VendorRef?.value)===qboVendorId&&Math.abs(money(x.TotalAmt)-Math.abs(row.total))<.005&&clean(x.TxnDate).slice(0,10)===row.date);
    if(numbered.length>1||(numbered.length===1&&exact.length!==1))return {...row,qboVendorId,action:'conflict',reason:`QBO document ${row.documentNumber} exists with a different vendor, date, total, or type`,qboCandidates:numbered.map(x=>({id:clean(x.Id),type:x._type,vendorId:clean(x.VendorRef?.value),date:clean(x.TxnDate).slice(0,10),total:money(x.TotalAmt)}))};
    if(exact.length===1)return {...row,qboVendorId,action:'already_exists',reason:`Exact QBO ${row.transactionType} #${exact[0].Id}`,qboBillId:clean(exact[0].Id)};
    if(row.isCredit)return blocked('Vendor credit creation is not enabled; no exact QBO VendorCredit was found');
    const merchandise=money(row.total-row.freight-row.sportsFee);
    if(row.freight<0||row.sportsFee<0||row.total<=0||merchandise<=0)return blocked('Approved account lines do not produce a positive, fully categorized bill total');
    return {...row,qboVendorId,action:'ready',reason:''};
  });
  const counts=rows.reduce((out,row)=>(out[row.action]=(out[row.action]||0)+1,out),{});
  return {rows,counts};
}

async function runPayableReview({store,queryAll,realm,requestedBy,now=Date.now}) {
  if(!/^\d+$/.test(clean(realm)))throw new Error('invalid_realm');
  const id=randomUUID(); if(!await store.claim({id,realm_id:realm,company_key:'national',status:'running',requested_by:requestedBy}))return {status:'busy'};
  try{
    const before=await store.snapshot(); if(!Array.isArray(before.ledger)||before.ledger.length>20000)throw new Error('snapshot_limit');
    const [qboVendors,qboBills,qboVendorCredits,qboAccounts]=await Promise.all([
      queryAll('Vendor','Id, DisplayName, CompanyName, Active'),queryAll('Bill','Id, DocNumber, VendorRef, TotalAmt, TxnDate, Balance'),
      queryAll('VendorCredit','Id, DocNumber, VendorRef, TotalAmt, TxnDate, Balance'),queryAll('Account','Id, AcctNum, Name, AccountType, Active'),
    ]);
    const specs={purchases_account:'51300',freight_account:'51000',sports_inc_fee_account:'58000',deco_account:'52000'};
    const accountIds=Object.fromEntries(Object.entries(specs).map(([key,num])=>{const hits=qboAccounts.filter(a=>a.Active!==false&&clean(a.AcctNum)===num);return [key,hits.length===1?clean(hits[0].Id):'']}));
    const analysis=analyzePayables({ledgerRows:before.ledger,portalVendors:before.portalVendors,vendorLinks:before.vendorLinks,qboVendors,qboBills,qboVendorCredits,accountIds});
    const after=await store.snapshot(); const sourceHash=fingerprint(before.ledger),sourceChanged=sourceHash!==fingerprint(after.ledger);
    const compact=analysis.rows.map(({ledgerId,documentNumber,vendor,date,total,transactionType,action,reason,qboBillId,qboVendorId,qboCandidates})=>({ledgerId,documentNumber,vendor,date,total,transactionType,action,reason,qboBillId,qboVendorId,qboCandidates}));
    const report={mode:'read_only',source:'applied_bills_and_live_qbo',reviewedAt:new Date(now()).toISOString(),sourceHash,sourceChanged,population:before.ledger.length,counts:analysis.counts,results:compact};
    const cleanRun=!sourceChanged&&!analysis.counts.blocked&&!analysis.counts.conflict;
    const status=cleanRun?'complete':'needs_review'; await store.finish(id,{status,report,finished_at:new Date(now()).toISOString()}); return {id,status,report};
  }catch(error){await store.finish(id,{status:'failed',finished_at:new Date(now()).toISOString(),error_code:'payable_review_failed'});throw new Error('QBO payable review failed; inspect run '+id)}
}

module.exports={analyzePayables,buildRows,fingerprint,runPayableReview};
