import {runQBProductMigration} from './qbProductMigration';
// QuickBooks sync engine — the seven sync routines, extracted verbatim from QBPage
// so the App-level auto-sync interval can build and run them from CURRENT state at
// fire time. The old wiring called a ref that only a mounted QBPage assigned, so
// auto-sync silently did nothing until the page was visited that session — and after
// leaving the page it synced the stale snapshot captured at the last render. QBPage
// builds this same engine for its buttons: one copy of the logic, two callers.
import { mergeQBSyncLogs } from './qbLinkLedger';
import { D_V } from './constants';
import { _dbSaveSO } from './lib/dbEngine';
import { safeArt, safeDecos, safeItems, safeNum, safeSizes } from './safeHelpers';
import { QB_MAX_REVIEWED_BATCH, QB_STATE_TAX_ACCOUNT_KEYS, calculateCustomerShipping, loadAllQBEntities, loadQBAccounts, parseQBDateValue, queryQBReadOnly, resolveQBAccountRefs } from './qbAccountMappings';

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

// A second, deliberately looser key used ONLY to spot a probable duplicate before
// creating a customer. Exact matching (above) is case/space insensitive but still
// misses "Boy's" vs "Boys" and "A & B" vs "A and B", which is exactly how a second
// copy of a real customer gets created in QuickBooks. This never links anything on
// its own — a hit blocks the row and names the QBO candidate for a human to judge.
const QB_NAME_SUFFIXES = new Set(['inc', 'llc', 'lc', 'ltd', 'co', 'corp', 'company']);
export function normalizeQBDuplicateKey(value) {
  const base = String(value || '').toLowerCase()
    .replace(/&/g, ' and ')
    // Apostrophes join a word — "Boy's" is one token, not two. Dropping them before
    // the general punctuation pass is what makes "Boy's" and "Boys" the same key.
    .replace(/['\u2018\u2019\u02bc`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const tokens = base.split(' ').filter(Boolean);
  while (tokens.length > 1 && QB_NAME_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length > 1 && tokens[0] === 'the') tokens.shift();
  return tokens.join(' ');
}

// Candidates are QBO customers whose loose key equals the portal customer's, after
// exact matching already failed. Inactive QBO records are ignored.
export function findQBDuplicateCandidates(customer, qboCustomers = []) {
  const keys = new Set([
    normalizeQBDuplicateKey(customer?.name),
    normalizeQBDuplicateKey(portalCustomerDisplayName(customer)),
  ].filter(Boolean));
  if (!keys.size) return [];
  const hits = (qboCustomers || []).filter(qbo => {
    if (!qbo || qbo.Active === false) return false;
    return keys.has(normalizeQBDuplicateKey(qbo.DisplayName)) || keys.has(normalizeQBDuplicateKey(qbo.CompanyName));
  });
  return [...new Map(hits.map(hit => [String(hit.Id), hit])).values()];
}

// Read-only. Answers one question the counters cannot: are the QBO customers we are
// failing to match actually the same accounts under different names, or a different
// population entirely? Samples real QBO names so the answer is visible, not guessed.
export function buildQBCustomerMatchDiagnostic(customers = [], qboCustomers = [], savedMap = {}, sampleSize = 40) {
  const activeQBO = (qboCustomers || []).filter(qbo => qbo && qbo.Active !== false);
  const claimed = new Set();
  (customers || []).forEach(customer => {
    const saved = String(savedMap[customer?.id] || customer?.qb_customer_id || '');
    if (saved) claimed.add(saved);
    findExactQBCustomerMatches(customer, activeQBO).forEach(match => claimed.add(String(match.Id)));
    findQBDuplicateCandidates(customer, activeQBO).forEach(match => claimed.add(String(match.Id)));
  });
  const unclaimed = activeQBO.filter(qbo => !claimed.has(String(qbo.Id)));
  const unmatchedPortal = (customers || []).filter(customer =>
    customer?.is_active !== false && !customer?.deleted_at
    && !String(savedMap[customer.id] || customer.qb_customer_id || '')
    && !findExactQBCustomerMatches(customer, activeQBO).length
    && !findQBDuplicateCandidates(customer, activeQBO).length);
  const size = Math.max(1, Math.min(200, Number(sampleSize) || 40));
  return {
    qboActive: activeQBO.length,
    qboClaimed: claimed.size,
    qboUnclaimed: unclaimed.length,
    portalActive: (customers || []).filter(c => c?.is_active !== false && !c?.deleted_at).length,
    portalUnmatched: unmatchedPortal.length,
    qboUnclaimedSample: unclaimed.slice(0, size).map(qbo => ({
      id: String(qbo.Id), displayName: qbo.DisplayName || '', companyName: qbo.CompanyName || '',
    })),
    portalUnmatchedSample: unmatchedPortal.slice(0, size).map(customer => ({
      sourceId: String(customer.id), name: customer.name || '', displayName: portalCustomerDisplayName(customer),
    })),
  };
}
const qbCurrency = value => Math.round((safeNum(value) + Number.EPSILON) * 100) / 100;

export function qbResponseErrorDetail(response, fallback = 'unknown') {
  return response?.Fault?.Error?.[0]?.Detail || response?.Fault?.Error?.[0]?.Message ||
    response?.error || response?.message || fallback;
}

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

// Blank portal terms are common (most portal customers never had terms set) and
// the portal itself bills them on Net 30. The review still never guesses a
// financial term on its own: an existing QBO customer keeps the terms it already
// has (no write), and a new customer only gets the reviewer's explicitly chosen
// default. Anything else stays blocked.
export function normalizeBlankTermsDefault(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return portalCustomerTermSpec(raw).portalValue;
}

// Read-only plan: every source is classified before any customer batch writes.
export function buildQBCustomerManifest(customers = [], qboCustomers = [], terms = [], savedMap = {}, options = {}) {
  const blankTermsDefault = normalizeBlankTermsDefault(options.blankTermsDefault);
  const activeTermById = new Map((terms || []).filter(term => term && term.Active !== false && term.Id)
    .map(term => [String(term.Id), term]));
  const rows = customers.map(customer => {
    const row = {sourceId:String(customer.id || ''),name:customer.name || '',displayName:portalCustomerDisplayName(customer),
      portalTerms:customer.payment_terms || '',qboId:'',action:'blocked',reason:'',termSource:'portal'};
    if(customer.is_active === false || customer.deleted_at)return {...row,action:'excluded',reason:'Inactive or deleted portal customer'};
    try {
      if(!row.sourceId || !String(customer.name || '').trim())throw new Error('Missing customer ID or name');
      const mapped = String(savedMap[customer.id] || '');
      const embedded = String(customer.qb_customer_id || '');
      if(mapped && embedded && mapped !== embedded)throw new Error('Conflicting saved customer IDs');
      const savedId = mapped || embedded;
      const matches = findExactQBCustomerMatches(customer,qboCustomers);
      if(matches.length > 1)throw new Error('Multiple exact QBO customer matches');
      const existing = savedId ? qboCustomers.find(q=>String(q.Id) === savedId) : matches[0];
      if(savedId && !existing)throw new Error('Saved QBO customer was not returned; audit its ID before relinking');
      if(existing?.Active === false)throw new Error('Saved QBO customer is inactive');
      if(existing && matches.length === 1 && String(matches[0].Id) !== String(existing.Id))throw new Error('Saved ID conflicts with exact name match');
      if(existing && !matches.some(q=>String(q.Id) === String(existing.Id)))throw new Error('Saved QBO customer name does not match portal identity');
      // Record the match BEFORE resolving terms. A terms problem must never make a
      // matched customer look unmatched: reporting the identity we found is what tells
      // the reviewer whether a blocked row is a naming failure or only a terms gap.
      if(existing){
        row.qboId = String(existing.Id);
        row.currentTerm = existing.SalesTermRef || null;
      }
      const portalTerms = String(customer.payment_terms || '').trim();
      const existingTerm = existing ? activeTermById.get(String(existing.SalesTermRef?.value || '')) : null;
      let term, termNote = '';
      if(portalTerms){
        term = resolveQBCustomerTerm(terms,portalTerms);
      }else if(existingTerm){
        term = { value:String(existingTerm.Id), name:String(existingTerm.Name || '') };
        row.termSource = 'qbo';termNote = '; portal terms blank, keeping QBO terms ' + term.name;
      }else if(blankTermsDefault){
        term = resolveQBCustomerTerm(terms,blankTermsDefault);
        row.termSource = 'default';termNote = '; portal terms blank, reviewer default ' + term.name;
      }else throw new Error(existing
        ? 'Matched QBO customer #' + existing.Id + ', but neither the Portal nor QBO has payment terms; choose a default to link it and set them'
        : 'Missing portal payment terms; no default is assumed');
      row.desiredTerm = term;
      if(!existing){
        // Never create a second copy of a customer QBO already has under a name that
        // differs only by punctuation, "and"/"&", or a company suffix.
        const nearby = findQBDuplicateCandidates(customer,qboCustomers);
        if(nearby.length)throw new Error('Possible existing QBO customer '
          + nearby.map(hit=>'"' + (hit.DisplayName || hit.CompanyName || '') + '" (#' + hit.Id + ')').join(', ')
          + '; link or rename it before creating a second record');
        return {...row,action:'create',reason:'Requires explicit creation approval' + termNote};
      }
      row.action = String(existing.SalesTermRef?.value || '') === term.value ? 'link' : 'update_terms';
      row.reason = (row.action === 'link' ? 'Existing active customer; terms match' : 'Requires explicit term-change approval') + termNote;
      return row;
    }catch(error){return {...row,action:'blocked',reason:error.message};}
  });
  const names = new Map(), ids = new Map();
  rows.filter(row=>!['excluded','blocked'].includes(row.action)).forEach(row=>{
    const name = normalizeQBCustomerName(row.displayName);
    names.set(name,[...(names.get(name)||[]),row]);
    if(row.qboId)ids.set(row.qboId,[...(ids.get(row.qboId)||[]),row]);
  });
  [...names.values(),...ids.values()].filter(group=>group.length>1).forEach(group=>group.forEach(row=>{
    row.action='blocked';row.reason='Multiple portal customers claim the same display name or QBO customer';
  }));
  return rows;
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

export function buildQBPurchaseOrderPreviewRows(sos = [], products = [], prodQBMap = {}, poMap = {}) {
  const productIdBySku = new Map(products.map(product => [String(product.sku || '').trim().toUpperCase(), product.id]));
  return groupPortalPurchaseOrders(sos, poMap).map(group => {
    const reasons = new Set(group.invalidReason ? [group.invalidReason] : []);
    if (!String(group.vendor || '').trim()) reasons.add('missing saved vendor');
    if (!parseQBDateValue(group.created_at)) reasons.add('invalid or missing PO date');
    let total = 0;
    const skus = new Set();
    group.entries.forEach(({pl, it}) => {
      const qty = Object.entries(pl || {}).filter(([key,value]) => typeof value === 'number'
        && !key.startsWith('_') && !['unit_cost','billed','tracking_numbers','vendor','drop_ship'].includes(key)
        && /^[A-Z0-9]/.test(key)).reduce((sum,[,value]) => sum + value, 0);
      const rate = qbCurrency(pl?.unit_cost !== undefined && pl?.unit_cost !== null && pl?.unit_cost !== '' ? pl.unit_cost : it?.nsa_cost);
      if (!(qty > 0) || rate < 0) return;
      total += qty * rate;
      if (group.accountKey === 'deco_account') return;
      const sku = String(it?.sku || '').trim().toUpperCase();
      const productId = it?.product_id || productIdBySku.get(sku);
      skus.add(sku || '(blank SKU)');
      if (!sku || !productId || !prodQBMap[productId]) reasons.add('missing QBO NonInventory item for ' + (sku || '(blank SKU)'));
    });
    total = qbCurrency(total);
    if (!(total > 0)) reasons.add('no positive purchase-order lines');
    return {poId:String(group.poId),vendor:String(group.vendor || ''),date:parseQBDateValue(group.created_at) || '',
      lineCount:group.entries.length,skus:[...skus],total,action:reasons.size ? 'blocked' : 'ready',reason:[...reasons].join('; ')};
  });
}

// QBO cannot be queried by LinkedTxn, so both payment directions read the customer's
// payments and pick out the lines applied to one invoice. Shared so the push preflight
// and the pull cannot drift apart.
export function qbPaymentsAppliedToInvoice(payments = [], qbInvoiceId) {
  const target = String(qbInvoiceId || '');
  if (!target) return [];
  return (payments || []).map(payment => {
    const amount = (payment?.Line || [])
      .filter(line => (line?.LinkedTxn || []).some(link => link?.TxnType === 'Invoice' && String(link.TxnId) === target))
      .reduce((sum, line) => sum + safeNum(line.Amount), 0);
    return amount > 0 ? { id: String(payment.Id || ''), date: String(payment.TxnDate || ''), amount: Math.round(amount * 100) / 100 } : null;
  }).filter(row => row && row.id);
}

export function qbLinkedTransactions(entity = {}) {
  return [...(entity.LinkedTxn || []), ...(entity.Line || []).flatMap(line => line.LinkedTxn || [])];
}

export function billReferencesPortalPO(bill = {}, portalPOId = '') {
  const note = String(bill.PrivateNote || '');
  const wanted = String(portalPOId || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!wanted) return false;
  return note.split('|').some(part => {
    const match = part.trim().match(/^PO\s*:\s*(.+)$/i);
    return match && match[1].trim().toLowerCase().replace(/\s+/g, ' ') === wanted;
  });
}

export function findQbPOBillCandidates(bills = [], portalPOId, qboPOId) {
  return (bills || []).filter(bill => billReferencesPortalPO(bill, portalPOId)
    || qbLinkedTransactions(bill).some(link => link.TxnType === 'PurchaseOrder' && String(link.TxnId) === String(qboPOId)));
}

const qbLineRef = line => line.ItemBasedExpenseLineDetail?.ItemRef?.value
  ? 'item:'+line.ItemBasedExpenseLineDetail.ItemRef.value
  : line.AccountBasedExpenseLineDetail?.AccountRef?.value
    ? 'account:'+line.AccountBasedExpenseLineDetail.AccountRef.value : '';

export function buildQBBillPOReplacement({bill, purchaseOrder}) {
  if(!bill?.Id||!bill.SyncToken)throw new Error('Bill ID and SyncToken are required.');
  if(Math.abs(safeNum(bill.Balance)-safeNum(bill.TotalAmt))>=0.005)throw new Error('Partially paid or closed bills cannot be linked automatically.');
  if(String(purchaseOrder?.POStatus||'').toLowerCase()!=='open')throw new Error('Purchase order is not open.');
  if(qbLinkedTransactions(bill).some(link=>link.TxnType==='PurchaseOrder'))throw new Error('Bill already has a purchase-order link.');
  if(qbLinkedTransactions(purchaseOrder).some(link=>link.TxnType==='Bill'))throw new Error('Purchase order already has a bill link.');
  const billLines=[...(bill.Line||[])],remaining=new Set(billLines.map((_,index)=>index));
  const replacements=new Map();
  (purchaseOrder.Line||[]).filter(line=>line.Id&&qbLineRef(line)).forEach(poLine=>{
    const ref=qbLineRef(poLine);
    const matches=[...remaining].filter(index=>{
      const line=billLines[index];
      if(qbLineRef(line)!==ref||qbLinkedTransactions(line).length)return false;
      if(ref.startsWith('item:'))return Math.abs(safeNum(line.ItemBasedExpenseLineDetail?.Qty)-safeNum(poLine.ItemBasedExpenseLineDetail?.Qty))<0.000001;
      return true;
    });
    if(matches.length!==1)throw new Error(matches.length?'Bill has ambiguous lines for PO line '+poLine.Id:'Bill is missing a line for PO line '+poLine.Id+'.');
    const index=matches[0],source=billLines[index];remaining.delete(index);
    const {Id,LineNum,...copy}=source;
    replacements.set(index,{...copy,LinkedTxn:[{TxnId:String(purchaseOrder.Id),TxnType:'PurchaseOrder',TxnLineId:String(poLine.Id)}]});
  });
  if(!replacements.size)throw new Error('Purchase order has no linkable expense lines.');
  const Line=billLines.map((line,index)=>replacements.get(index)||line);
  if(Math.abs(Line.reduce((sum,line)=>sum+safeNum(line.Amount),0)-safeNum(bill.TotalAmt))>=0.005)throw new Error('Replacement lines would change the bill total.');
  const writable=['Id','SyncToken','VendorRef','APAccountRef','TxnDate','DueDate','DocNumber','PrivateNote','SalesTermRef','DepartmentRef','CurrencyRef','ExchangeRate','GlobalTaxCalculation'];
  return{...Object.fromEntries(writable.filter(key=>bill[key]!==undefined).map(key=>[key,bill[key]])),Line,sparse:false};
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
  const {cust,sos,invs,prod,vend,invAdjLog=[],invPOs,submittedBatches,qbApi,qbConfig,persistQbLink,nf,dP,
    setQBConfig,setQbSyncing,setInvs,setInvPOs,setSOs,setSubmittedBatches,setVend}=ctx;
    const QB_SYNC_BATCH_SIZE=20;
    const requireDurableLinks=()=>{
      if(typeof persistQbLink==='function')return true;
      nf('Durable QBO link storage is unavailable; no migration record was sent','error');return false;
    };
    const migrationBatchLocked=()=>{
      nf('Migration batches remain locked until durable links survive reload and fresh login, and this entity rollout is reviewed','error');
      return true;
    };

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
      if(expected.txnDate!=null&&String(row.TxnDate||'').slice(0,10)!==String(expected.txnDate))throw new Error(entity+' date did not match on API read-back.');
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
        setQBConfig(prev=>({...prev,_portalSalesItemId:itemId,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])]),lastSync:new Date().toLocaleString()}));
        nf('Verified NSA Portal Sales in QBO','success');
        setQbSyncing(false);
        return{status:'success',itemId};
      }catch(e){
        log.status='error';log.details.push(e.message||'NSA Portal Sales item test failed');
        setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));
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

    // Manual sales tax, one state at a time. Two things about QBO manual tax are
    // unknown until a real record exists, and this canary is how we find out rather
    // than assume: which liability account QBO assigns to a new agency (the portal's
    // approved matrix expects 25200/25230, but QBO may insist on its own Sales Tax
    // Payable), and whether one rate per state can carry the portal's own per-invoice
    // amount when the portal holds 39 distinct local rates. It creates exactly one
    // agency and one tax code, reads both back, and reports what QBO actually did.
    const syncTaxRateCanary=async({state,rateName,ratePercent,agencyName,allowCreate=false}={})=>{
      if(!canaryPreflightReady())return{status:'blocked'};
      if(!requireDurableLinks())return{status:'blocked'};
      const code=String(state||'').trim().toUpperCase();
      const accountKey=QB_STATE_TAX_ACCOUNT_KEYS[code];
      if(!accountKey){nf('Choose a state with an approved tax account','error');return{status:'blocked'}}
      const percent=Number(ratePercent);
      if(!Number.isFinite(percent)||percent<=0||percent>25){nf('Enter a tax rate between 0 and 25 percent','error');return{status:'blocked'}}
      const agency=String(agencyName||'').trim(), rate=String(rateName||'').trim();
      if(!agency||!rate){nf('Name the tax agency and the tax rate','error');return{status:'blocked'}}
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:'tax_rate_canary',status:'success',details:[]};
      try{
        const prefs=await queryQBReadOnly(qbApi,'SELECT * FROM Preferences','tax preferences recheck');
        const taxPrefs=prefs?.QueryResponse?.Preferences?.[0]?.TaxPrefs||{};
        if(taxPrefs.PartnerTaxEnabled)throw new Error('QBO Automated Sales Tax is enabled; manual rates are not the right mechanism. Nothing was created.');
        const existingAgencies=await loadAllQBEntities(qbApi,'TaxAgency','*',100);
        const agencyMatches=existingAgencies.filter(row=>normalizeQBCustomerName(row.DisplayName)===normalizeQBCustomerName(agency));
        if(agencyMatches.length>1)throw new Error('Multiple QBO tax agencies are named "'+agency+'"; nothing was created.');
        const existingCodes=await loadAllQBEntities(qbApi,'TaxCode','*',100);
        if(existingCodes.some(row=>normalizeQBCustomerName(row.Name)===normalizeQBCustomerName(rate)))
          throw new Error('A QBO tax code named "'+rate+'" already exists; nothing was created.');
        if(!allowCreate)return{status:'needs_confirmation',state:code,agency,rate,percent,
          agencyExists:agencyMatches.length===1,agencyId:agencyMatches[0]?.Id?String(agencyMatches[0].Id):''};

        let agencyId=agencyMatches[0]?.Id?String(agencyMatches[0].Id):'';
        if(!agencyId){
          const created=await qbApi('upsert_taxagency',{taxagency:{DisplayName:agency}});
          agencyId=String(created?.TaxAgency?.Id||'');
          if(!agencyId)throw new Error(qbResponseErrorDetail(created,'QBO did not return a tax agency ID'));
          log.details.push('CREATED ONE QBO TAX AGENCY: '+agency+' → #'+agencyId);
        }else log.details.push('REUSED EXISTING QBO TAX AGENCY: '+agency+' → #'+agencyId);

        const response=await qbApi('create_taxcode',{taxcode:{TaxCode:rate,
          TaxRateDetails:[{TaxRateName:rate,RateValue:percent,TaxAgencyId:agencyId,TaxApplicableOn:'Sales'}]}});
        const taxCodeId=String(response?.TaxCodeId||response?.TaxCode?.Id||'');
        const rateId=String(response?.TaxRateDetails?.[0]?.TaxRateId||'');
        if(!taxCodeId||!rateId)throw new Error(qbResponseErrorDetail(response,'QBO did not return a tax code and rate ID'));

        const verifiedRate=(await loadAllQBEntities(qbApi,'TaxRate','*',100)).find(row=>String(row.Id)===rateId);
        if(!verifiedRate)throw new Error('Tax rate #'+rateId+' was not returned by API read-back; no link was saved.');
        if(Math.abs(Number(verifiedRate.RateValue)-percent)>0.0001)throw new Error('QBO stored rate '+verifiedRate.RateValue+'%, not '+percent+'%; no link was saved.');
        const verifiedCode=(await loadAllQBEntities(qbApi,'TaxCode','*',100)).find(row=>String(row.Id)===taxCodeId);
        if(!verifiedCode||verifiedCode.Active===false)throw new Error('Tax code #'+taxCodeId+' was missing or inactive on read-back; no link was saved.');

        // The liability account QBO chose is the answer the approved posting matrix needs.
        const qboAccountId=String(verifiedRate.AgencyRef?.value||agencyId);
        log.details.push('READ-BACK VERIFIED: TaxCode #'+taxCodeId+' · TaxRate #'+rateId+' · '+verifiedRate.RateValue+'% · agency #'+qboAccountId);
        // Reporting only, and deliberately non-fatal: the rate exists and is verified by
        // this point, so a chart-mapping problem must not discard the proof of a write
        // that already happened. A failure here is reported, not thrown.
        let approvedAccount='';
        try{
          const approved=resolveQBAccountRefs(await loadQBAccounts(qbApi),qbConfig.mapping,[accountKey])[accountKey];
          approvedAccount=approved.accountNumber;
          log.details.push('Portal-approved '+code+' liability account is '+approved.accountNumber+' '+approved.name+' (QB #'+approved.value+'). QBO manual sales tax posts through its own agency-managed account, so confirm on the first taxable invoice which account actually moves before relying on the matrix.');
        }catch(accountError){
          log.status='partial';
          log.details.push('Tax rate was created and verified, but the approved '+code+' liability account could not be resolved: '+accountError.message+'. Confirm on the first taxable invoice which account actually moves.');
        }
        await persistQbLink({mapKey:'qbTaxRateMap',sourceIds:[code],qboId:rateId,log,
          evidence:{state:code,result:'created',tax_code_id:taxCodeId,tax_rate_id:rateId,agency_id:agencyId,
            rate_percent:verifiedRate.RateValue,approved_account:approvedAccount||null,api_readback:true}});
        setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])]),lastSync:new Date().toLocaleString()}));
        nf('Created and verified one QBO tax rate for '+code);
        return{status:'success',state:code,taxCodeId,rateId,agencyId,ratePercent:verifiedRate.RateValue};
      }catch(e){
        log.status='error';log.details.push(e.message||'Tax rate canary failed');
        setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));
        nf('Tax rate setup stopped — '+(e.message||'QBO error'),'error');
        return{status:'blocked',error:e.message};
      }finally{setQbSyncing(false)}
    };

    // One-customer canary is intentionally available while production batches
    // are locked. A create or a repair of the actual QBO Terms field requires a
    // second, explicit operator confirmation and a successful API read-back.
    const syncCustomerCanary=async(customerId,{allowCreate=false,allowTermUpdate=false,batchId='',expectedPlan=null,blankTermsDefault='',context=null}={})=>{
      if(!requireDurableLinks())return{status:'blocked'};
      const c=cust.find(customer=>String(customer.id)===String(customerId));
      if(!c||c.is_active===false||c.deleted_at){nf('Choose an active customer for the QBO test','error');return{status:'blocked'}}
      if(qbConfig.preflight?.status!=='success'||String(qbConfig.preflight?.realm_id||'')!==String(qbConfig.realm_id||'')){
        nf('Run the read-only live QBO preflight before testing a customer','error');return{status:'blocked'};
      }
      if(!batchId)setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:batchId?'customer_batch_record':'customer_canary',status:'success',details:[]};
      try{
        // A batch hoists the term and customer reads and the plan build out of its loop:
        // re-reading every QBO customer and rebuilding all 2,500 plans per record is
        // quadratic and is what forced the old 20-record cap. Correctness does not rest
        // on that reload — the per-record API read-back after the write does — and the
        // batch keeps its snapshot current by folding each verified record back into it.
        const qboTerms=context?.terms
          || await loadAllQBEntities(qbApi,'Term','Id, Name, Active, Type, DueDays',1000);
        const qboCustomers=context?.customers
          || await loadAllQBEntities(qbApi,'Customer','Id, DisplayName, CompanyName, Active, SyncToken, SalesTermRef',1000);
        const currentPlan=context?.planBySource
          ? context.planBySource.get(String(c.id))
          : buildQBCustomerManifest(cust,qboCustomers,qboTerms,qbConfig.custQBMap||{},{blankTermsDefault}).find(row=>row.sourceId===String(c.id));
        if(!currentPlan||['blocked','excluded'].includes(currentPlan.action))throw new Error(currentPlan?.reason||'Customer could not be reviewed');
        if(expectedPlan && ['sourceId','displayName','portalTerms','qboId','action','termSource'].some(key=>currentPlan[key]!==expectedPlan[key]))throw new Error('Customer plan changed since review; refresh the manifest before continuing');
        if(expectedPlan && (String(currentPlan.desiredTerm?.value)!==String(expectedPlan.desiredTerm?.value)||String(currentPlan.currentTerm?.value)!==String(expectedPlan.currentTerm?.value)))throw new Error('QBO term mapping changed since review');
        // The reviewed plan is the only source of the term: portal terms, the
        // existing QBO customer's own terms, or the reviewer's explicit default.
        const termRef=currentPlan.desiredTerm;
        if(!termRef?.value)throw new Error('Reviewed plan has no QBO term; no customer was changed.');
        const savedId=String((qbConfig.custQBMap||{})[c.id]||c.qb_customer_id||'');
        let qboCustomer=savedId?qboCustomers.find(row=>String(row.Id)===savedId):null;
        if(qboCustomer?.Active===false)throw new Error('Saved QBO customer #'+savedId+' is inactive; no record was changed.');
        if(savedId&&!qboCustomer)throw new Error('Saved QBO customer #'+savedId+' was not returned; query and review it before relinking.');
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
        if(verified.Active===false)throw new Error('QBO customer was inactive on read-back; the portal link was not saved.');
        if(String(verified.SalesTermRef?.value||'')!==String(termRef.value))throw new Error('QBO customer terms did not match "'+termRef.name+'" on read-back; the portal link was not saved.');
        if(!findExactQBCustomerMatches(c,[verified]).length)throw new Error('Customer identity did not match on API read-back');
        if(context?.customers){
          const at=context.customers.findIndex(row=>String(row.Id)===qbId);
          if(at>=0)context.customers[at]=verified; else context.customers.push(verified);
        }
        log.details.push((created?'CREATED ONE QBO CUSTOMER':termsUpdated?'UPDATED ONE QBO CUSTOMER':'LINK ONLY — no QBO customer was changed')+': '+c.name+' → QB #'+qbId);
        if(currentPlan.termSource==='qbo')log.details.push('PORTAL TERMS BLANK — kept existing QBO terms '+(termRef.name||termRef.value));
        if(currentPlan.termSource==='default')log.details.push('PORTAL TERMS BLANK — reviewer default '+(termRef.name||termRef.value)+' applied');
        if(termsUpdated)log.details.push('UPDATED ONE QBO CUSTOMER TERM: '+(termRef.name||termRef.value));
        log.details.push('READ-BACK VERIFIED: '+(verified.DisplayName||verified.CompanyName||c.name)+(verified.SalesTermRef?.name?' · QBO terms '+verified.SalesTermRef.name:verified.SalesTermRef?.value?' · QBO terms ID '+verified.SalesTermRef.value:''));
        await persistQbLink({mapKey:'custQBMap',sourceIds:[c.id],qboId:qbId,log,evidence:{batch_id:batchId||null,result:created?'created':termsUpdated?'updated':'linked',term_id:termRef.value,term_source:currentPlan.termSource||'portal',duplicate_preflight:'verified',api_readback:true}});
        setQBConfig(prev=>({...prev,custQBMap:{...(prev.custQBMap||{}),[c.id]:qbId},syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])]),lastSync:new Date().toLocaleString()}));
        nf((created?'Created and verified ':termsUpdated?'Updated terms and verified ':'Linked and verified ')+c.name+' in QBO');
        return{status:'success',created,termsUpdated,qbId,customerName:c.name};
      }catch(e){
        log.status='error';log.details.push(e.message||'Customer canary failed');
        setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));
        nf('Customer test stopped — '+(e.message||'unknown error'),'error');
        return{status:'blocked',error:e.message};
      }finally{if(!batchId)setQbSyncing(false)}
    };

    // Explicitly reviewed, sequential customer batches. Every record reuses
    // the canary's fresh duplicate check, minimal write, read-back and receipt.
    const syncCustomers=async({manifest,approved=false}={})=>{
      const rows=manifest?.rows;
      const age=Date.now()-Date.parse(manifest?.reviewedAt||'');
      let blankTermsDefault='';
      try{blankTermsDefault=normalizeBlankTermsDefault(manifest?.blankTermsDefault);}
      catch(e){nf('Customer batch blocked: '+e.message,'error');return{status:'blocked'};}
      const canaryLogs=(qbConfig.syncLog||[]).filter(log=>log.type==='customer_canary'&&log.status==='success');
      // Accept the durable receipt as well as the log entry: syncLog holds only the
      // newest 100 events, so this control expired on its own as other work accrued.
      const termCanary=!!qbConfig.custTermCanaryVerifiedAt
        ||canaryLogs.some(log=>(log.details||[]).some(detail=>String(detail).startsWith('UPDATED ONE QBO CUSTOMER TERM:')));
      if(!approved||!Array.isArray(rows)||rows.length<1||rows.length>QB_MAX_REVIEWED_BATCH
        ||new Set(rows.map(row=>row.sourceId)).size!==rows.length
        ||rows.some(row=>!['link','create','update_terms'].includes(row.action))
        ||String(manifest.realm)!==String(qbConfig.realm_id)||!Number.isFinite(age)||age<0||age>15*60*1000
        ||!termCanary||Object.keys(qbConfig.custQBMap||{}).length<2){
        nf('Customer batch blocked: complete canaries and approve a fresh review of at most '+QB_MAX_REVIEWED_BATCH+' customers','error');return{status:'blocked'};
      }
      if(!requireDurableLinks())return{status:'blocked'};
      const report={id:'customer-batch-'+new Date().toISOString(),realm:manifest.realm,reviewedAt:manifest.reviewedAt,blankTermsDefault,
        startedAt:new Date().toISOString(),status:'running',results:[],counts:{created:0,updated:0,linked:0,blocked:0,not_attempted:0}};
      setQbSyncing(true);
      try{
        // One read of terms and customers, one plan build, for the whole run.
        const terms=await loadAllQBEntities(qbApi,'Term','Id, Name, Active, Type, DueDays',1000);
        const customers=await loadAllQBEntities(qbApi,'Customer','Id, DisplayName, CompanyName, Active, SyncToken, SalesTermRef',1000);
        const planBySource=new Map(buildQBCustomerManifest(cust,customers,terms,qbConfig.custQBMap||{},{blankTermsDefault})
          .map(row=>[String(row.sourceId),row]));
        const context={terms,customers,planBySource};
        let stopped=false;
        for(const row of rows){
          if(stopped){report.results.push({...row,result:'not_attempted'});report.counts.not_attempted++;continue;}
          const outcome=await syncCustomerCanary(row.sourceId,{batchId:report.id,expectedPlan:row,blankTermsDefault,context,
            allowCreate:row.action==='create',allowTermUpdate:row.action==='update_terms'});
          const result=outcome.status==='success'?(outcome.created?'created':outcome.termsUpdated?'updated':'linked'):'blocked';
          report.results.push({...row,result,qboId:outcome.qbId||row.qboId,apiReadback:outcome.status==='success',reason:outcome.error||row.reason});
          report.counts[result]++;
          if(result==='blocked')stopped=true;
          setQBConfig(prev=>({...prev,lastCustomerBatch:JSON.parse(JSON.stringify(report))}));
        }
        report.status=report.counts.blocked?'stopped':'success';report.finishedAt=new Date().toISOString();
        const log={ts:new Date().toLocaleString(),type:'customer_batch',status:report.status==='success'?'success':'error',
          details:[report.id,JSON.stringify(report.counts),'Per-customer API read-back and durable receipts are recorded before success.']};
        setQBConfig(prev=>({...prev,lastCustomerBatch:report,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));
        nf('Customer batch '+report.status+' — review the reconciliation report');
        return report;
      }finally{setQbSyncing(false)}
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
        setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));nf('Invoice sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return;
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
              if(verified.Active===false)throw new Error('QBO customer was inactive on read-back; the portal link was not saved.');
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
      setQBConfig(prev=>({...prev,...(!canary?{_invoiceSyncOffset:invoiceBatch.nextOffset}:{}),syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])]),lastSync:new Date().toLocaleString()}));
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
      if(linkedInvs.length===0){log.details.push('No QB-linked invoices to check');setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));nf('No invoices to sync');setQbSyncing(false);return}
      let paidRefs,salesItemId;
      try{
        paidRefs=await requiredAccountRefs(['income_account','discount_account','ar_account','payment_deposit_account']);
        salesItemId=await ensurePortalSalesItem(paidRefs.income_account);
      }catch(e){
        log.status='error';log.details.push(e.message||'Required payment account could not be resolved');
        setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));nf('Paid sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return;
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
            // QB has more paid — pull to portal. Checks are entered in QBO, so this is
            // the main way customer money reaches the Portal. The date recorded here is
            // a commission input: CommissionsPage rates a line at 15% instead of 30%
            // when days-to-pay exceeds 90, and freezes that the first time it renders.
            // Stamping today's date on a check received weeks ago therefore underpays
            // the rep, so the real QBO payment date is read and a missing one blocks.
            const docId=inv.display_id||inv.id;
            const cQBId=inv.qb_customer_id||(qbConfig.custQBMap||{})[inv.customer_id];
            if(!cQBId){log.details.push(docId+' — pull BLOCKED: customer is not linked, so QBO payment dates cannot be read');log.status='partial';continue}
            let applied=[];
            try{
              const paymentRes=await queryQBReadOnly(qbApi,"SELECT * FROM Payment WHERE CustomerRef = '"+String(cQBId).replace(/'/g,"\\'")+"' MAXRESULTS 1000",'payment pull read');
              applied=qbPaymentsAppliedToInvoice(paymentRes?.QueryResponse?.Payment||[],inv.qb_invoice_id);
            }catch(pe){log.details.push(docId+' — pull BLOCKED: '+(pe.message||'QBO payment read failed'));log.status='partial';continue}
            if(!applied.length){log.details.push(docId+' — pull BLOCKED: QBO shows $'+qbPaid.toFixed(2)+' paid but no payment record references this invoice');log.status='partial';continue}
            const undated=applied.filter(row=>!/^\d{4}-\d{2}-\d{2}/.test(row.date));
            if(undated.length){log.details.push(docId+' — pull BLOCKED: QBO Payment #'+undated[0].id+' has no usable date, and a guessed date would change the rep commission rate');log.status='partial';continue}
            const known=new Set((inv.payments||[]).map(existing=>String(existing.ref||'')));
            const fresh=applied.filter(row=>!known.has('QBO Payment #'+row.id));
            const newStatus=qbBalance<=0?'paid':qbPaid>0?'partial':'open';
            setInvs(prev=>prev.map(ii=>ii.id===inv.id?{...ii,paid:Math.round(qbPaid*100)/100,status:newStatus,
              payments:[...(ii.payments||[]),...fresh.map(row=>({amount:row.amount,method:'qb_sync',ref:'QBO Payment #'+row.id,date:row.date}))]}:ii));
            log.details.push(docId+' — marked '+newStatus+' (QB paid $'+qbPaid.toFixed(2)+')'
              +(fresh.length?' · recorded '+fresh.map(row=>'QBO Payment #'+row.id+' $'+row.amount.toFixed(2)+' dated '+row.date).join(', '):' · no new QBO payment rows'));
            updated++;
          }else if(portalPaid>qbPaid&&qbBalance>0){
            // Portal has more paid — push payment to QB. This is the only place the
            // portal moves cash into QBO, so it carries the same proof every other
            // write does: a duplicate preflight against QBO's own payments, a checked
            // response, an API read-back of the created record, and a durable receipt.
            const diff=Math.round((portalPaid-qbPaid)*100)/100;
            const cQBId=inv.qb_customer_id||(qbConfig.custQBMap||{})[inv.customer_id];
            const docId=inv.display_id||inv.id;
            if(!cQBId){log.details.push(docId+' — skipped push: customer not synced to QB');continue}
            if(!requireDurableLinks()){log.details.push(docId+' — BLOCKED: durable receipt storage unavailable; no payment was sent');log.status='partial';continue}
            try{
              // Never send a second payment for money QBO already records against this
              // invoice. QBO cannot be queried by LinkedTxn, so read the customer's
              // payments and total the lines that point at this invoice.
              const existing=await queryQBReadOnly(qbApi,"SELECT * FROM Payment WHERE CustomerRef = '"+String(cQBId).replace(/'/g,"\\'")+"' MAXRESULTS 1000",'existing payment preflight');
              const linkedTotal=qbPaymentsAppliedToInvoice(existing?.QueryResponse?.Payment||[],inv.qb_invoice_id)
                .reduce((sum,row)=>sum+row.amount,0);
              if(linkedTotal>=portalPaid-0.005){
                log.details.push(docId+' — no payment sent: QBO already records $'+linkedTotal.toFixed(2)+' against this invoice');
                continue;
              }
              const send=Math.round(Math.min(diff,portalPaid-linkedTotal)*100)/100;
              if(send<=0){log.details.push(docId+' — no payment sent: nothing left to apply');continue}
              const qbPmt={CustomerRef:{value:cQBId},DepositToAccountRef:paidRefs.payment_deposit_account,TotalAmt:send,
                PrivateNote:'Portal invoice '+docId,
                Line:[{Amount:send,LinkedTxn:[{TxnId:inv.qb_invoice_id,TxnType:'Invoice'}]}]};
              const response=await qbApi('upsert_payment',{payment:qbPmt});
              const paymentId=String(response?.Payment?.Id||'');
              // The old code discarded this response, so a QBO fault was reported to the
              // operator as a successful payment push.
              if(!paymentId)throw new Error(qbResponseErrorDetail(response,'QuickBooks did not return a payment ID'));
              const readback=await queryQBReadOnly(qbApi,"SELECT * FROM Payment WHERE Id = '"+paymentId.replace(/'/g,"\\'")+"' MAXRESULTS 1",'payment API read-back');
              const verified=readback?.QueryResponse?.Payment?.[0];
              if(!verified||String(verified.Id)!==paymentId)throw new Error('payment was not returned by API read-back');
              if(Math.abs(safeNum(verified.TotalAmt)-send)>=0.005)throw new Error('payment total did not match on read-back');
              if(String(verified.CustomerRef?.value||'')!==String(cQBId))throw new Error('payment customer did not match on read-back');
              if(String(verified.DepositToAccountRef?.value||'')!==String(paidRefs.payment_deposit_account.value))throw new Error('payment deposit account did not match on read-back');
              if(!(verified.Line||[]).some(line=>(line.LinkedTxn||[]).some(link=>link.TxnType==='Invoice'&&String(link.TxnId)===String(inv.qb_invoice_id))))throw new Error('payment is not linked to this invoice on read-back');
              const receiptLog={ts:log.ts,type:'payment_record',status:'success',details:[
                docId+' — PAID $'+send.toFixed(2)+' → QBO Payment #'+paymentId,
                'READ-BACK VERIFIED: Payment #'+paymentId+' · $'+safeNum(verified.TotalAmt).toFixed(2)+' · deposit account '+String(verified.DepositToAccountRef?.value||'')]};
              await persistQbLink({mapKey:'qbPaymentMap',sourceIds:[String(inv.id)+':'+paymentId],qboId:paymentId,log:receiptLog,
                evidence:{result:'created',invoice_id:String(inv.id),qb_invoice_id:String(inv.qb_invoice_id),
                  amount:send,already_applied:linkedTotal,deposit_account:String(verified.DepositToAccountRef?.value||''),api_readback:true}});
              log.details.push(docId+' — pushed and verified $'+send.toFixed(2)+' payment → QBO Payment #'+paymentId);updated++;
            }catch(pe){log.details.push(docId+' — payment BLOCKED: '+(pe.message||'unknown error'));log.status='partial'}
          }else{
            log.details.push((inv.display_id||inv.id)+' — already up to date');
          }
        }
      }catch(e){log.status='error';log.details.push('QB query failed: '+e.message)}
      log.details.unshift(updated+'/'+linkedInvs.length+' invoices checked in this batch'+(allLinkedInvs.length>linkedInvs.length?' · '+(allLinkedInvs.length-linkedInvs.length)+' remain for later batches':''));
      setQBConfig(prev=>({...prev,_paidSyncOffset:nextPaidOffset,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])]),lastSync:new Date().toLocaleString()}));
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
        if(!qbBills.length){log.details.push('No bills found in QB');setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));nf('No bills in QB');setQbSyncing(false);return}
        // Build reverse map: QB PO Id → portal PO id
        const poMap={...(qbConfig.qbPOMap||{})};
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
      setQBConfig(prev=>({...prev,_syncedBillIds:newSyncedBillIds,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])]),lastSync:new Date().toLocaleString()}));
      nf(updated+' bill costs pulled from QB');
      setQbSyncing(false);
    };

    // ── SYNC: Products as QBO NonInventory items ──
    // The portal remains the inventory source of truth. QBO receives one
    // purchase item per normalized SKU so POs and vendor bills can preserve
    // quantities while posting purchases directly to 51300. No QBO quantity
    // on hand or inventory value is created by this routine.
    const syncInventory=async(options={})=>{
      if(!options.canaryProductId&&!options.approved){nf('QBO product-item batch sync is locked until reviewed approval','error');return{status:'blocked'}}
      if(!canaryPreflightReady()||!requireDurableLinks())return{status:'blocked'};
      return runQBProductMigration({options,products:prod,config:qbConfig,qbApi,requiredAccountRefs,
        verifyReadback:verifyCanaryReadback,persistQbLink,setQBConfig,setQbSyncing,nf});
    };

    // Remove only a stale portal link whose exact QBO item has already been
    // made inactive. The first call is read-only and asks the UI for explicit
    // confirmation; the confirmed call reads QBO again immediately before the
    // link is removed. Active or mismatched items are never unlinked here.
    const clearInactiveProductLink=async(canaryProductId,options={})=>{
      if(!canaryPreflightReady()||!requireDurableLinks())return{status:'blocked'};
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
        await persistQbLink({mapKey:'prodQBMap',sourceIds:productIds,qboId:itemId,active:false,log,evidence:{sku,api_readback:true,inactive:true}});
        setQBConfig(prev=>{
          const prodQBMap={...(prev.prodQBMap||{})};
          productIds.forEach(id=>{if(String(prodQBMap[id]||'')===itemId)delete prodQBMap[id]});
          return{...prev,prodQBMap,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])]),lastSync:new Date().toLocaleString()};
        });
        nf('Cleared inactive QBO link for '+sku,'success');
        setQbSyncing(false);
        return{status:'success',sku,itemId};
      }catch(e){
        const message=e.message||'Inactive QBO link could not be verified';
        const log={ts:new Date().toLocaleString(),type:'item_link_cleanup',status:'error',details:[message]};
        setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));
        nf('Inactive-link cleanup blocked — '+message,'error');
        setQbSyncing(false);
        return{status:'blocked'};
      }
    };


    // ── SYNC: Sales Orders (as QB Estimates) ──
    const syncSalesOrders=async(custQBMap={},prodQBMap={},options={})=>{
      const canarySOId=String(options?.canarySOId||'');
      const canary=!!canarySOId;
      if(canary?!canaryPreflightReady():migrationBatchLocked())return;
      if(!requireDurableLinks())return{status:'blocked'};
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:canary?'sales_order_canary':'sales_orders',status:'success',details:[]};
      let synced=0;
      const soMap={...(qbConfig.qbSOMap||{})};
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
        setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));nf('Sales-order sync blocked — QBO duplicate preflight failed','error');setQbSyncing(false);return;
      }
      let fallbackSalesItemId;
      try{
        const refs=await requiredAccountRefs(['income_account']);
        fallbackSalesItemId=await requireExistingPortalSalesItem(refs.income_account);
      }catch(e){
        log.status='error';log.details.push(e.message||'40000 Sales could not be resolved');
        setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));nf('Sales-order sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return;
      }
      const effectiveProdQBMap={...(qbConfig.prodQBMap||{}),...(prodQBMap||{})};
      for(const so of toSync){
        if(safeNum(so.tax)>0||(!so.tax_exempt&&safeNum(so.tax_rate)>0)){log.details.push(so.id+' — BLOCKED: taxable Estimates await approved QBO tax-code mapping');log.status='partial';continue}
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
        if(exact.length===1&&sameNumber.length===1){
          if(canary){
            try{await verifyCanaryReadback('Estimate',exact[0].Id,{docNumber:so.id,refField:'CustomerRef',refValue:cQBId,total:estimateTotal,txnDate:estimateDate});
              await persistQbLink({mapKey:'qbSOMap',sourceIds:[so.id],qboId:exact[0].Id,log:{...log,details:[so.id+' — linked and verified QBO Estimate #'+exact[0].Id]},evidence:{result:'linked',api_readback:true,doc_number:so.id,customer_id:cQBId,date:estimateDate,total:estimateTotal}});}
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
              const verified=await verifyCanaryReadback('Estimate',res.Estimate.Id,{docNumber:so.id,refField:'CustomerRef',refValue:cQBId,total:estimateTotal,txnDate:estimateDate});
              await persistQbLink({mapKey:'qbSOMap',sourceIds:[so.id],qboId:verified.Id,log:{...log,details:[so.id+' — created and verified QBO Estimate #'+verified.Id]},evidence:{result:'created',api_readback:true,doc_number:so.id,customer_id:cQBId,date:estimateDate,total:estimateTotal}});
              log.details.push('READ-BACK VERIFIED: '+so.id+' · QBO Estimate #'+verified.Id+' · $'+safeNum(verified.TotalAmt).toFixed(2));
            }catch(e){log.details.push(so.id+' — VERIFY FAILED: '+e.message);log.status='error';continue}
          }
          soMap[so.id]=res.Estimate.Id;
          log.details.push(so.id+' → QB Estimate #'+res.Estimate.Id);synced++;
        }else{log.details.push(so.id+' — FAILED: '+(res?.Fault?.Error?.[0]?.Detail||'unknown'));log.status='partial'}
      }
      if(synced===0&&toSync.length>0)log.status='error';
      log.details.unshift(synced+'/'+toSync.length+(canary?' sales-order canary':' sales orders completed in this batch')+(allToSync.length>toSync.length?' · '+(allToSync.length-toSync.length)+' remain':''));
      setQBConfig(prev=>({...prev,...(!canary?{_salesOrderSyncOffset:salesOrderBatch.nextOffset}:{}),qbSOMap:{...prev.qbSOMap,...soMap},syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])]),lastSync:new Date().toLocaleString()}));
      nf(canary?(synced?'Created and verified exactly one QBO estimate':'Sales-order canary stopped'):(synced+' sales orders synced to QB'),synced?'success':'error');
      setQbSyncing(false);
      return{status:synced===1?'success':'blocked',synced};
    };

    // ── SYNC: Purchase Orders ──
    const syncPurchaseOrders=async(prodQBMapArg={},options={})=>{
      const canaryPOId=String(options?.canaryPOId||'');
      const canary=!!canaryPOId;
      const approvedPOIds=[...new Set((options?.approvedPOIds||[]).map(id=>String(id).trim()).filter(Boolean))];
      if(!canary&&(options?.approved!==true||!approvedPOIds.length||approvedPOIds.length>QB_SYNC_BATCH_SIZE)){
        nf('Purchase-order batch blocked — approve a reviewed list of 1 to 20 exact PO IDs','error');
        return{status:'blocked',synced:0};
      }
      if(!canary&&(!canaryPreflightReady()||productionSyncLocked()))return{status:'blocked',synced:0};
      if(canary&&!canaryPreflightReady())return{status:'blocked',synced:0};
      if(!requireDurableLinks())return{status:'blocked'};
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:canary?'purchase_order_canary':'purchase_orders',status:'success',details:[]};
      let synced=0;
      const results=[];
      const poMap={...(qbConfig.qbPOMap||{})};
      // Fetch existing QB vendors to match by name and avoid duplicates
      let existingQBVendors=[];
      try{
        existingQBVendors=await loadAllQBEntities(qbApi,'Vendor','Id, DisplayName, CompanyName, SyncToken',500);
      }catch(e){
        log.status='error';log.details.push('Vendor duplicate preflight failed: '+e.message);
        setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));nf('Purchase-order sync blocked — QBO vendor preflight failed','error');setQbSyncing(false);return;
      }
      let existingQBPOs=[];
      try{existingQBPOs=await loadAllQBEntities(qbApi,'PurchaseOrder','Id, DocNumber, VendorRef, TotalAmt, TxnDate',500)}
      catch(e){
        log.status='error';log.details.push('Purchase-order duplicate preflight failed: '+e.message);
        setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));nf('Purchase-order sync blocked — QBO duplicate preflight failed','error');setQbSyncing(false);return;
      }
      const vendorQBMap={};// vendorName -> qbVendorId (cache for this sync run)
      const resolveExistingVendorId=vendorName=>{
        if(vendorQBMap[vendorName])return vendorQBMap[vendorName];
        const portalVendor=vend.find(x=>x.name===vendorName)||D_V.find(x=>x.name===vendorName);
        const savedVendorId=qbConfig.vendorQBMap?.[portalVendor?.id]||portalVendor?.qb_vendor_id;
        const bySavedId=savedVendorId&&existingQBVendors.filter(q=>String(q.Id)===String(savedVendorId)
          &&(q.DisplayName===vendorName||q.CompanyName===vendorName));
        const exact=existingQBVendors.filter(q=>q.DisplayName===vendorName||q.CompanyName===vendorName);
        const matches=bySavedId?.length?bySavedId:exact;
        if(matches.length===1)vendorQBMap[vendorName]=matches[0].Id;
        return matches.length===1?matches[0].Id:null;
      };
      // POs do not post to the GL, but every line still carries the approved
      // category so the PO-to-bill workflow remains deterministic.
      let poAccountRefs;
      try{
        poAccountRefs=await requiredAccountRefs(['purchases_account','deco_account']);
      }catch(e){
        log.status='error';log.details.push(e.message||'Required purchase-order account could not be resolved');
        setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));nf('Purchase-order sync blocked — '+(e.message||'account setup error'),'error');setQbSyncing(false);return;
      }
      // Group PO lines by po_id so we push one QB PO with all line items
      const allPoGroups=groupPortalPurchaseOrders(sos,poMap);
      const effectiveProdQBMap={...(qbConfig.prodQBMap||{}),...(prodQBMapArg||{})};
      const requestedIds=canary?[canaryPOId]:approvedPOIds;
      const poGroups=requestedIds.map(id=>allPoGroups.find(group=>String(group.poId)===id)).filter(Boolean);
      if(canary&&poGroups.length!==1){nf('Choose exactly one pending portal purchase order','error');setQbSyncing(false);return}
      if(!canary&&poGroups.length!==approvedPOIds.length){
        nf('Purchase-order batch changed since review — review it again before sending','error');setQbSyncing(false);return{status:'blocked',synced:0};
      }
      for(const group of poGroups){
        if(group.invalidReason){log.details.push(group.poId+' — BLOCKED: '+group.invalidReason);results.push({poId:group.poId,result:'blocked',error:group.invalidReason});log.status='partial';continue}
        const vendorName=group.vendor;
        if(!vendorName){const error='no saved vendor name';log.details.push(group.poId+' — BLOCKED: '+error);results.push({poId:group.poId,result:'blocked',error});log.status='partial';continue}
        const poDate=parseQBDateValue(group.created_at);
        if(!poDate){const error='purchase-order date could not be converted to a QBO date';log.details.push(group.poId+' — BLOCKED: '+error);results.push({poId:group.poId,result:'blocked',error});log.status='partial';continue}
        // Find or create vendor in QB
        let v=vend.find(x=>x.name===vendorName)||D_V.find(x=>x.name===vendorName);
        let qbVendorId=resolveExistingVendorId(vendorName);
        if(!qbVendorId){
          // Check existing QB vendors by name
          const vendorMatches=existingQBVendors.filter(q=>q.DisplayName===vendorName||q.CompanyName===vendorName);
          if(vendorMatches.length>1){const error='multiple QBO vendors exactly match "'+vendorName+'"';log.details.push(group.poId+' — BLOCKED: '+error);results.push({poId:group.poId,result:'blocked',error});log.status='partial';continue}
          const match=vendorMatches[0];
          if(match){qbVendorId=match.Id}
          else{const error='vendor "'+vendorName+'" is not linked or uniquely present in QBO';log.details.push(group.poId+' — BLOCKED: '+error);results.push({poId:group.poId,result:'blocked',error});log.status='partial';continue}
          vendorQBMap[vendorName]=qbVendorId;
          if(v)setVend(prev=>prev.map(vv=>vv.id===v.id?{...vv,qb_vendor_id:qbVendorId}:vv));
        }
        let missingSkuItem=null;
        const itemGroups=new Map();
        const qbLines=[];
        group.entries.forEach(({pl:p,so:s,it:i})=>{
          const qty=Object.entries(p).filter(([k,v])=>typeof v==='number'&&!k.startsWith('_')&&!['unit_cost','billed','tracking_numbers','vendor','drop_ship'].includes(k)&&k.match(/^[A-Z0-9]/)).reduce((a,[,v])=>a+v,0);
          // The saved PO line is the accounting source of truth for cost. The
          // product catalog cost can change after a PO is issued, and raw
          // half-cent values can otherwise be rounded differently by QBO.
          const hasSavedRate=p.unit_cost!==undefined&&p.unit_cost!==null&&p.unit_cost!=='';
          const rate=qbCurrency(hasSavedRate?p.unit_cost:i.nsa_cost);
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
        if(missingSkuItem){const error='QBO NonInventory item missing for '+missingSkuItem;log.details.push(group.poId+' — BLOCKED: '+error);results.push({poId:group.poId,result:'blocked',error});log.status='partial';continue}
        itemGroups.forEach(entry=>qbLines.push({DetailType:'ItemBasedExpenseLineDetail',Amount:Math.round(entry.amount*100)/100,
          Description:entry.sku+' '+[...entry.names].filter(Boolean).join(' / ')+' (SO: '+[...entry.soIds].join(', ')+')',
          ItemBasedExpenseLineDetail:{ItemRef:{value:String(entry.itemId)},Qty:entry.qty,UnitPrice:Math.round((entry.amount/entry.qty)*1e6)/1e6}}));
        const totalAmount=qbCurrency(qbLines.reduce((a,l)=>a+l.Amount,0));
        if(!qbLines.length||!(totalAmount>0)){const error='no positive purchase-order lines';log.details.push(group.poId+' — BLOCKED: '+error);results.push({poId:group.poId,result:'blocked',error});log.status='partial';continue}
        const soRefs=[...new Set(group.entries.map(({so:s})=>s.id))].join(', ');
        const qbPO={
          DocNumber:group.poId,
          VendorRef:{value:qbVendorId},
          TxnDate:poDate,
          Line:qbLines,
          PrivateNote:'Portal PO for SO: '+soRefs,
          ...(poMap[group.poId]?{Id:poMap[group.poId],sparse:true}:{}),
        };
        const verifyPOReadback=async id=>{
          const verified=await verifyCanaryReadback('PurchaseOrder',id,{docNumber:group.poId,refField:'VendorRef',refValue:qbVendorId,total:totalAmount,txnDate:poDate});
          const lineValues=line=>({type:line.DetailType,amount:safeNum(line.Amount),
            item:String(line.ItemBasedExpenseLineDetail?.ItemRef?.value||''),qty:safeNum(line.ItemBasedExpenseLineDetail?.Qty),
            unitPrice:safeNum(line.ItemBasedExpenseLineDetail?.UnitPrice),account:String(line.AccountBasedExpenseLineDetail?.AccountRef?.value||'')});
          const remaining=(verified.Line||[]).map(lineValues);
          const matches=qbLines.every(line=>{
            const expected=lineValues(line);
            const index=remaining.findIndex(actual=>actual.type===expected.type&&actual.item===expected.item&&actual.account===expected.account
              &&Math.abs(actual.amount-expected.amount)<0.005&&Math.abs(actual.qty-expected.qty)<0.000001&&Math.abs(actual.unitPrice-expected.unitPrice)<0.000001);
            if(index<0)return false;
            remaining.splice(index,1);
            return true;
          });
          if(!matches||remaining.length)throw new Error('QBO line items, quantities, rates, amounts, or accounts differ from the reviewed PO');
          return verified;
        };
        const sameNumber=existingQBPOs.filter(existing=>String(existing.DocNumber||'')===String(group.poId));
        const exact=sameNumber.filter(existing=>String(existing.VendorRef?.value||'')===String(qbVendorId)
          &&Math.abs(safeNum(existing.TotalAmt)-totalAmount)<0.005
          &&String(existing.TxnDate||'').slice(0,10)===String(qbPO.TxnDate||'').slice(0,10));
        if(exact.length===1&&sameNumber.length===1){
          try{const verified=await verifyPOReadback(exact[0].Id);
            await persistQbLink({mapKey:'qbPOMap',sourceIds:[group.poId],qboId:verified.Id,log:{...log,details:[group.poId+' — linked and verified QBO PO #'+verified.Id]},evidence:{result:'linked',batch_id:canary?null:log.ts,api_readback:true,doc_number:group.poId,vendor_id:qbVendorId,date:poDate,total:totalAmount,line_count:qbLines.length}});
          }catch(e){log.details.push(group.poId+' — VERIFY FAILED: '+e.message);results.push({poId:group.poId,result:'blocked',error:e.message});log.status='partial';continue}
          poMap[group.poId]=exact[0].Id;results.push({poId:group.poId,result:'linked',qboId:String(exact[0].Id),total:totalAmount});log.details.push(group.poId+' — exact existing QB PO #'+exact[0].Id+' verified');synced++;continue;
        }
        if(sameNumber.length){const error='QBO purchase-order number exists with a different vendor, date, or total';log.details.push(group.poId+' — BLOCKED: '+error);results.push({poId:group.poId,result:'blocked',error});log.status='partial';continue}
        let res;
        try{res=await qbApi('upsert_purchase_order',{purchase_order:qbPO})}
        catch(e){log.details.push(group.poId+' — FAILED: '+e.message);results.push({poId:group.poId,result:'failed',error:e.message});log.status='partial';continue}
        if(res?.PurchaseOrder?.Id){
          try{
            const verified=await verifyPOReadback(res.PurchaseOrder.Id);
            await persistQbLink({mapKey:'qbPOMap',sourceIds:[group.poId],qboId:verified.Id,log:{...log,details:[group.poId+' — created and verified QBO PO #'+verified.Id]},evidence:{result:'created',batch_id:canary?null:log.ts,api_readback:true,doc_number:group.poId,vendor_id:qbVendorId,date:poDate,total:totalAmount,line_count:qbLines.length}});
            log.details.push('READ-BACK VERIFIED: '+group.poId+' · QBO PurchaseOrder #'+verified.Id+' · $'+safeNum(verified.TotalAmt).toFixed(2));
          }catch(e){log.details.push(group.poId+' — VERIFY FAILED: '+e.message);results.push({poId:group.poId,result:'created_unverified',qboId:String(res.PurchaseOrder.Id),error:e.message});log.status='partial';continue}
          poMap[group.poId]=res.PurchaseOrder.Id;
          results.push({poId:group.poId,result:'created',qboId:String(res.PurchaseOrder.Id),total:totalAmount});log.details.push(group.poId+' → QB PO #'+res.PurchaseOrder.Id+' ('+vendorName+' $'+totalAmount.toFixed(2)+', '+qbLines.length+' items)');synced++;
        }else{const error=qbResponseErrorDetail(res);log.details.push(group.poId+' — FAILED: '+error);results.push({poId:group.poId,result:'failed',error});log.status='partial'}
      }
      if(synced===0&&poGroups.length>0)log.status='error';
      log.details.unshift(synced+'/'+poGroups.length+(canary?' purchase-order canary':' purchase orders completed in this batch')+(allPoGroups.length>poGroups.length?' · '+(allPoGroups.length-poGroups.length)+' remain':''));
      const report={id:'purchase-order-batch-'+new Date().toISOString(),status:synced===poGroups.length?'success':'partial',results,counts:results.reduce((counts,row)=>({...counts,[row.result]:(counts[row.result]||0)+1}),{})};
      setQBConfig(prev=>({...prev,qbPOMap:{...prev.qbPOMap,...poMap},...(!canary?{lastPurchaseOrderBatch:report}:{}),syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])]),lastSync:new Date().toLocaleString()}));
      nf(canary?(synced?'Created/linked and verified exactly one QBO purchase order':'Purchase-order canary stopped'):
        (synced+'/'+poGroups.length+' purchase orders verified; review the saved reconciliation'),
        canary?(synced?'success':'error'):(synced===poGroups.length?'success':'error'));
      setQbSyncing(false);
      if(canary)return{status:synced===1?'success':'blocked',synced};
      return{status:synced===poGroups.length?'success':'partial',synced,report};
    };

    // Verify native PO-to-existing-bill relationships that were created through
    // QBO's supported Add to Bill workflow. This routine is read-only in QBO;
    // it writes a durable portal receipt only after both records agree.
    const verifyPurchaseOrderBillLinks=async(options={})=>{
      if(!canaryPreflightReady()||!requireDurableLinks())return{status:'blocked',verified:0};
      const canaryPOId=String(options.canaryPOId||'');
      const expectedBillId=String(options.expectedBillId||'').trim();
      if(!canaryPOId||!expectedBillId){nf('Select one purchase order and enter the existing QBO bill ID reviewed in QuickBooks','error');return{status:'blocked',verified:0}}
      const receiptMap={...(qbConfig.qbPOBillMap||{})};
      const selected=Object.entries(qbConfig.qbPOMap||{}).filter(([portalPOId])=>String(portalPOId)===canaryPOId);
      if(selected.length!==1){nf('Choose one saved QBO purchase order','error');return{status:'blocked',verified:0}}
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:canaryPOId?'purchase_order_bill_canary':'purchase_order_bill_links',status:'success',details:[]};
      let bills=[];let verified=0;
      try{bills=await loadAllQBEntities(qbApi,'Bill','*',500)}catch(e){
        log.status='error';log.details.push('Bill read-back failed: '+e.message);
        setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));setQbSyncing(false);nf('PO-to-bill verification blocked — QBO bill query failed','error');return{status:'blocked',verified:0};
      }
      for(const [portalPOId,qboPOId] of selected){
        try{
          const poResult=await queryQBReadOnly(qbApi,"SELECT * FROM PurchaseOrder WHERE Id = '"+String(qboPOId).replace(/'/g,"\\'")+"' MAXRESULTS 1",'purchase-order API read-back');
          const po=poResult?.QueryResponse?.PurchaseOrder?.[0];
          if(!po||String(po.Id)!==String(qboPOId))throw new Error('saved QBO purchase order was not returned');
          const matches=findQbPOBillCandidates(bills,portalPOId,qboPOId);
          if(matches.length!==1)throw new Error(matches.length?'multiple bills reference this purchase order':'no bill references this purchase order');
          const bill=matches[0];
          if(String(bill.Id)!==expectedBillId)throw new Error('matched bill differs from the reviewed existing bill ID');
          if(String(po.DocNumber||'').trim()!==String(portalPOId).trim())throw new Error('saved purchase order number differs from the portal PO');
          if(!billReferencesPortalPO(bill,portalPOId))throw new Error('bill memo does not contain the exact portal PO reference');
          const billLinks=qbLinkedTransactions(bill).filter(link=>link.TxnType==='PurchaseOrder');
          const poLinks=qbLinkedTransactions(po).filter(link=>link.TxnType==='Bill');
          if(billLinks.some(link=>String(link.TxnId)!==String(qboPOId)))throw new Error('bill is linked to a different purchase order');
          if(poLinks.some(link=>String(link.TxnId)!==String(bill.Id)))throw new Error('purchase order is linked to a different bill');
          if(!billLinks.some(link=>String(link.TxnId)===String(qboPOId)))throw new Error('bill API read-back does not contain the purchase-order link');
          if(!poLinks.some(link=>String(link.TxnId)===String(bill.Id)))throw new Error('purchase-order API read-back does not contain the bill link');
          if(!po.VendorRef?.value||String(bill.VendorRef?.value||'')!==String(po.VendorRef.value))throw new Error('bill and purchase order vendors differ or are missing');
          const snapshot=record=>Object.fromEntries(['Id','SyncToken','DocNumber','TxnDate','DueDate','TotalAmt','Balance','VendorRef','PrivateNote','POStatus','LinkedTxn','Line'].filter(key=>record[key]!==undefined).map(key=>[key,record[key]]));
          const evidence={result:'verified',api_readback:true,purchase_order_id:String(qboPOId),bill_id:String(bill.Id),bill_doc_number:bill.DocNumber||'',bill_date:bill.TxnDate||'',bill_total:safeNum(bill.TotalAmt),purchase_order_total:safeNum(po.TotalAmt),vendor_id:String(po.VendorRef.value),reciprocal_link:true,reviewed_bill_id:expectedBillId,purchase_order:snapshot(po),bill:snapshot(bill)};
          const receiptLog={...log,details:[portalPOId+' — QBO PO #'+qboPOId+' linked to existing Bill #'+bill.Id+' and verified from both API records',JSON.stringify(evidence)]};
          await persistQbLink({mapKey:'qbPOBillMap',sourceIds:[portalPOId],qboId:bill.Id,log:receiptLog,evidence});
          setQBConfig(prev=>({...prev,lastPOBillVerification:{realm:qbConfig.realm_id,verifiedAt:new Date().toISOString(),portalPOId,...evidence}}));
          receiptMap[portalPOId]=String(bill.Id);verified++;
          log.details.push(portalPOId+' — VERIFIED: QBO PO #'+qboPOId+' ↔ existing Bill #'+bill.Id);
        }catch(e){log.status='partial';log.details.push(portalPOId+' — BLOCKED: '+e.message)}
      }
      log.details.unshift(verified+'/'+selected.length+(canaryPOId?' PO-to-bill canary':' PO-to-bill links')+' verified by reciprocal API read-back');
      if(!verified)log.status='error';
      setQBConfig(prev=>({...prev,qbPOBillMap:{...prev.qbPOBillMap,...receiptMap},syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])]),lastSync:new Date().toLocaleString()}));
      setQbSyncing(false);nf(verified+' PO-to-bill link'+(verified===1?'':'s')+' verified',verified?'success':'error');
      return{status:verified===selected.length?'success':'blocked',verified};
    };

    const reviewPurchaseOrderBillCandidate=async portalPOId=>{
      const qboPOId=qbConfig.qbPOMap?.[portalPOId];
      if(!qboPOId)return{status:'blocked',reason:'Portal PO has no saved QBO purchase-order link'};
      const bills=await loadAllQBEntities(qbApi,'Bill','*',500);
      const poResult=await queryQBReadOnly(qbApi,"SELECT * FROM PurchaseOrder WHERE Id = '"+String(qboPOId).replace(/'/g,"\\'")+"' MAXRESULTS 1",'purchase-order API read-back');
      const po=poResult?.QueryResponse?.PurchaseOrder?.[0];
      const matches=findQbPOBillCandidates(bills,portalPOId,qboPOId);
      if(!po||matches.length!==1)return{status:'blocked',reason:!po?'Purchase order was not returned by QBO':matches.length?'Multiple QBO bills reference this PO':'No QBO bill memo contains this exact PO'};
      const bill=matches[0];
      if(String(po.DocNumber||'').trim()!==String(portalPOId).trim()||!billReferencesPortalPO(bill,portalPOId)||String(po.VendorRef?.value||'')!==String(bill.VendorRef?.value||''))return{status:'blocked',reason:'PO number, bill memo, or vendor did not match'};
      const alreadyLinked=qbLinkedTransactions(bill).some(link=>link.TxnType==='PurchaseOrder'&&String(link.TxnId)===String(qboPOId));
      if(!alreadyLinked)buildQBBillPOReplacement({bill,purchaseOrder:po});
      return{status:alreadyLinked?'linked':'ready',portalPOId,qboPOId:String(qboPOId),billId:String(bill.Id),billDocNumber:bill.DocNumber||'',vendor:bill.VendorRef?.name||'',billDate:bill.TxnDate||'',billTotal:safeNum(bill.TotalAmt),poDate:po.TxnDate||'',poTotal:safeNum(po.TotalAmt),bill,po};
    };

    const linkPurchaseOrderBill=async(options={})=>{
      const portalPOId=String(options.portalPOId||''),expectedBillId=String(options.expectedBillId||'');
      if(!options.approved||!portalPOId||!expectedBillId)return{status:'blocked'};
      if(!canaryPreflightReady()||!requireDurableLinks())return{status:'blocked'};
      setQbSyncing(true);
      const log={ts:new Date().toLocaleString(),type:options.batchId?'purchase_order_bill_link_record':'purchase_order_bill_link_canary',status:'success',details:[]};
      try{
        const review=await reviewPurchaseOrderBillCandidate(portalPOId);
        if(!['ready','linked'].includes(review.status))throw new Error(review.reason||'PO-to-bill candidate is blocked');
        if(review.billId!==expectedBillId)throw new Error('QBO bill changed after review');
        if(review.status==='ready'){
          const before={id:review.billId,doc:review.billDocNumber,date:review.billDate,total:review.billTotal,vendor:String(review.bill.VendorRef?.value||'')};
          const payload=buildQBBillPOReplacement({bill:review.bill,purchaseOrder:review.po});
          const result=await qbApi('upsert_bill',{bill:payload});
          if(!result?.Bill?.Id)throw new Error('QBO bill link update failed: '+qbResponseErrorDetail(result));
          const billResult=await queryQBReadOnly(qbApi,"SELECT * FROM Bill WHERE Id = '"+expectedBillId.replace(/'/g,"\\'")+"' MAXRESULTS 1",'bill link API read-back');
          const poResult=await queryQBReadOnly(qbApi,"SELECT * FROM PurchaseOrder WHERE Id = '"+review.qboPOId.replace(/'/g,"\\'")+"' MAXRESULTS 1",'purchase-order link API read-back');
          const bill=billResult?.QueryResponse?.Bill?.[0],po=poResult?.QueryResponse?.PurchaseOrder?.[0];
          if(!bill||!po||String(bill.Id)!==before.id||String(bill.DocNumber||'')!==String(before.doc)||String(bill.TxnDate||'')!==String(before.date)||Math.abs(safeNum(bill.TotalAmt)-before.total)>=0.005||String(bill.VendorRef?.value||'')!==before.vendor)throw new Error('Bill identity, date, vendor, or total changed on read-back');
          if(!qbLinkedTransactions(bill).some(link=>link.TxnType==='PurchaseOrder'&&String(link.TxnId)===review.qboPOId)||!qbLinkedTransactions(po).some(link=>link.TxnType==='Bill'&&String(link.TxnId)===before.id))throw new Error('QBO did not return reciprocal links after the update');
        }
        const finalReview=await reviewPurchaseOrderBillCandidate(portalPOId);
        if(finalReview.status!=='linked'||finalReview.billId!==expectedBillId)throw new Error('Final reciprocal link verification failed');
        const evidence={result:review.status==='linked'?'already_linked':'linked',link_method:review.status==='linked'?'qbo_existing':'api_bill_update',api_readback:true,purchase_order_id:finalReview.qboPOId,bill_id:finalReview.billId,bill_doc_number:finalReview.billDocNumber,bill_date:finalReview.billDate,bill_total:finalReview.billTotal,purchase_order_total:finalReview.poTotal,vendor_id:String(finalReview.po.VendorRef?.value||''),reciprocal_link:true,batch_id:options.batchId||null};
        await persistQbLink({mapKey:'qbPOBillMap',sourceIds:[portalPOId],qboId:finalReview.billId,log:{...log,details:[portalPOId+' — linked QBO PO #'+finalReview.qboPOId+' to existing Bill #'+finalReview.billId+' and verified from both API records']},evidence});
        setQBConfig(prev=>({...prev,qbPOBillMap:{...prev.qbPOBillMap,[portalPOId]:finalReview.billId},lastPOBillLinkCanary:options.batchId?prev.lastPOBillLinkCanary:{portalPOId,...evidence,verifiedAt:new Date().toISOString()},syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])]),lastSync:new Date().toLocaleString()}));
        setQbSyncing(false);nf('PO-to-bill link verified','success');return{status:'success',portalPOId,billId:finalReview.billId};
      }catch(e){log.status='error';log.details.push(portalPOId+' — BLOCKED: '+e.message);setQBConfig(prev=>({...prev,syncLog:mergeQBSyncLogs([log,...(prev.syncLog||[])])}));setQbSyncing(false);nf('PO-to-bill link stopped — '+e.message,'error');return{status:'blocked',reason:e.message}}
    };

    // ── SYNC ALL ──
    const syncAll=async()=>{
      if(migrationBatchLocked())return{status:'blocked'};
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

    return {syncTaxRateCanary,syncCustomerCanary,syncCustomers,syncInvoices,syncPaidFromQB,syncBillsFromQB,syncInventory,clearInactiveProductLink,syncPortalSalesItemCanary,syncSalesOrders,syncPurchaseOrders,verifyPurchaseOrderBillLinks,reviewPurchaseOrderBillCandidate,linkPurchaseOrderBill,syncAll};
}
