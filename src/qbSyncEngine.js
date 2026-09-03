// QuickBooks sync engine — the seven sync routines, extracted verbatim from QBPage
// so the App-level auto-sync interval can build and run them from CURRENT state at
// fire time. The old wiring called a ref that only a mounted QBPage assigned, so
// auto-sync silently did nothing until the page was visited that session — and after
// leaving the page it synced the stale snapshot captured at the last render. QBPage
// builds this same engine for its buttons: one copy of the logic, two callers.
import { D_V } from './constants';
import { _dbSaveSO } from './lib/dbEngine';
import { safeArt, safeDecos, safeItems, safeNum, safeSizes } from './safeHelpers';
import { calculateCustomerShipping, loadAllQBEntities, loadQBAccounts, parseQBDateValue, queryQBReadOnly, resolveQBAccountRefs } from './qbAccountMappings';

// Return a circular batch and the cursor for the next run. Permanent blockers
// in the first N records must not starve every later customer/invoice/item/PO.
export function rotatingBatch(items = [], offset = 0, size = 20) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length || !(size > 0)) return { items: [], nextOffset: 0 };
  const rawOffset = Number.isFinite(Number(offset)) ? Math.floor(Number(offset)) : 0;
  const start = ((rawOffset % list.length) + list.length) % list.length;
  const count = Math.min(Math.floor(size), list.length);
  const batch = [...list.slice(start), ...list.slice(0, start)].slice(0, count);
  return { items: batch, nextOffset: (start + count) % list.length };
}

const normalizeQBCustomerName = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

export function portalCustomerDisplayName(customer = {}) {
  const name = String(customer.name || '').trim();
  const alpha = String(customer.alpha_tag || '').trim();
  return name + (alpha ? ' (' + alpha + ')' : '');
}

const normalizeQBTermName = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

export function portalCustomerTermSpec(paymentTerms) {
  const value = normalizeQBTermName(paymentTerms || 'net30');
  if (value === 'prepay' || value === 'prepaid' || value === 'dueonreceipt') {
    return { portalValue: 'prepay', label: 'Due on receipt', dueDays: 0, names: ['dueonreceipt', 'prepay', 'prepaid'] };
  }
  if (!/^net\d+$/.test(value)) throw new Error(`Unsupported portal customer term "${paymentTerms}"; no customer was changed.`);
  const days = Number(value.slice(3));
  return { portalValue: 'net' + days, label: 'Net ' + days, dueDays: days, names: ['net' + days] };
}

// Resolve portal terms only against existing active QBO terms. We never create
// or guess a financial term: an ambiguous or missing mapping blocks the write.
export function resolveQBCustomerTerm(terms = [], paymentTerms) {
  const spec = portalCustomerTermSpec(paymentTerms);
  const active = (terms || []).filter(term => term && term.Active !== false && term.Id);
  const nameMatches = active.filter(term => spec.names.includes(normalizeQBTermName(term.Name)));
  const matches = nameMatches.length ? nameMatches : active.filter(term =>
    Number(term.DueDays) === spec.dueDays && normalizeQBTermName(term.Type || 'standard') === 'standard'
  );
  if (matches.length !== 1) {
    const reason = matches.length > 1 ? 'is ambiguous' : 'was not found';
    throw new Error(`QBO customer term "${spec.label}" ${reason}; no customer was changed.`);
  }
  return { value: String(matches[0].Id), name: String(matches[0].Name || spec.label) };
}

// Exact means case/spacing-insensitive only. Punctuation and words must still
// match, so a canary never guesses between similarly named schools or teams.
export function findExactQBCustomerMatches(customer, qboCustomers = []) {
  const portalName = normalizeQBCustomerName(customer?.name);
  const portalDisplayName = normalizeQBCustomerName(portalCustomerDisplayName(customer));
  const matches = (qboCustomers || []).filter(qbo => {
    if (!qbo || qbo.Active === false) return false;
    const displayName = normalizeQBCustomerName(qbo.DisplayName);
    const companyName = normalizeQBCustomerName(qbo.CompanyName);
    return (displayName && (displayName === portalDisplayName || displayName === portalName)) ||
      (companyName && companyName === portalName);
  });
  return [...new Map(matches.map(match => [String(match.Id), match])).values()];
}

// One portal PO can span several SO item rows. Group those rows before both UI
// preview and QBO posting so the operator sees the same one-PO payload the API
// will receive. Mixed vendors or mixed merchandise/decoration categories under
// one document number are unsafe and must block instead of inheriting the first
// line's routing.
export function groupPortalPurchaseOrders(sos = [], poMap = {}) {
  const groups = new Map();
  (sos || []).forEach(so => safeItems(so).forEach(it => (it.po_lines || []).forEach(pl => {
    if (!pl?.po_id || poMap[pl.po_id]) return;
    // The saved PO line is the accounting source of truth for who received the
    // order. A product's catalog vendor or brand can change later and must not
    // silently reroute an existing PO in QBO.
    const vendor = pl.vendor || pl.deco_vendor || D_V.find(v => v.id === it.vendor_id)?.name || it.brand || '';
    const accountKey = pl.po_type === 'outside_deco' ? 'deco_account' : 'purchases_account';
    let group = groups.get(pl.po_id);
    if (!group) {
      group = { poId: pl.po_id, entries: [], vendor, created_at: pl.created_at, accountKey, invalidReason: '' };
      groups.set(pl.po_id, group);
    }
    if (String(group.vendor || '') !== String(vendor || '')) group.invalidReason = 'mixed vendors share this PO number';
    if (group.accountKey !== accountKey) group.invalidReason = 'merchandise and outside-decoration lines share this PO number';
    group.entries.push({ pl, so, it });
  })));
  return [...groups.values()];
}

export function buildQBInvoicePostingLines({ invoice, salesItemId, discountAccountRef, description }) {
  const cents = value => Math.round(safeNum(value) * 100) / 100;
  const total = cents(invoice?.total);
  const discount = cents(invoice?.credit_amount);
  if (!(total > 0)) throw new Error('Invoice total must be positive.');
  if (discount < 0) throw new Error('Invoice discount cannot be negative.');
  if (!salesItemId) throw new Error('QBO sales item is required.');
  if (discount > 0 && !discountAccountRef?.value) throw new Error('40200 Discounts account is required.');
  const grossSales = cents(total + discount);
  const lines = [{
    DetailType:'SalesItemLineDetail', Amount:grossSales, Description:description,
    SalesItemLineDetail:{Qty:1,UnitPrice:grossSales,ItemRef:{value:String(salesItemId),name:'NSA Portal Sales'}},
  }];
  if (discount > 0) lines.push({
    DetailType:'DiscountLineDetail', Amount:discount, Description:'Customer discount / credit — 40200',
    DiscountLineDetail:{PercentBased:false,DiscountAccountRef:discountAccountRef},
  });
  return lines;
}

// ctx: every piece of app state/setters the routines touch, plus qbApi/nf/dP —
// passed fresh by the caller (QBPage per render; App per interval fire).
export function createQBSyncEngine(ctx){
  const {cust,sos,invs,prod,vend,invAdjLog=[],invPOs,submittedBatches,qbApi,qbConfig,nf,dP,
    setQBConfig,setQbSyncing,setInvs,setInvPOs,setSOs,setSubmittedBatches,setVend}=ctx;
    const QB_SYNC_BATCH_SIZE=20;
    const productionSyncLocked=()=>{
      if(qbConfig.initialMigrationApproved===true)return false;
      nf('Initial QBO migration is locked — complete the read-only preflight and reviewed bill canaries first','error');
      return true;
    };
    const canaryPreflightReady=()=>{
      const ready=qbConfig.preflight?.status==='success'&&String(qbConfig.preflight?.realm_id||'')===String(qbConfig.realm_id||'');
      if(!ready)nf('Run the read-only live QBO preflight before any one-record test','error');
      return ready;
    };
    let accountCache=null;
    const requiredAccountRefs=async(keys)=>{
      if(!accountCache)accountCache=await loadQBAccounts(qbApi);
      const refs=resolveQBAccountRefs(accountCache,qbConfig.mapping,keys);
      // accountNumber is portal-only verification metadata. QBO ReferenceType
      // write payloads accept the entity ID, but reject unknown properties such
      // as accountNumber with validation fault 2010.
      return Object.fromEntries(Object.entries(refs).map(([key,ref])=>[
        key,{value:String(ref.value)},
      ]));
    };
    // Invoices/estimates must carry an ItemRef for their income account to be
    // deterministic. This service item is the controlled fallback when a portal
    // product does not yet have its own QBO item.
    const ensurePortalSalesItem=async(incomeAccountRef)=>{
      const name='NSA Portal Sales';
      const qRes=await queryQBReadOnly(qbApi,"SELECT * FROM Item WHERE Name = 'NSA Portal Sales' MAXRESULTS 1",'portal sales item query');
      const existing=qRes?.QueryResponse?.Item?.[0];
      if(existing?.Id&&String(existing.IncomeAccountRef?.value||'')===String(incomeAccountRef.value))return String(existing.Id);
      const item=existing?.Id
        ?{Id:existing.Id,SyncToken:existing.SyncToken,sparse:true,Name:name,IncomeAccountRef:incomeAccountRef}
        :{Name:name,Type:'Service',Description:'Portal sales and customer-billed shipping — 40000 Sales',IncomeAccountRef:incomeAccountRef};
      const res=await qbApi('upsert_item',{item});
      if(!res?.Item?.Id)throw new Error(res?.Fault?.Error?.[0]?.Detail||'Could not create or update the NSA Portal Sales item');
      return String(res.Item.Id);
    };
    const requireExistingPortalSalesItem=async(incomeAccountRef)=>{
      const qRes=await queryQBReadOnly(qbApi,"SELECT * FROM Item WHERE Name = 'NSA Portal Sales' MAXRESULTS 2",'portal sales item query');
      const matches=qRes?.QueryResponse?.Item||[];
      if(matches.length!==1)throw new Error(matches.length?'Multiple QBO items are named NSA Portal Sales; no record was sent.':'QBO item "NSA Portal Sales" is missing; open QBO Items and run Test NSA Portal Sales Item first.');
      const item=matches[0];
      if(item.Active===false||String(item.IncomeAccountRef?.value||'')!==String(incomeAccountRef.value))throw new Error('QBO item "NSA Portal Sales" is inactive or not mapped to 40000 Sales; no record was sent.');
      return String(item.Id);
    };
    const verifyCanaryReadback=async(entity,id,expected={})=>{
      const res=await queryQBReadOnly(qbApi,"SELECT * FROM "+entity+" WHERE Id = '"+String(id).replace(/'/g,"\\'")+"' MAXRESULTS 1",entity+' API read-back');
      const row=res?.QueryResponse?.[entity]?.[0];
      if(!row||String(row.Id)!==String(id))throw new Error(entity+' was not returned by API read-back.');
      if(expected.docNumber!=null&&String(row.DocNumber||'')!==String(expected.docNumber))throw new Error(entity+' document number did not match on API read-back.');
      if(expected.refValue!=null&&String(row[expected.refField]?.value||'')!==String(expected.refValue))throw new Error(entity+' customer/vendor did not match on API read-back.');
      if(expected.total!=null&&Math.abs(safeNum(row.TotalAmt)-safeNum(expected.total))>=0.005)throw new Error(entity+' total did not match on API read-back.');
      if(expected.sku!=null&&String(row.Sku||'').trim().toUpperCase()!==String(expected.sku).trim().toUpperCase())throw new Error(entity+' SKU did not match on API read-back.');
      return row;
    };

    const syncPortalSalesItemCanary=async()=>{
      if(!canaryPreflightReady())return{status:'blocked'};
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'portal_sales_item_canary',status:'success',details:[]};
      try{
        const refs=await requiredAccountRefs(['income_account']);
        const incomeAccountRef=refs.income_account;
        const query="SELECT * FROM Item WHERE Name = 'NSA Portal Sales' MAXRESULTS 2";
        const qRes=await queryQBReadOnly(qbApi,query,'portal sales item canary query');
        const matches=qRes?.QueryResponse?.Item||[];
        if(matches.length>1)throw new Error('Multiple QBO items are named NSA Portal Sales; no item was changed.');
        const existing=matches[0];
        const existingType=String(existing?.Type||'').toLowerCase();
        if(existing&&existingType!=='service'&&existingType!=='noninventory'){
          throw new Error('Existing QBO item "NSA Portal Sales" has type '+(existing.Type||'unknown')+'; no item was changed.');
        }
        const alreadyReady=existing?.Id&&existing.Active!==false
          &&String(existing.IncomeAccountRef?.value||'')===String(incomeAccountRef.value);
        let itemId=existing?.Id;
        if(!alreadyReady){
          const item=existing?.Id
            ?{Id:existing.Id,SyncToken:existing.SyncToken,sparse:true,Name:'NSA Portal Sales',Active:true,IncomeAccountRef:incomeAccountRef}
            :{Name:'NSA Portal Sales',Type:'Service',Description:'Portal sales and customer-billed shipping — 40000 Sales',IncomeAccountRef:incomeAccountRef};
          const res=await qbApi('upsert_item',{item});
          if(!res?.Item?.Id)throw new Error(res?.Fault?.Error?.[0]?.Detail||'Could not create or repair the NSA Portal Sales item');
          itemId=String(res.Item.Id);
          log.details.push((existing?'REPAIRED':'CREATED')+' ONE QBO ITEM: NSA Portal Sales → QBO Item #'+itemId);
        }else{
          log.details.push('FOUND ONE READY QBO ITEM: NSA Portal Sales → QBO Item #'+itemId);
        }
        const verified=await verifyCanaryReadback('Item',itemId);
        const verifiedType=String(verified.Type||'').toLowerCase();
        if(String(verified.Name||'')!=='NSA Portal Sales')throw new Error('QBO item name did not match on API read-back.');
        if(verified.Active===false)throw new Error('QBO item was inactive on API read-back.');
        if(verifiedType!=='service'&&verifiedType!=='noninventory')throw new Error('QBO item type was not Service or NonInventory on API read-back.');
        if(String(verified.IncomeAccountRef?.value||'')!==String(incomeAccountRef.value))throw new Error('QBO item was not mapped to 40000 Sales on API read-back.');
        log.details.push('READ-BACK VERIFIED: NSA Portal Sales · QBO Item #'+itemId+' · '+verified.Type+' · 40000 Sales');
        setQBConfig(prev=>({...prev,_portalSalesItemId:itemId,syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
        nf('Verified NSA Portal Sales in QBO','success');
        setQbSyncing(false);
        return{status:'success',itemId};
      }catch(e){
        log.status='error';log.details.push(e.message||'NSA Portal Sales item test failed');
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));
        nf('NSA Portal Sales test blocked — '+(e.message||'QBO item setup error'),'error');
        setQbSyncing(false);
        return{status:'blocked'};
      }
    };

    const buildQBCustomerPayload=(c,{qbId='',syncToken='',termRef}={})=>{
      const custSOs=sos.filter(s=>s.customer_id===c.id);
      const totalRevenue=invs.filter(i=>i.customer_id===c.id).reduce((a,i)=>a+(i.total??0),0);
      const totalPaid=invs.filter(i=>i.customer_id===c.id).reduce((a,i)=>a+(i.paid??0),0);
      const openBalance=totalRevenue-totalPaid;
      return{
        DisplayName:portalCustomerDisplayName(c),
        CompanyName:String(c.name||'').trim(),
        ...((()=>{const raw=String(c.contact_email||c.contacts?.[0]?.email||'').trim();return raw&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)?{PrimaryEmailAddr:{Address:raw}}:{}})()),
        ...((()=>{const raw=String(c.contact_phone||c.contacts?.[0]?.phone||'').trim();return raw?{PrimaryPhone:{FreeFormNumber:raw}}:{}})()),
        ...(c.billing_address_line1?{BillAddr:{Line1:c.billing_address_line1,City:c.billing_city||'',CountrySubDivisionCode:c.billing_state||'',PostalCode:c.billing_zip||''}}:{}),
        ...(c.shipping_address_line1?{ShipAddr:{Line1:c.shipping_address_line1,City:c.shipping_city||'',CountrySubDivisionCode:c.shipping_state||'',PostalCode:c.shipping_zip||''}}:{}),
        Notes:'Portal: '+custSOs.length+' orders, $'+totalRevenue.toFixed(0)+' revenue, $'+openBalance.toFixed(0)+' open balance. Tier: '+(c.adidas_ua_tier||'B')+'. Terms: '+(c.payment_terms||'net30'),
        ...(termRef?.value?{SalesTermRef:termRef}:{}),
        ...(qbId?{Id:qbId,sparse:true}:{}),
        ...(syncToken?{SyncToken:syncToken}:{}),
      };
    };

    // One-customer canary is intentionally available while production batches
    // are locked. A create or a repair of the actual QBO Terms field requires a
    // second, explicit operator confirmation and a successful API read-back.
    const syncCustomerCanary=async(customerId,{allowCreate=false,allowTermUpdate=false}={})=>{
      const c=cust.find(customer=>String(customer.id)===String(customerId));
      if(!c||c.is_active===false||c.deleted_at){nf('Choose an active customer for the QBO test','error');return{status:'blocked'}}
      if(qbConfig.preflight?.status!=='success'||String(qbConfig.preflight?.realm_id||'')!==String(qbConfig.realm_id||'')){
        nf('Run the read-only live QBO preflight before testing a customer','error');return{status:'blocked'};
      }
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'customer_canary',status:'success',details:[]};
      try{
        const qboTerms=await loadAllQBEntities(qbApi,'Term','Id, Name, Active, Type, DueDays',1000);
        const termRef=resolveQBCustomerTerm(qboTerms,c.payment_terms);
        const qboCustomers=await loadAllQBEntities(qbApi,'Customer','Id, DisplayName, CompanyName, Active, SyncToken, SalesTermRef',1000);
        const savedId=String((qbConfig.custQBMap||{})[c.id]||c.qb_customer_id||'');
        let qboCustomer=savedId?qboCustomers.find(row=>String(row.Id)===savedId):null;
        if(qboCustomer?.Active===false)throw new Error('Saved QBO customer #'+savedId+' is inactive; no record was changed.');
        if(!qboCustomer){
          const matches=findExactQBCustomerMatches(c,qboCustomers);
          if(matches.length>1)throw new Error('Multiple active QBO customers exactly match "'+c.name+'"; no record was changed.');
          qboCustomer=matches[0]||null;
        }
        let created=false;
        let termsUpdated=false;
        if(!qboCustomer){
          if(!allowCreate)return{status:'needs_confirmation',customerId:c.id,customerName:c.name};
          const response=await qbApi('upsert_customer',{customer:buildQBCustomerPayload(c,{termRef})});
          const fault=response?.Fault?.Error?.[0];
          if(!response?.Customer?.Id)throw new Error(fault?.Detail||fault?.Message||'QuickBooks did not return the new customer.');
          qboCustomer=response.Customer;created=true;
        }else if(String(qboCustomer.SalesTermRef?.value||'')!==String(termRef.value)){
          if(!allowTermUpdate)return{status:'needs_term_confirmation',customerId:c.id,customerName:c.name,qbId:String(qboCustomer.Id||''),currentTerm:qboCustomer.SalesTermRef?.name||'none',desiredTerm:termRef.name};
          const response=await qbApi('upsert_customer',{customer:{Id:String(qboCustomer.Id),SyncToken:String(qboCustomer.SyncToken||'0'),sparse:true,SalesTermRef:termRef}});
          const fault=response?.Fault?.Error?.[0];
          if(!response?.Customer?.Id)throw new Error(fault?.Detail||fault?.Message||'QuickBooks did not update the customer terms.');
          qboCustomer=response.Customer;termsUpdated=true;
        }
        const qbId=String(qboCustomer.Id||'');
        if(!/^\d+$/.test(qbId))throw new Error('QuickBooks returned an invalid customer ID; the portal link was not saved.');
        const readback=await queryQBReadOnly(qbApi,"SELECT * FROM Customer WHERE Id = '"+qbId+"' MAXRESULTS 1",'customer API read-back');
        const verified=readback?.QueryResponse?.Customer?.[0];
        if(!verified||String(verified.Id)!==qbId)throw new Error('Customer was not returned by the QBO read-back; the portal link was not saved.');
        if(String(verified.SalesTermRef?.value||'')!==String(termRef.value))throw new Error('QBO customer terms did not match "'+termRef.name+'" on read-back; the portal link was not saved.');
        log.details.push((created?'CREATED ONE QBO CUSTOMER':termsUpdated?'UPDATED ONE QBO CUSTOMER':'LINK ONLY — no QBO customer was changed')+': '+c.name+' → QB #'+qbId);
        if(termsUpdated)log.details.push('UPDATED ONE QBO CUSTOMER TERM: '+(termRef.name||termRef.value));
        log.details.push('READ-BACK VERIFIED: '+(verified.DisplayName||verified.CompanyName||c.name)+(verified.SalesTermRef?.name?' · QBO terms '+verified.SalesTermRef.name:verified.SalesTermRef?.value?' · QBO terms ID '+verified.SalesTermRef.value:''));
        setQBConfig(prev=>({...prev,custQBMap:{...(prev.custQBMap||{}),[c.id]:qbId},syncLog:[log,...(prev.syncLog||[])].slice(0,100),lastSync:new Date().toLocaleString()}));
        nf((created?'Created and verified ':termsUpdated?'Updated terms and verified ':'Linked and verified ')+c.name+' in QBO');
        return{status:'success',created,termsUpdated,qbId,customerName:c.name};
      }catch(e){
        log.status='error';log.details.push(e.message||'Customer canary failed');
        setQBConfig(prev=>({...prev,syncLog:[log,...(prev.syncLog||[])].slice(0,100)}));
        nf('Customer test stopped — '+(e.message||'unknown error'),'error');
        return{status:'blocked',error:e.message};
      }finally{setQbSyncing(false)}
    };

    // ── SYNC: Customers (name + totals) ──
    const syncCustomers=async()=>{
      if(productionSyncLocked())return{};
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'customers',status:'success',details:[]};
      let synced=0;
      const custQBMap={};// localId -> qbCustomerId (returned for downstream syncs)
      // Fetch existing QB customers to match by name and avoid duplicates
      let existingQBCusts=[];
      let qboTerms=[];
      try{
        qboTerms=await loadAllQBEntities(qbApi,'Term','Id, Name, Active, Type, DueDays',1000);
        existingQBCusts=await loadAllQBEntities(qbApi,'Customer','Id, DisplayName, CompanyName, SyncToken',1000);
      }catch(e){
        log.status='error';log.details.push('Customer duplicate preflight failed: '+e.message);
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Customer sync blocked — QBO duplicate preflight failed','error');setQbSyncing(false);return{};
      }
      const activeCustomers=cust.filter(c=>c.is_active!==false&&!c.deleted_at);
      const sortedCustomers=[...activeCustomers].sort((a,b)=>{
        const aLinked=!!(a.qb_customer_id||(qbConfig.custQBMap||{})[a.id]);
        const bLinked=!!(b.qb_customer_id||(qbConfig.custQBMap||{})[b.id]);
        return Number(aLinked)-Number(bLinked);
      });
      const customerBatch=rotatingBatch(sortedCustomers,qbConfig._customerSyncOffset,QB_SYNC_BATCH_SIZE);
      const customersToSync=customerBatch.items;
      for(const c of customersToSync){
        const displayName=portalCustomerDisplayName(c);
        let termRef;
        try{termRef=resolveQBCustomerTerm(qboTerms,c.payment_terms)}catch(e){log.details.push(c.name+' — BLOCKED: '+e.message);log.status='partial';continue}
        // Match existing QB customer by name if we don't already have a QB ID
        let qbId=c.qb_customer_id||(qbConfig.custQBMap||{})[c.id];let syncToken=null;
        if(!qbId){
          const matches=existingQBCusts.filter(q=>q.DisplayName===displayName||q.CompanyName===c.name||q.DisplayName===c.name);
          if(matches.length>1){log.details.push(c.name+' — BLOCKED: multiple QBO customers match this name');log.status='partial';continue}
          const match=matches[0];if(match){qbId=match.Id;syncToken=match.SyncToken}
        }else{
          const match=existingQBCusts.find(q=>q.Id===qbId);
          if(match)syncToken=match.SyncToken;
        }
        const qbCustomer=buildQBCustomerPayload(c,{qbId,syncToken,termRef});
        let res;
        try{res=await qbApi('upsert_customer',{customer:qbCustomer})}catch(e){log.details.push(c.name+' — FAILED: '+e.message);log.status='partial';continue}
        if(res?.Customer?.Id){
          custQBMap[c.id]=res.Customer.Id;
          log.details.push(c.name+' → QB #'+res.Customer.Id);synced++;
        }else{
          if(qbId)custQBMap[c.id]=qbId;
          const errDetail=res?.Fault?.Error?.[0]?.Detail||res?.Fault?.Error?.[0]?.Message||res?.error||res?.message||(res?JSON.stringify(res).slice(0,120):'empty response');log.details.push(c.name+' — FAILED: '+errDetail);log.status='partial';
        }
      }
      // Include customers that already had QB IDs from previous syncs
      cust.forEach(c=>{const prev=(qbConfig.custQBMap||{})[c.id];if(prev&&!custQBMap[c.id])custQBMap[c.id]=prev});
      if(synced===0&&log.details.length>0)log.status='error';
      const remainingCustomers=activeCustomers.filter(c=>!(c.qb_customer_id||(qbConfig.custQBMap||{})[c.id]||custQBMap[c.id])).length;
      log.details.unshift(synced+'/'+customersToSync.length+' customers completed in this batch'+(remainingCustomers?' · '+remainingCustomers+' remain unlinked':''));
      setQBConfig(prev=>({...prev,_customerSyncOffset:customerBatch.nextOffset,custQBMap:{...prev.custQBMap,...custQBMap},syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(synced+' customers synced to QB');
      setQbSyncing(false);
      return custQBMap;
    };

    // ── SYNC: Invoices (totals) ──
    const syncInvoices=async(custQBMap={},prodQBMap={},options={})=>{
      const canaryInvoiceId=String(options?.canaryInvoiceId||'');
      const canary=!!canaryInvoiceId;
      if(canary?!canaryPreflightReady():productionSyncLocked())return;
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:canary?'invoice_canary':'invoices',status:'success',details:[]};
      let synced=0;
      const allUnsyncedInvs=invs.filter(i=>!i.qb_invoice_id);
      const invoiceBatch=rotatingBatch(allUnsyncedInvs,qbConfig._invoiceSyncOffset,QB_SYNC_BATCH_SIZE);
      const unsyncedInvs2=canary?allUnsyncedInvs.filter(i=>String(i.id)===canaryInvoiceId):invoiceBatch.items;
      if(canary&&unsyncedInvs2.length!==1){nf('Choose exactly one pending portal invoice','error');setQbSyncing(false);return}
      let invoiceRefs,salesItemId;
      try{
        invoiceRefs=await requiredAccountRefs(['income_account','discount_account','ar_account']);
        salesItemId=canary?await requireExistingPortalSalesItem(invoiceRefs.income_account):await ensurePortalSalesItem(invoiceRefs.income_account);
      }catch(e){
        log.status='error';log.details.push(e.message||'Required invoice account could not be resolved');
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Invoice sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return;
      }
      for(const inv of unsyncedInvs2){
        const c=cust.find(cc=>cc.id===inv.customer_id);
        const cQBId=custQBMap[inv.customer_id]||(qbConfig.custQBMap||{})[inv.customer_id];
        if(!cQBId){log.details.push((inv.display_id||inv.id)+' — skipped: customer "'+c?.name+'" not synced to QB');continue}
        const so=sos.find(s=>s.id===(inv.so_id||inv.sales_order_id));
        // A taxable QBO invoice needs the company's QBO TaxCode/TxnTaxDetail,
        // not a made-up revenue or liability line. Until that mapping exists,
        // fail this invoice closed so tax is never credited to 40000 by mistake.
        if(safeNum(inv.tax)>0){
          log.details.push((inv.display_id||inv.id)+' — BLOCKED: $'+safeNum(inv.tax).toFixed(2)+' sales tax requires a QBO tax-code mapping. It was not posted to 40000 or guessed into 25201.');
          log.status='partial';continue;
        }
        const invoiceDate=parseQBDateValue(inv.invoice_date||inv.date||inv.created_at);
        if(!invoiceDate){log.details.push((inv.display_id||inv.id)+' — BLOCKED: invoice date could not be converted to a QBO date');log.status='partial';continue}
        const invoiceTotal=safeNum(inv.total);
        if(invoiceTotal<=0){log.details.push((inv.display_id||inv.id)+' — BLOCKED: invoice total must be positive; refunds require the separate 40000 credit/refund workflow.');log.status='partial';continue}
        const invoiceDescription='Invoice '+(inv.display_id||inv.id)+(so?' for '+so.id:'')+(so?.memo?' — '+so.memo:'');
        let customerTermRef=null;
        if(canary){
          try{
            const customerRes=await queryQBReadOnly(qbApi,"SELECT Id, SalesTermRef FROM Customer WHERE Id = '"+String(cQBId).replace(/'/g,"\\'")+"' MAXRESULTS 1",'invoice customer terms query');
            const qboCustomer=customerRes?.QueryResponse?.Customer?.[0];
            if(!qboCustomer?.SalesTermRef?.value)throw new Error('linked QBO customer has no payment terms');
            customerTermRef={value:String(qboCustomer.SalesTermRef.value),...(qboCustomer.SalesTermRef.name?{name:qboCustomer.SalesTermRef.name}:{})};
          }catch(e){log.details.push((inv.display_id||inv.id)+' — BLOCKED: '+e.message);log.status='error';continue}
        }
        let invoiceLines;
        try{invoiceLines=buildQBInvoicePostingLines({invoice:inv,salesItemId,discountAccountRef:invoiceRefs.discount_account,description:invoiceDescription})}
        catch(e){log.details.push((inv.display_id||inv.id)+' — BLOCKED: '+e.message);log.status='partial';continue}
        const qbInvoice={
          DocNumber:inv.display_id||inv.id,
          TxnDate:invoiceDate,
          CustomerRef:{value:cQBId},
          ARAccountRef:invoiceRefs.ar_account,
          ...(customerTermRef?{SalesTermRef:customerTermRef}:{}),
          Line:invoiceLines,
          ...(inv.qb_invoice_id?{Id:inv.qb_invoice_id,sparse:true}:{}),
        };
        let res;
        try{res=await qbApi('upsert_invoice',{invoice:qbInvoice})}
        catch(e){log.details.push((inv.display_id||inv.id)+' — FAILED: '+e.message);log.status='partial';continue}
        // A retry after a successful create may encounter a duplicate DocNumber.
        // Reuse only an exact customer/date/total match; never overwrite a
        // same-number invoice that could belong to a different transaction.
        if(!res?.Invoice?.Id&&(res?.Fault?.Error?.[0]?.code==='6140'||/duplicate/i.test(res?.Fault?.Error?.[0]?.Detail||''))){
          const docNum=inv.display_id||inv.id;
          let lookup;
          try{lookup=await queryQBReadOnly(qbApi,"SELECT Id, CustomerRef, TotalAmt, TxnDate FROM Invoice WHERE DocNumber = '"+String(docNum).replace(/'/g,"\\'")+"'",'invoice duplicate query')}
          catch(e){log.details.push(docNum+' — BLOCKED: duplicate lookup failed: '+e.message);log.status='partial';continue}
          const lookupFault=lookup?.Fault?.Error?.[0];
          if(lookupFault){log.details.push(docNum+' — BLOCKED: duplicate lookup failed: '+(lookupFault.Detail||lookupFault.Message||'QBO query error'));log.status='partial';continue}
          const matches=(lookup?.QueryResponse?.Invoice||[]).filter(existing=>
            String(existing.CustomerRef?.value||'')===String(cQBId)
            &&Math.abs(safeNum(existing.TotalAmt)-invoiceTotal)<0.005
            &&String(existing.TxnDate||'').slice(0,10)===String(qbInvoice.TxnDate||'').slice(0,10));
          if(matches.length===1){res={Invoice:matches[0]};log.details.push(docNum+' — exact existing invoice verified (QB #'+matches[0].Id+')')}
          else{log.details.push(docNum+' — BLOCKED: duplicate QBO document number is not one exact customer/date/total match');log.status='partial';continue}
        }
        if(res?.Invoice?.Id){
          if(canary){
            try{
              const verified=await verifyCanaryReadback('Invoice',res.Invoice.Id,{docNumber:inv.display_id||inv.id,refField:'CustomerRef',refValue:cQBId,total:invoiceTotal});
              if(String(verified.SalesTermRef?.value||'')!==String(customerTermRef?.value||''))throw new Error('Invoice customer terms did not match on API read-back.');
              log.details.push('READ-BACK VERIFIED: Invoice #'+verified.Id+' · '+(verified.SalesTermRef?.name||'QBO terms ID '+verified.SalesTermRef?.value));
            }catch(e){log.details.push((inv.display_id||inv.id)+' — VERIFY FAILED: '+e.message);log.status='error';continue}
          }
          setInvs(prev=>prev.map(ii=>ii.id===inv.id?{...ii,qb_invoice_id:res.Invoice.Id}:ii));
          log.details.push((inv.display_id||inv.id)+' → QB Invoice #'+res.Invoice.Id+' ($'+invoiceTotal.toFixed(2)+')');synced++;
          if(safeNum(inv.paid)>0)log.details.push((inv.display_id||inv.id)+' — payment queued for the paid-status pass after the QBO invoice link is persisted');
        }else{log.details.push((inv.display_id||inv.id)+' — FAILED: '+(res?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial'}
      }
      if(synced===0&&unsyncedInvs2.length>0)log.status='error';
      log.details.unshift(synced+'/'+unsyncedInvs2.length+(canary?' invoice canary':' invoices completed in this batch')+(allUnsyncedInvs.length>unsyncedInvs2.length?' · '+(allUnsyncedInvs.length-unsyncedInvs2.length)+' remain':''));
      setQBConfig(prev=>({...prev,...(!canary?{_invoiceSyncOffset:invoiceBatch.nextOffset}:{}),syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(canary?(synced?'Created and verified exactly one QBO invoice':'Invoice canary stopped — no verified invoice'):(synced+' invoices synced to QB'),synced?'success':'error');
      setQbSyncing(false);
      return{status:synced===1?'success':'blocked',synced};
    };

    // ── SYNC: Bidirectional paid status sync between QB and portal ──
    const syncPaidFromQB=async()=>{
      if(productionSyncLocked())return;
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'paid_sync',status:'success',details:[]};
      let updated=0;
      // Include all QB-linked invoices (not just unpaid) so portal-paid invoices can push to QB
      const allLinkedInvs=invs.filter(i=>i.qb_invoice_id);
      const paidOffset=Math.min(Math.max(0,Number(qbConfig._paidSyncOffset)||0),Math.max(0,allLinkedInvs.length-1));
      const linkedInvs=[...allLinkedInvs.slice(paidOffset),...allLinkedInvs.slice(0,paidOffset)].slice(0,QB_SYNC_BATCH_SIZE);
      const nextPaidOffset=allLinkedInvs.length?(paidOffset+linkedInvs.length)%allLinkedInvs.length:0;
      if(linkedInvs.length===0){log.details.push('No QB-linked invoices to check');setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('No invoices to sync');setQbSyncing(false);return}
      let paidRefs,salesItemId;
      try{
        paidRefs=await requiredAccountRefs(['income_account','discount_account','ar_account','payment_deposit_account']);
        salesItemId=await ensurePortalSalesItem(paidRefs.income_account);
      }catch(e){
        log.status='error';log.details.push(e.message||'Required payment account could not be resolved');
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Paid sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return;
      }
      try{
        // Query QB for all invoices and their balance
        const qbIds=linkedInvs.map(i=>i.qb_invoice_id);
        const res=await queryQBReadOnly(qbApi,"SELECT Id, DocNumber, Balance, TotalAmt, SyncToken FROM Invoice WHERE Id IN ('"+qbIds.join("','")+"')",'paid-status invoice query');
        const qbInvList=res?.QueryResponse?.Invoice||[];
        const qbMap={};qbInvList.forEach(qi=>{qbMap[qi.Id]=qi});
        for(const inv of linkedInvs){
          const qbInv=qbMap[inv.qb_invoice_id];
          if(!qbInv){log.details.push((inv.display_id||inv.id)+' — not found in QB');continue}
          const qbBalance=safeNum(qbInv.Balance);
          const qbTotal=safeNum(qbInv.TotalAmt);
          // Totals drift: invoices only pushed once (!qb_invoice_id filter), so a portal
          // edit after the first sync left QB stale forever. Portal is the source of truth
          // for the TOTAL — push the corrected amount, then reconcile paid on the NEXT run
          // (this run's Balance was computed against the old total).
          const portalTotal=safeNum(inv.total);
          if(portalTotal>0&&Math.abs(portalTotal-qbTotal)>0.005){
            if(safeNum(inv.tax)>0){log.details.push((inv.display_id||inv.id)+' — total correction BLOCKED: taxable invoice needs QBO tax-code mapping');log.status='partial';continue}
            let correctionLines;
            try{correctionLines=buildQBInvoicePostingLines({invoice:inv,salesItemId,discountAccountRef:paidRefs.discount_account,description:'Invoice '+(inv.display_id||inv.id)})}
            catch(e){log.details.push((inv.display_id||inv.id)+' — total correction BLOCKED: '+e.message);log.status='partial';continue}
            const upd=await qbApi('upsert_invoice',{invoice:{Id:inv.qb_invoice_id,SyncToken:qbInv.SyncToken,sparse:true,Line:correctionLines}});
            if(upd?.Invoice?.Id){log.details.push((inv.display_id||inv.id)+' — QB total corrected $'+qbTotal.toFixed(2)+' → $'+portalTotal.toFixed(2)+' (paid re-checks next run)');updated++}
            else{log.details.push((inv.display_id||inv.id)+' — total correction FAILED: '+(upd?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial'}
            continue;
          }
          const qbPaid=qbTotal-qbBalance;
          const portalPaid=safeNum(inv.paid);
          if(qbPaid>portalPaid){
            // QB has more paid — pull to portal
            const newStatus=qbBalance<=0?'paid':qbPaid>0?'partial':'open';
            const pmt={amount:Math.round((qbPaid-portalPaid)*100)/100,method:'qb_sync',ref:'QB Payment Sync',date:new Date().toLocaleDateString()};
            setInvs(prev=>prev.map(ii=>ii.id===inv.id?{...ii,paid:Math.round(qbPaid*100)/100,status:newStatus,payments:[...(ii.payments||[]),pmt]}:ii));
            log.details.push((inv.display_id||inv.id)+' — marked '+newStatus+' (QB paid $'+qbPaid.toFixed(2)+')');updated++;
          }else if(portalPaid>qbPaid&&qbBalance>0){
            // Portal has more paid — push payment to QB
            const diff=Math.round((portalPaid-qbPaid)*100)/100;
            const cQBId=inv.qb_customer_id||(qbConfig.custQBMap||{})[inv.customer_id];
            if(cQBId){
              try{
                const qbPmt={CustomerRef:{value:cQBId},DepositToAccountRef:paidRefs.payment_deposit_account,TotalAmt:diff,
                  Line:[{Amount:diff,LinkedTxn:[{TxnId:inv.qb_invoice_id,TxnType:'Invoice'}]}]};
                await qbApi('upsert_payment',{payment:qbPmt});
                log.details.push((inv.display_id||inv.id)+' — pushed $'+diff.toFixed(2)+' payment to QB');updated++;
              }catch(pe){log.details.push((inv.display_id||inv.id)+' — failed to push payment to QB: '+pe.message);log.status='partial'}
            }else{
              log.details.push((inv.display_id||inv.id)+' — skipped push: customer not synced to QB');
            }
          }else{
            log.details.push((inv.display_id||inv.id)+' — already up to date');
          }
        }
      }catch(e){log.status='error';log.details.push('QB query failed: '+e.message)}
      log.details.unshift(updated+'/'+linkedInvs.length+' invoices checked in this batch'+(allLinkedInvs.length>linkedInvs.length?' · '+(allLinkedInvs.length-linkedInvs.length)+' remain for later batches':''));
      setQBConfig(prev=>({...prev,_paidSyncOffset:nextPaidOffset,syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(updated+' invoices synced with QB');
      setQbSyncing(false);
    };

    // ── SYNC: Pull bills FROM QB back to portal (bill costs → PO costs) ──
    const syncBillsFromQB=async()=>{
      if(productionSyncLocked())return;
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'bill_pull',status:'success',details:[]};
      let updated=0;
      const syncedBillIds=new Set(qbConfig._syncedBillIds||[]);
      const newSyncedBillIds=[...syncedBillIds];
      try{
        // Query all bills from QB
        const qbBills=await loadAllQBEntities(qbApi,'Bill','*',500);
        if(!qbBills.length){log.details.push('No bills found in QB');setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('No bills in QB');setQbSyncing(false);return}
        // Build reverse map: QB PO Id → portal PO id
        const poMap=qbConfig.qbPOMap||{};
        const reversePoMap={};// qbPOId → portalPOId
        Object.entries(poMap).forEach(([portalId,qbId])=>{reversePoMap[qbId]=portalId});
        // Collect all portal PO numbers for matching by DocNumber
        const allPortalPOIds=new Set();
        sos.forEach(so=>{safeItems(so).forEach(it=>{(it.po_lines||[]).forEach(pl=>{if(pl.po_id)allPortalPOIds.add(pl.po_id)})})});
        submittedBatches.forEach(b=>{if(b.po_number)allPortalPOIds.add(b.po_number)});
        invPOs.forEach(p=>{if(p.po_number)allPortalPOIds.add(p.po_number)});
        for(const qbBill of qbBills){
          if(syncedBillIds.has(qbBill.Id))continue;
          const billTotal=safeNum(qbBill.TotalAmt);
          const billDate=qbBill.TxnDate||'';
          const billDocNum=qbBill.DocNumber||'';
          const billMemo=qbBill.PrivateNote||'';
          const vendorName=qbBill.VendorRef?.name||'';
          // Try to match to portal PO via LinkedTxn (PurchaseOrder reference)
          let matchedPortalPOId=null;
          const linkedTxns=qbBill.LinkedTxn||[];
          for(const lt of linkedTxns){
            if(lt.TxnType==='PurchaseOrder'&&reversePoMap[lt.TxnId]){
              matchedPortalPOId=reversePoMap[lt.TxnId];break;
            }
          }
          // Fallback: match by DocNumber against portal PO IDs
          if(!matchedPortalPOId&&billDocNum){
            const docLc=billDocNum.toLowerCase().replace(/\s+/g,'');
            for(const pid of allPortalPOIds){
              if(pid.toLowerCase().replace(/\s+/g,'')===docLc){matchedPortalPOId=pid;break}
            }
          }
          // Fallback: check memo for PO reference
          if(!matchedPortalPOId&&billMemo){
            const poMatch=billMemo.match(/PO[:\s]*([A-Z0-9-]+)/i);
            if(poMatch){
              const poRef=poMatch[1].toLowerCase().replace(/\s+/g,'');
              for(const pid of allPortalPOIds){
                if(pid.toLowerCase().replace(/\s+/g,'')===poRef){matchedPortalPOId=pid;break}
              }
            }
          }
          if(!matchedPortalPOId){continue}
          // Determine which PO source this matches and apply the bill cost
          const billInfo={qb_bill_id:qbBill.Id,doc_number:billDocNum,vendor:vendorName,total:billTotal,date:billDate};
          // Check SO item PO lines. The match decision happens SYNCHRONOUSLY on the current
          // array — the old version set a flag inside the setSOs updater and read it on the
          // next line, but React 18 runs updaters at batch flush, AFTER that read. Result:
          // the cost applied yet the bill was never recorded as synced, so EVERY sync run
          // re-applied it — compounding _bill_cost on the PO. Decide first, then write once.
          let appliedToSO=false;
          const soHit=sos.find(s=>(s.items||[]).some(it=>(it.po_lines||[]).some(po=>po.po_id===matchedPortalPOId)));
          if(soHit){
            // One QBO bill may cover several SKU rows on the same PO. The old
            // code added the ENTIRE bill total to every matching row, multiplying
            // cost by the line count. Allocate the bill total once, weighted by
            // each row's ordered cost, with the final row taking rounding cents.
            const hits=[];
            (soHit.items||[]).forEach((it,itemIndex)=>(it.po_lines||[]).forEach((po,poIndex)=>{
              if(po.po_id!==matchedPortalPOId)return;
              const orderedQty=Object.entries(po).filter(([k,v])=>typeof v==='number'&&!k.startsWith('_')&&k.match(/^[A-Z0-9]/)).reduce((a,[,v])=>a+safeNum(v),0);
              hits.push({itemIndex,poIndex,weight:Math.max(0,orderedQty*safeNum(po.unit_cost||it.nsa_cost))});
            }));
            const totalWeight=hits.reduce((a,h)=>a+h.weight,0);
            let allocated=0;
            const allocations=hits.map((h,idx)=>{
              const amount=idx===hits.length-1
                ?Math.round((billTotal-allocated)*100)/100
                :Math.round((billTotal*(totalWeight>0?h.weight/totalWeight:1/hits.length))*100)/100;
              allocated=Math.round((allocated+amount)*100)/100;
              return{...h,amount};
            });
            setSOs(prev=>prev.map(s=>{
              if(s.id!==soHit.id)return s;
              const updatedItems=(s.items||[]).map((it,itemIndex)=>{
                if(!allocations.some(a=>a.itemIndex===itemIndex))return it;
                return{...it,po_lines:it.po_lines.map((po,poIndex)=>{
                  const allocation=allocations.find(a=>a.itemIndex===itemIndex&&a.poIndex===poIndex);
                  if(!allocation)return po;
                  const prevCost=safeNum(po._bill_cost||0);
                  return{...po,_bill_cost:Math.round((prevCost+allocation.amount)*100)/100,
                    _bill_details:[...(po._bill_details||[]),{...billInfo,allocated_total:allocation.amount}]};
                })};
              });
              const updatedSO={...s,items:updatedItems,updated_at:new Date().toLocaleString()};
              _dbSaveSO(updatedSO);
              return updatedSO;
            }));
            appliedToSO=true;
          }
          // Check batch POs
          if(!appliedToSO){
            const batchMatch=submittedBatches.find(b=>(b.po_number||b.id)===matchedPortalPOId);
            if(batchMatch){
              setSubmittedBatches(prev=>prev.map(sb=>{
                if((sb.po_number||sb.id)!==matchedPortalPOId)return sb;
                return{...sb,_bill_cost:Math.round((safeNum(sb._bill_cost||0)+billTotal)*100)/100,
                  _bill_details:[...(sb._bill_details||[]),billInfo]};
              }));
              appliedToSO=true;
            }
          }
          // Check inventory POs
          if(!appliedToSO){
            const invMatch=invPOs.find(p=>p.po_number===matchedPortalPOId);
            if(invMatch){
              setInvPOs(prev=>prev.map(po=>{
                if(po.po_number!==matchedPortalPOId)return po;
                return{...po,_bill_cost:Math.round((safeNum(po._bill_cost||0)+billTotal)*100)/100,
                  _bill_details:[...(po._bill_details||[]),billInfo]};
              }));
              appliedToSO=true;
            }
          }
          if(appliedToSO){
            newSyncedBillIds.push(qbBill.Id);
            log.details.push('Bill #'+billDocNum+' ('+vendorName+' $'+billTotal.toFixed(2)+') → PO '+matchedPortalPOId);
            updated++;
          }
        }
      }catch(e){log.status='error';log.details.push('QB query failed: '+e.message)}
      log.details.unshift(updated+' bills pulled from QB');
      setQBConfig(prev=>({...prev,_syncedBillIds:newSyncedBillIds,syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(updated+' bill costs pulled from QB');
      setQbSyncing(false);
    };

    // ── SYNC: Products as QBO Inventory items ──
    // The portal remains the SKU/size/color source of truth. QBO receives one
    // aggregate Inventory item per SKU, using the owner's chart of accounts.
    // Bulk creation stays locked until the legacy-item retirement and opening
    // balance cutover have been reviewed; this routine currently permits only
    // an exact one-item, zero-opening-balance canary.
    const syncInventory=async(options={})=>{
      const canaryProductId=String(options?.canaryProductId||'');
      const canary=!!canaryProductId;
      if(canary?!canaryPreflightReady():productionSyncLocked())return{};
      if(!canary){nf('QBO Inventory batch sync is locked until the legacy-item cutover and opening balances are approved','error');return{status:'blocked'}}
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:canary?'item_canary':'inventory',status:'success',details:[]};
      let synced=0;
      let incomeAcctRef,cogsAcctRef,assetAcctRef;
      try{
        const refs=await requiredAccountRefs(['income_account','cogs_account','inventory_asset_account']);
        incomeAcctRef=refs.income_account;cogsAcctRef=refs.cogs_account;assetAcctRef=refs.inventory_asset_account;
      }catch(e){
        log.status='error';log.details.push(e.message||'Required product-item account could not be resolved');
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Product item sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return{};
      }
      // Query existing QB items to match by name and avoid duplicates
      let existingQBItems=[];
      try{
        existingQBItems=await loadAllQBEntities(qbApi,'Item','*',1000);
      }catch(e){
        log.status='error';log.details.push('Item duplicate preflight failed: '+e.message);
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Product item sync blocked — QBO duplicate preflight failed','error');setQbSyncing(false);return{};
      }
      const prodQBMap={...(qbConfig.prodQBMap||{})};
      const skuGroups=new Map();
      prod.filter(p=>p.is_active!==false&&String(p.sku||'').trim()).forEach(p=>{
        const key=String(p.sku).trim().toUpperCase();
        if(!skuGroups.has(key))skuGroups.set(key,[]);
        skuGroups.get(key).push(p);
      });
      const sortedSkuGroups=[...skuGroups.entries()].sort(([,a],[,b])=>{
        const aLinked=a.some(p=>prodQBMap[p.id]);
        const bLinked=b.some(p=>prodQBMap[p.id]);
        return Number(aLinked)-Number(bLinked);
      });
      const inventoryBatch=rotatingBatch(sortedSkuGroups,qbConfig._inventorySyncOffset,QB_SYNC_BATCH_SIZE);
      const skuBatches=canary?sortedSkuGroups.filter(([,products])=>products.some(p=>String(p.id)===canaryProductId)):inventoryBatch.items;
      if(canary&&skuBatches.length!==1){nf('Choose exactly one active portal SKU','error');setQbSyncing(false);return{}}
      for(const [sku,products] of skuBatches){
        const p=products[0];
        const existingQBId=products.map(pp=>prodQBMap[pp.id]).find(Boolean);
        // Sanitize the name QB will display — strip control chars QB chokes on,
        // collapse whitespace, trim, cap at 100. Same for description.
        const cleanName=String(p.name||'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
        const itemName=sku.slice(0,100);
        // Match exactly one QBO item by stored ID/SKU. Choosing the first of
        // duplicate SKUs would make later PO and bill routing nondeterministic.
        let qbId=existingQBId;let syncToken=null;let existingType=null;let existingActive=true;let existingQty=0;
        if(qbId){
          const match=existingQBItems.find(i=>i.Id===qbId);
          if(match){syncToken=match.SyncToken;existingType=match.Type;existingActive=match.Active!==false;existingQty=safeNum(match.QtyOnHand)}else{qbId=null}
        }
        const skuMatches=existingQBItems.filter(i=>i.Active!==false&&
          (String(i.Sku||'').trim().toUpperCase()===sku||String(i.Name||'').trim().toUpperCase()===sku));
        if(skuMatches.length>1){log.details.push(sku+' — BLOCKED: duplicate active QBO items use this SKU/name');log.status='partial';continue}
        if(!qbId&&skuMatches.length===1){
          const match=skuMatches[0];qbId=match.Id;syncToken=match.SyncToken;existingType=match.Type;existingActive=match.Active!==false;existingQty=safeNum(match.QtyOnHand);
        }
        if(qbId&&existingType&&String(existingType).toLowerCase()!=='inventory'){
          log.details.push(sku+' — BLOCKED: existing QBO item type is '+existingType+'; QBO cannot convert it to Inventory');log.status='partial';continue;
        }
        if(qbId&&!existingActive){log.details.push(sku+' — BLOCKED: linked QBO item is inactive');log.status='partial';continue}
        if(qbId&&Math.abs(existingQty)>=0.0001){log.details.push(sku+' — BLOCKED: existing QBO Inventory item has '+existingQty+' units; zero-quantity canary will not alter it');log.status='partial';continue}
        const isUpdate=!!qbId;
        const qbItem={
          Name:itemName,
          Sku:sku,
          Description:cleanName+' | Portal is source of truth for size/color; QBO stores aggregate SKU quantity',
          PurchaseDesc:cleanName,
          UnitPrice:safeNum(p.retail_price||p.nsa_cost),
          PurchaseCost:safeNum(p.nsa_cost),
          IncomeAccountRef:incomeAcctRef,
          ExpenseAccountRef:cogsAcctRef,
          AssetAccountRef:assetAcctRef,
          ...(isUpdate
            ?{Id:qbId,SyncToken:syncToken,sparse:true}
            :{Type:'Inventory',TrackQtyOnHand:true,QtyOnHand:0,InvStartDate:'2026-09-01'}),
        };
        let res;
        try{res=await qbApi('upsert_item',{item:qbItem})}
        catch(e){log.details.push(sku+' — FAILED: '+e.message);log.status='partial';continue}
        if(res?.Item?.Id){
          if(canary){
            try{
              const verified=await verifyCanaryReadback('Item',res.Item.Id,{sku});
              if(String(verified.Type||'').toLowerCase()!=='inventory'||verified.TrackQtyOnHand!==true)throw new Error('QBO item type was not tracked Inventory on API read-back.');
              if(Math.abs(safeNum(verified.QtyOnHand))>=0.0001)throw new Error('QBO Inventory canary did not start at zero quantity.');
              if(String(verified.IncomeAccountRef?.value||'')!==String(incomeAcctRef.value)||String(verified.ExpenseAccountRef?.value||verified.COGSAccountRef?.value||'')!==String(cogsAcctRef.value)||String(verified.AssetAccountRef?.value||'')!==String(assetAcctRef.value))throw new Error('QBO item accounts did not match 40000/50000/12000 on API read-back.');
              log.details.push('READ-BACK VERIFIED: '+sku+' · QBO Item #'+verified.Id+' · Inventory · opening quantity 0');
            }catch(e){log.details.push(sku+' — VERIFY FAILED: '+e.message);log.status='error';continue}
          }
          products.forEach(pp=>{prodQBMap[pp.id]=res.Item.Id});
          log.details.push(sku+' → QBO Inventory Item #'+res.Item.Id+' ('+products.length+' portal variant'+(products.length===1?'':'s')+')');synced++;
        }else{log.details.push(sku+' — FAILED: '+(res?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial'}
      }
      const remainingSkus=[...skuGroups.values()].filter(products=>!products.some(p=>prodQBMap[p.id])).length;
      log.details.unshift(synced+'/'+skuBatches.length+(canary?' item canary':' product items completed in this batch')+(remainingSkus?' · '+remainingSkus+' remain unlinked':''));
      setQBConfig(prev=>({...prev,...(!canary?{_inventorySyncOffset:inventoryBatch.nextOffset}:{}),prodQBMap:{...prev.prodQBMap,...prodQBMap},syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(canary?(synced?'Created and verified exactly one zero-quantity QBO Inventory item':'QBO Inventory item canary stopped'):'QBO Inventory batch sync is locked',synced?'success':'error');
      setQbSyncing(false);
      return prodQBMap;
    };

    // Reconcile exactly one portal manual adjustment by setting the linked QBO
    // Inventory item's aggregate SKU quantity to the portal's current total.
    // This is deliberately a small canary (maximum five-unit delta). QBO creates
    // the accounting-side quantity adjustment when QtyOnHand changes; the canary
    // must be reviewed in QBO before any automatic adjustment batch is enabled.
    const syncInventoryAdjustmentCanary=async(adjustmentId)=>{
      if(!canaryPreflightReady())return{status:'blocked'};
      const adjustment=invAdjLog.find(row=>String(row.id)===String(adjustmentId));
      if(!adjustment||safeNum(adjustment.qty_change)===0){nf('Choose exactly one portal inventory adjustment','error');return{status:'blocked'}}
      if(String(adjustment.adjustment_type||'manual')==='po_receive'){nf('PO receipts are not manual-adjustment canaries','error');return{status:'blocked'}}
      const sku=String(adjustment.sku||'').trim().toUpperCase();
      const skuProducts=prod.filter(p=>String(p.sku||'').trim().toUpperCase()===sku);
      const mappedIds=[...new Set(skuProducts.map(p=>String((qbConfig.prodQBMap||{})[p.id]||'')).filter(Boolean))];
      if(mappedIds.length!==1){nf('Adjustment test blocked — this SKU must link to exactly one QBO Inventory item','error');return{status:'blocked'}}
      const targetQty=skuProducts.reduce((sum,p)=>sum+Object.values(p._inv||{}).reduce((n,value)=>n+safeNum(value),0),0);
      const itemId=mappedIds[0];
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'inventory_adjustment_canary',status:'success',details:[]};
      try{
        const refs=await requiredAccountRefs(['income_account','cogs_account','inventory_asset_account','inventory_loss_account']);
        const beforeRes=await qbApi('read',{entity:'item',id:itemId});
        const before=beforeRes?.Item;
        if(!before||before.Active===false||String(before.Type||'').toLowerCase()!=='inventory')throw new Error('Linked QBO item is missing, inactive, or not Inventory.');
        if(String(before.Sku||'').trim().toUpperCase()!==sku)throw new Error('Linked QBO item SKU does not match the portal adjustment.');
        if(String(before.IncomeAccountRef?.value||'')!==String(refs.income_account.value)||String(before.ExpenseAccountRef?.value||before.COGSAccountRef?.value||'')!==String(refs.cogs_account.value)||String(before.AssetAccountRef?.value||'')!==String(refs.inventory_asset_account.value))throw new Error('Linked QBO item does not use 40000 Sales / 50000 COGS / 12000 Inventory Asset.');
        const beforeQty=safeNum(before.QtyOnHand);
        const qtyDelta=targetQty-beforeQty;
        if(Math.abs(qtyDelta)>5)throw new Error('Canary delta is '+qtyDelta+' units; choose a SKU within five units of the portal total.');
        if(Math.abs(qtyDelta)>=0.0001){
          const res=await qbApi('upsert_item',{item:{Id:before.Id,SyncToken:before.SyncToken,sparse:true,QtyOnHand:targetQty}});
          if(!res?.Item?.Id)throw new Error(res?.Fault?.Error?.[0]?.Detail||'QBO rejected the quantity update.');
        }
        const verified=await verifyCanaryReadback('Item',itemId,{sku});
        if(Math.abs(safeNum(verified.QtyOnHand)-targetQty)>=0.0001)throw new Error('QBO quantity did not match the portal total on API read-back.');
        log.details.push('READ-BACK VERIFIED: '+sku+' · QBO Item #'+itemId+' · '+beforeQty+' → '+targetQty+' units');
        log.details.push('ACCOUNT REVIEW REQUIRED: confirm the QBO-generated quantity adjustment uses 52400 Inventory Loss; 12000/40000/50000 item accounts were verified.');
        const result={adjustmentId:String(adjustment.id),sku,itemId,beforeQty,targetQty,qtyDelta,inventoryLossAccountId:refs.inventory_loss_account.value,at:new Date().toISOString(),status:'awaiting_account_review'};
        setQBConfig(prev=>({...prev,_inventoryAdjustmentCanary:result,syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
        nf('Quantity synced and verified — review its QBO adjustment account before enabling automatic sync','success');
        return result;
      }catch(e){
        log.status='error';log.details.push(e.message||'Inventory adjustment canary failed');
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));
        nf('Inventory adjustment test blocked — '+(e.message||'QBO quantity update failed'),'error');
        return{status:'blocked'};
      }finally{setQbSyncing(false)}
    };

    // Remove only a stale portal link whose exact QBO item has already been
    // made inactive. The first call is read-only and asks the UI for explicit
    // confirmation; the confirmed call reads QBO again immediately before the
    // link is removed. Active or mismatched items are never unlinked here.
    const clearInactiveProductLink=async(canaryProductId,options={})=>{
      if(!canaryPreflightReady())return{status:'blocked'};
      const product=prod.find(p=>String(p.id)===String(canaryProductId));
      const sku=String(product?.sku||'').trim().toUpperCase();
      if(!product||!sku){nf('Choose exactly one active portal SKU','error');return{status:'blocked'}}
      const productIds=prod.filter(p=>String(p.sku||'').trim().toUpperCase()===sku).map(p=>String(p.id));
      const mappedIds=[...new Set(productIds.map(id=>String((qbConfig.prodQBMap||{})[id]||'')).filter(Boolean))];
      if(mappedIds.length!==1){
        nf(mappedIds.length?'Inactive-link cleanup blocked — this SKU has conflicting QBO links':'This SKU has no saved QBO link','error');
        return{status:'blocked'};
      }
      const itemId=mappedIds[0];
      setQbSyncing(true);
      try{
        const response=await qbApi('read',{entity:'item',id:itemId});
        const item=response?.Item;
        if(!item||String(item.Id)!==itemId)throw new Error('QBO item #'+itemId+' was not returned by API read-back.');
        const itemSku=String(item.Sku||item.Name||'').trim().toUpperCase();
        if(itemSku!==sku)throw new Error('QBO item #'+itemId+' does not match portal SKU '+sku+'.');
        if(item.Active!==false)throw new Error('QBO item #'+itemId+' is still active; its portal link was not removed.');
        if(options.allowUnlink!==true){
          setQbSyncing(false);
          return{status:'needs_confirmation',sku,itemId,productName:product.name||sku};
        }
        const log={ts:new Date().toLocaleString(),type:'item_link_cleanup',status:'success',details:[
          'UNLINKED INACTIVE QBO ITEM: '+sku+' → QBO Item #'+itemId,
          productIds.length+' portal product record'+(productIds.length===1?'':'s')+' cleared after API read-back verified Active=false',
        ]};
        setQBConfig(prev=>{
          const prodQBMap={...(prev.prodQBMap||{})};
          productIds.forEach(id=>{if(String(prodQBMap[id]||'')===itemId)delete prodQBMap[id]});
          return{...prev,prodQBMap,syncLog:[log,...(prev.syncLog||[])].slice(0,100),lastSync:new Date().toLocaleString()};
        });
        nf('Cleared inactive QBO link for '+sku,'success');
        setQbSyncing(false);
        return{status:'success',sku,itemId};
      }catch(e){
        const message=e.message||'Inactive QBO link could not be verified';
        const log={ts:new Date().toLocaleString(),type:'item_link_cleanup',status:'error',details:[message]};
        setQBConfig(prev=>({...prev,syncLog:[log,...(prev.syncLog||[])].slice(0,100)}));
        nf('Inactive-link cleanup blocked — '+message,'error');
        setQbSyncing(false);
        return{status:'blocked'};
      }
    };


    // ── SYNC: Sales Orders (as QB Estimates) ──
    const syncSalesOrders=async(custQBMap={},prodQBMap={},options={})=>{
      const canarySOId=String(options?.canarySOId||'');
      const canary=!!canarySOId;
      if(canary?!canaryPreflightReady():productionSyncLocked())return;
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:canary?'sales_order_canary':'sales_orders',status:'success',details:[]};
      let synced=0;
      const soMap=qbConfig.qbSOMap||{};
      const allToSync=sos.filter(so=>{
        const hasItems=safeItems(so).some(it=>Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0)>0);
        return hasItems&&!soMap[so.id];
      });
      const salesOrderBatch=rotatingBatch(allToSync,qbConfig._salesOrderSyncOffset,QB_SYNC_BATCH_SIZE);
      const toSync=canary?allToSync.filter(so=>String(so.id)===canarySOId):salesOrderBatch.items;
      if(canary&&toSync.length!==1){nf('Choose exactly one pending portal sales order','error');setQbSyncing(false);return}
      let existingQBEstimates=[];
      try{existingQBEstimates=await loadAllQBEntities(qbApi,'Estimate','Id, DocNumber, CustomerRef, TotalAmt, TxnDate',500)}
      catch(e){
        log.status='error';log.details.push('Estimate duplicate preflight failed: '+e.message);
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Sales-order sync blocked — QBO duplicate preflight failed','error');setQbSyncing(false);return;
      }
      let fallbackSalesItemId;
      try{
        const refs=await requiredAccountRefs(['income_account']);
        fallbackSalesItemId=canary?await requireExistingPortalSalesItem(refs.income_account):await ensurePortalSalesItem(refs.income_account);
      }catch(e){
        log.status='error';log.details.push(e.message||'40000 Sales could not be resolved');
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Sales-order sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return;
      }
      const effectiveProdQBMap={...(qbConfig.prodQBMap||{}),...(prodQBMap||{})};
      for(const so of toSync){
        const c=cust.find(x=>x.id===so.customer_id);
        const cQBId=custQBMap[so.customer_id]||(qbConfig.custQBMap||{})[so.customer_id];
        if(!cQBId){log.details.push(so.id+' — skipped: customer not synced to QB');continue}
        const estimateDate=parseQBDateValue(so.created_at);
        if(!estimateDate){log.details.push(so.id+' — BLOCKED: sales-order date could not be converted to a QBO date');log.status='partial';continue}
        const saf=safeArt(so);
        const _aq={};safeItems(so).forEach(it2=>{const q2=Object.values(safeSizes(it2)).reduce((a,v)=>a+safeNum(v),0);safeDecos(it2).forEach(d2=>{if(d2.kind==='art'&&d2.art_file_id){_aq[d2.art_file_id]=(_aq[d2.art_file_id]||0)+q2}})});
        const lines=[];
        safeItems(so).forEach(it=>{
          const qty=Object.values(safeSizes(it)).reduce((a,v)=>a+safeNum(v),0);
          if(!qty)return;
          const itemQBId=effectiveProdQBMap[it.product_id||(prod.find(pp=>pp.sku===it.sku)||{}).id];
          // Calculate deco costs to include in line total
          let decoTotal=0;const decoDescs=[];
          safeDecos(it).forEach(d=>{
            const cq=d.kind==='art'&&d.art_file_id?_aq[d.art_file_id]:qty;
            const dp=dP(d,qty,saf,cq);
            const eq=dp._nq!=null?dp._nq:(d.reversible?qty*2:qty);
            if(dp.sell>0){decoTotal+=eq*dp.sell;decoDescs.push((d.position||d.deco_type||d.kind||'Art')+' @$'+dp.sell.toFixed(2))}
          });
          const lineAmt=qty*(it.unit_sell||0)+decoTotal;
          const desc=it.sku+' '+it.name+(it.color?' - '+it.color:'')+(decoDescs.length?' + '+decoDescs.join(', '):'');
          lines.push({DetailType:'SalesItemLineDetail',Amount:lineAmt,
            Description:desc,
            SalesItemLineDetail:{Qty:qty,UnitPrice:lineAmt/qty,ItemRef:{value:String(itemQBId||fallbackSalesItemId)}}});
        });
        if(!lines.length)continue;
        const salesSubtotal=lines.reduce((sum,line)=>sum+safeNum(line.Amount),0);
        const customerShipping=calculateCustomerShipping(so,salesSubtotal);
        if(customerShipping>0)lines.push({DetailType:'SalesItemLineDetail',Amount:customerShipping,
          Description:'Customer shipping — 40000 Sales',
          SalesItemLineDetail:{Qty:1,UnitPrice:customerShipping,ItemRef:{value:String(fallbackSalesItemId)}}});
        const qbEstimate={
          DocNumber:so.id,
          TxnDate:estimateDate,
          CustomerRef:{value:cQBId},
          Line:lines,
          PrivateNote:'Portal SO: '+so.id+(so.memo?' — '+so.memo:''),
          ...(soMap[so.id]?{Id:soMap[so.id],sparse:true}:{}),
        };
        const estimateTotal=Math.round(lines.reduce((sum,line)=>sum+safeNum(line.Amount),0)*100)/100;
        const sameNumber=existingQBEstimates.filter(existing=>String(existing.DocNumber||'')===String(so.id));
        const exact=sameNumber.filter(existing=>String(existing.CustomerRef?.value||'')===String(cQBId)
          &&Math.abs(safeNum(existing.TotalAmt)-estimateTotal)<0.005
          &&String(existing.TxnDate||'').slice(0,10)===String(qbEstimate.TxnDate||'').slice(0,10));
        if(exact.length===1){
          if(canary){
            try{await verifyCanaryReadback('Estimate',exact[0].Id,{docNumber:so.id,refField:'CustomerRef',refValue:cQBId,total:estimateTotal})}
            catch(e){log.details.push(so.id+' — VERIFY FAILED: '+e.message);log.status='error';continue}
          }
          soMap[so.id]=exact[0].Id;log.details.push(so.id+' — exact existing QB Estimate #'+exact[0].Id+' verified');synced++;continue;
        }
        if(sameNumber.length){log.details.push(so.id+' — BLOCKED: QBO estimate number exists with a different customer, date, or total');log.status='partial';continue}
        let res;
        try{res=await qbApi('upsert_estimate',{estimate:qbEstimate})}
        catch(e){log.details.push(so.id+' — FAILED: '+e.message);log.status='partial';continue}
        if(res?.Estimate?.Id){
          if(canary){
            try{
              const verified=await verifyCanaryReadback('Estimate',res.Estimate.Id,{docNumber:so.id,refField:'CustomerRef',refValue:cQBId,total:estimateTotal});
              log.details.push('READ-BACK VERIFIED: '+so.id+' · QBO Estimate #'+verified.Id+' · $'+safeNum(verified.TotalAmt).toFixed(2));
            }catch(e){log.details.push(so.id+' — VERIFY FAILED: '+e.message);log.status='error';continue}
          }
          soMap[so.id]=res.Estimate.Id;
          log.details.push(so.id+' → QB Estimate #'+res.Estimate.Id);synced++;
        }else{log.details.push(so.id+' — FAILED: '+(res?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial'}
      }
      if(synced===0&&toSync.length>0)log.status='error';
      log.details.unshift(synced+'/'+toSync.length+(canary?' sales-order canary':' sales orders completed in this batch')+(allToSync.length>toSync.length?' · '+(allToSync.length-toSync.length)+' remain':''));
      setQBConfig(prev=>({...prev,...(!canary?{_salesOrderSyncOffset:salesOrderBatch.nextOffset}:{}),qbSOMap:{...prev.qbSOMap,...soMap},syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(canary?(synced?'Created and verified exactly one QBO estimate':'Sales-order canary stopped'):(synced+' sales orders synced to QB'),synced?'success':'error');
      setQbSyncing(false);
      return{status:synced===1?'success':'blocked',synced};
    };

    // ── SYNC: Purchase Orders ──
    const syncPurchaseOrders=async(prodQBMapArg={},options={})=>{
      const canaryPOId=String(options?.canaryPOId||'');
      const canary=!!canaryPOId;
      if(canary?!canaryPreflightReady():productionSyncLocked())return;
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:canary?'purchase_order_canary':'purchase_orders',status:'success',details:[]};
      let synced=0;
      const poMap=qbConfig.qbPOMap||{};
      // Fetch existing QB vendors to match by name and avoid duplicates
      let existingQBVendors=[];
      try{
        existingQBVendors=await loadAllQBEntities(qbApi,'Vendor','Id, DisplayName, CompanyName, SyncToken',500);
      }catch(e){
        log.status='error';log.details.push('Vendor duplicate preflight failed: '+e.message);
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Purchase-order sync blocked — QBO vendor preflight failed','error');setQbSyncing(false);return;
      }
      let existingQBPOs=[];
      try{existingQBPOs=await loadAllQBEntities(qbApi,'PurchaseOrder','Id, DocNumber, VendorRef, TotalAmt, TxnDate',500)}
      catch(e){
        log.status='error';log.details.push('Purchase-order duplicate preflight failed: '+e.message);
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Purchase-order sync blocked — QBO duplicate preflight failed','error');setQbSyncing(false);return;
      }
      const vendorQBMap={};// vendorName -> qbVendorId (cache for this sync run)
      // POs do not post to the GL, but every line still carries the approved
      // category so the PO-to-bill workflow remains deterministic.
      let poAccountRefs;
      try{
        poAccountRefs=await requiredAccountRefs(['purchases_account','deco_account']);
      }catch(e){
        log.status='error';log.details.push(e.message||'Required purchase-order account could not be resolved');
        setQBConfig(prev=>({...prev,syncLog:[log,...prev.syncLog].slice(0,100)}));nf('Purchase-order sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return;
      }
      // Group PO lines by po_id so we push one QB PO with all line items
      const allPoGroups=groupPortalPurchaseOrders(sos,poMap);
      const purchaseOrderBatch=rotatingBatch(allPoGroups,qbConfig._purchaseOrderSyncOffset,QB_SYNC_BATCH_SIZE);
      const poGroups=canary?allPoGroups.filter(group=>String(group.poId)===canaryPOId):purchaseOrderBatch.items;
      if(canary&&poGroups.length!==1){nf('Choose exactly one pending portal purchase order','error');setQbSyncing(false);return}
      for(const group of poGroups){
        if(group.invalidReason){log.details.push(group.poId+' — BLOCKED: '+group.invalidReason);log.status='partial';continue}
        const vendorName=group.vendor;
        if(!vendorName){log.details.push(group.poId+' — skipped: no vendor name');log.status='partial';continue}
        const poDate=parseQBDateValue(group.created_at);
        if(!poDate){log.details.push(group.poId+' — BLOCKED: purchase-order date could not be converted to a QBO date');log.status='partial';continue}
        // Find or create vendor in QB
        let v=vend.find(x=>x.name===vendorName)||D_V.find(x=>x.name===vendorName);
        let qbVendorId=vendorQBMap[vendorName]||v?.qb_vendor_id;
        if(!qbVendorId){
          // Check existing QB vendors by name
          const vendorMatches=existingQBVendors.filter(q=>q.DisplayName===vendorName||q.CompanyName===vendorName);
          if(vendorMatches.length>1){log.details.push(group.poId+' — BLOCKED: multiple QBO vendors exactly match "'+vendorName+'"');log.status='partial';continue}
          const match=vendorMatches[0];
          if(match){qbVendorId=match.Id}
          else{
            if(canary){log.details.push(group.poId+' — BLOCKED: vendor "'+vendorName+'" is not linked or present in QBO; the one-record test will not create a second record');log.status='error';continue}
            let vRes;
            try{vRes=await qbApi('upsert_vendor',{vendor:{DisplayName:vendorName,CompanyName:vendorName}})}
            catch(e){log.details.push(group.poId+' — vendor "'+vendorName+'" creation failed: '+e.message);log.status='partial';continue}
            if(vRes?.Vendor?.Id){qbVendorId=vRes.Vendor.Id}
            else{log.details.push(group.poId+' — vendor "'+vendorName+'" creation failed: '+(vRes?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial';continue}
          }
          vendorQBMap[vendorName]=qbVendorId;
          if(v)setVend(prev=>prev.map(vv=>vv.id===v.id?{...vv,qb_vendor_id:qbVendorId}:vv));
        }
        const effectiveProdQBMap={...(qbConfig.prodQBMap||{}),...(prodQBMapArg||{})};
        let missingSkuItem=null;
        const itemGroups=new Map();
        const qbLines=[];
        group.entries.forEach(({pl:p,so:s,it:i})=>{
          const qty=Object.entries(p).filter(([k,v])=>typeof v==='number'&&!k.startsWith('_')&&!['unit_cost','billed','tracking_numbers','vendor','drop_ship'].includes(k)&&k.match(/^[A-Z0-9]/)).reduce((a,[,v])=>a+v,0);
          const rate=p.po_type==='outside_deco'?safeNum(p.unit_cost):safeNum(i.nsa_cost);
          if(!(qty>0)||rate<0)return;
          if(group.accountKey==='deco_account'){
            qbLines.push({DetailType:'AccountBasedExpenseLineDetail',Amount:qty*rate,
              Description:i.sku+' '+i.name+' x'+qty+' @$'+rate.toFixed(2)+' (SO: '+s.id+')',
              AccountBasedExpenseLineDetail:{AccountRef:poAccountRefs.deco_account}});return;
          }
          const sku=String(i.sku||'').trim().toUpperCase();
          const productId=i.product_id||(prod.find(pp=>String(pp.sku||'').trim().toUpperCase()===sku)||{}).id;
          const itemId=effectiveProdQBMap[productId];
          if(!sku||!itemId){missingSkuItem=sku||'(blank SKU)';return}
          const entry=itemGroups.get(sku)||{sku,itemId,qty:0,amount:0,names:new Set(),soIds:new Set()};
          entry.qty+=qty;entry.amount+=qty*rate;entry.names.add(i.name);entry.soIds.add(s.id);itemGroups.set(sku,entry);
        });
        if(missingSkuItem){log.details.push(group.poId+' — BLOCKED: QBO NonInventory item missing for '+missingSkuItem);log.status='partial';continue}
        itemGroups.forEach(entry=>qbLines.push({DetailType:'ItemBasedExpenseLineDetail',Amount:Math.round(entry.amount*100)/100,
          Description:entry.sku+' '+[...entry.names].filter(Boolean).join(' / ')+' (SO: '+[...entry.soIds].join(', ')+')',
          ItemBasedExpenseLineDetail:{ItemRef:{value:String(entry.itemId)},Qty:entry.qty,UnitPrice:Math.round((entry.amount/entry.qty)*1e6)/1e6}}));
        const totalAmount=qbLines.reduce((a,l)=>a+l.Amount,0);
        if(!qbLines.length||!(totalAmount>0)){log.details.push(group.poId+' — BLOCKED: no positive purchase-order lines');log.status='partial';continue}
        const soRefs=[...new Set(group.entries.map(({so:s})=>s.id))].join(', ');
        const qbPO={
          DocNumber:group.poId,
          VendorRef:{value:qbVendorId},
          TxnDate:poDate,
          Line:qbLines,
          PrivateNote:'Portal PO for SO: '+soRefs,
          ...(poMap[group.poId]?{Id:poMap[group.poId],sparse:true}:{}),
        };
        const sameNumber=existingQBPOs.filter(existing=>String(existing.DocNumber||'')===String(group.poId));
        const exact=sameNumber.filter(existing=>String(existing.VendorRef?.value||'')===String(qbVendorId)
          &&Math.abs(safeNum(existing.TotalAmt)-totalAmount)<0.005
          &&String(existing.TxnDate||'').slice(0,10)===String(qbPO.TxnDate||'').slice(0,10));
        if(exact.length===1){
          if(canary){
            try{await verifyCanaryReadback('PurchaseOrder',exact[0].Id,{docNumber:group.poId,refField:'VendorRef',refValue:qbVendorId,total:totalAmount})}
            catch(e){log.details.push(group.poId+' — VERIFY FAILED: '+e.message);log.status='error';continue}
          }
          poMap[group.poId]=exact[0].Id;log.details.push(group.poId+' — exact existing QB PO #'+exact[0].Id+' verified');synced++;continue;
        }
        if(sameNumber.length){log.details.push(group.poId+' — BLOCKED: QBO purchase-order number exists with a different vendor, date, or total');log.status='partial';continue}
        let res;
        try{res=await qbApi('upsert_purchase_order',{purchase_order:qbPO})}
        catch(e){log.details.push(group.poId+' — FAILED: '+e.message);log.status='partial';continue}
        if(res?.PurchaseOrder?.Id){
          if(canary){
            try{
              const verified=await verifyCanaryReadback('PurchaseOrder',res.PurchaseOrder.Id,{docNumber:group.poId,refField:'VendorRef',refValue:qbVendorId,total:totalAmount});
              log.details.push('READ-BACK VERIFIED: '+group.poId+' · QBO PurchaseOrder #'+verified.Id+' · $'+safeNum(verified.TotalAmt).toFixed(2));
            }catch(e){log.details.push(group.poId+' — VERIFY FAILED: '+e.message);log.status='error';continue}
          }
          poMap[group.poId]=res.PurchaseOrder.Id;
          log.details.push(group.poId+' → QB PO #'+res.PurchaseOrder.Id+' ('+vendorName+' $'+totalAmount.toFixed(2)+', '+qbLines.length+' items)');synced++;
        }else{log.details.push(group.poId+' — FAILED: '+(res?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial'}
      }
      if(synced===0&&poGroups.length>0)log.status='error';
      log.details.unshift(synced+'/'+poGroups.length+(canary?' purchase-order canary':' purchase orders completed in this batch')+(allPoGroups.length>poGroups.length?' · '+(allPoGroups.length-poGroups.length)+' remain':''));
      setQBConfig(prev=>({...prev,...(!canary?{_purchaseOrderSyncOffset:purchaseOrderBatch.nextOffset}:{}),qbPOMap:{...prev.qbPOMap,...poMap},syncLog:[log,...prev.syncLog].slice(0,100),lastSync:new Date().toLocaleString()}));
      nf(canary?(synced?'Created/linked and verified exactly one QBO purchase order':'Purchase-order canary stopped'):(synced+' purchase orders synced to QB'),synced?'success':'error');
      setQbSyncing(false);
      return{status:synced===1?'success':'blocked',synced};
    };

    // ── SYNC ALL ──
    const syncAll=async()=>{
      if(productionSyncLocked())return;
      setQbSyncing(true);
      const custQBMap=await syncCustomers();
      // Inventory creation and quantity adjustments have their own cutover
      // controls. Routine customer/order/invoice sync must never trigger them.
      const prodQBMap={...(qbConfig.prodQBMap||{})};
      await syncSalesOrders(custQBMap,prodQBMap);
      await syncInvoices(custQBMap,prodQBMap);
      await syncPaidFromQB();
      await syncPurchaseOrders(prodQBMap);
      setQbSyncing(false);
    };

    return {syncCustomerCanary,syncCustomers,syncInvoices,syncPaidFromQB,syncBillsFromQB,syncInventory,syncInventoryAdjustmentCanary,clearInactiveProductLink,syncPortalSalesItemCanary,syncSalesOrders,syncPurchaseOrders,syncAll};
}
