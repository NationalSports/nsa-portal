export const REALM_ID = '9341456492604246';
export const MANUAL_BLOCKED_INVOICES = new Set(['INV-63831']);
export const STATE_TAX_ACCOUNTS = Object.freeze({
  CA: '25200', AZ: '25205', CO: '25215', NV: '25220', TX: '25225', WA: '25230',
  WI: '25201', SD: '25201',
});

export const money = value => Math.round((Number(value) || 0) * 100) / 100;
export const clean = value => String(value == null ? '' : value).trim();
export const normalizeInvoiceNumber = value => clean(value).replace(/^NS-/i, '');
export const invoiceNumberForms = value => {
  const normalized = normalizeInvoiceNumber(value);
  return normalized ? [normalized, `NS-${normalized}`] : [];
};
export const normalizeName = value => clean(value).replace(/\s+/g, ' ').toLowerCase();

const DUPLICATE_SUFFIXES = new Set(['inc','llc','lc','ltd','co','corp','company']);
export function looseCustomerKey(value) {
  const tokens = clean(value).toLowerCase().replace(/&/g,' and ')
    .replace(/['\u2018\u2019\u02bc`]/g,'').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && DUPLICATE_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length > 1 && tokens[0] === 'the') tokens.shift();
  return tokens.join(' ');
}

export function customerDisplayName(customer = {}) {
  const name = clean(customer.name), alpha = clean(customer.alpha_tag);
  return name + (alpha ? ` (${alpha})` : '');
}

export function exactCustomerMatches(customer, qboCustomers = []) {
  const name = normalizeName(customer?.name), display = normalizeName(customerDisplayName(customer));
  return [...new Map(qboCustomers.filter(qbo => qbo && qbo.Active !== false).filter(qbo => {
    const qDisplay = normalizeName(qbo.DisplayName), company = normalizeName(qbo.CompanyName);
    return (qDisplay && (qDisplay === display || qDisplay === name)) || (company && company === name);
  }).map(row => [String(row.Id), row])).values()];
}

export function looseCustomerMatches(customer, qboCustomers = []) {
  const keys = new Set([looseCustomerKey(customer?.name),looseCustomerKey(customerDisplayName(customer))].filter(Boolean));
  return [...new Map(qboCustomers.filter(qbo => qbo && qbo.Active !== false).filter(qbo =>
    keys.has(looseCustomerKey(qbo.DisplayName)) || keys.has(looseCustomerKey(qbo.CompanyName))
  ).map(row => [String(row.Id), row])).values()];
}

const normalizedEmail=value=>clean(value).toLowerCase();
const normalizedAddress=value=>clean(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function customerIdentityRisks(customer = {}, qbo = {}) {
  const risks=[];
  const portalEmail=normalizedEmail(customer.contact_email),qboEmail=normalizedEmail(qbo.PrimaryEmailAddr?.Address);
  if(portalEmail&&qboEmail&&portalEmail!==qboEmail)risks.push('email_mismatch');
  const portalLine=normalizedAddress(customer.billing_address_line1||customer.shipping_address_line1);
  const qboLine=normalizedAddress(qbo.BillAddr?.Line1||qbo.ShipAddr?.Line1);
  if(portalLine&&qboLine&&portalLine!==qboLine)risks.push('address_mismatch');
  const portalCity=normalizedAddress(customer.billing_city||customer.shipping_city);
  const qboCity=normalizedAddress(qbo.BillAddr?.City||qbo.ShipAddr?.City);
  if(portalCity&&qboCity&&portalCity!==qboCity)risks.push('city_mismatch');
  if(Math.abs(Number(qbo.Balance)||0)>.005)risks.push('existing_balance');
  return risks;
}

export function classifyInvoiceDuplicate(source = {}, qboInvoices = []) {
  const normalized = normalizeInvoiceNumber(source.documentNumber);
  const same = qboInvoices.filter(row => normalizeInvoiceNumber(row?.DocNumber) === normalized);
  if (!same.length) return { disposition:'create' };
  const exact = same.filter(row =>
    clean(row.CustomerRef?.value) === clean(source.qboCustomerId)
    && clean(row.TxnDate).slice(0,10) === clean(source.date).slice(0,10)
    && money(row.TotalAmt) === money(source.total));
  if (same.length === 1 && exact.length === 1) return { disposition:'link_existing', qboId:String(exact[0].Id), invoice:exact[0] };
  return { disposition:'manual_review', conflicts:same.map(row => ({
    qboId:String(row.Id||''), documentNumber:clean(row.DocNumber), customerId:clean(row.CustomerRef?.value),
    date:clean(row.TxnDate).slice(0,10), total:money(row.TotalAmt),
  })) };
}

export function parseDate(value) {
  const raw = clean(value); if (!raw) return null;
  let year,month,day;
  const iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\D|$)/), us=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\D|$)/);
  if (iso) { year=+iso[1];month=+iso[2];day=+iso[3]; }
  else if (us) { year=+(us[3].length===2?'20'+us[3]:us[3]);month=+us[1];day=+us[2]; }
  else return null;
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

export function standardDueDate(invoiceDate, termName) {
  const date=parseDate(invoiceDate), name=clean(termName).toLowerCase().replace(/[^a-z0-9]+/g,'');
  if(!date||!name)return null;
  let days=null;
  if(['dueonreceipt','prepay','prepaid'].includes(name))days=0;
  else { const m=name.match(/^net(\d+)$/); if(m)days=+m[1]; }
  if(!Number.isInteger(days)||days<0||days>3650)return null;
  const due=new Date(`${date}T00:00:00Z`);due.setUTCDate(due.getUTCDate()+days);return due.toISOString().slice(0,10);
}

export function classifySourceInvoice(invoice, today) {
  const id=clean(invoice?.id), total=money(invoice?.total), date=parseDate(invoice?.date||invoice?.created_at);
  if (invoice?.deleted_at) return { action:'excluded_deleted' };
  if (MANUAL_BLOCKED_INVOICES.has(id)) return { action:'manual_review', reason:'explicit_manual_block' };
  if (clean(invoice?.status).toLowerCase()==='void') return { action:'excluded_void' };
  if (total===0) return { action:'excluded_zero' };
  if (total<0) return { action:'manual_review', reason:'negative_invoice' };
  if (!date) return { action:'manual_review', reason:'invalid_invoice_date' };
  if (date>today) return { action:'held_future', reason:`held_until_${date}` };
  return { action:'eligible', date, total };
}

export function taxPlan(invoice, customer, partnerTaxEnabled=true) {
  const tax=money(invoice?.tax); if(!(tax>0))return null;
  const state=clean(customer?.shipping_state||customer?.billing_state).toUpperCase();
  const accountNumber=STATE_TAX_ACCOUNTS[state];
  if(!accountNumber)throw new Error('unmapped_tax_state');
  if(!partnerTaxEnabled)throw new Error('manual_tax_requires_reviewed_rate');
  const total=money(invoice.total),shipping=money(invoice.shipping),rate=Number(invoice.tax_rate)||0;
  const ex=money(total-tax-shipping),inc=money(total-tax);
  const reconciles=base=>Math.abs(money(base*rate)-tax)<0.011;
  const shippingTaxable=!reconciles(ex)&&shipping>0&&reconciles(inc), taxable=shippingTaxable?inc:ex;
  return {state,accountNumber,tax,shipping,taxable,shippingTaxable,reconciled:rate>0&&reconciles(taxable),
    expectedTax:money(taxable*rate),ratePct:rate>0?(rate*100).toFixed(3).replace(/\.?0+$/,''):''};
}

export function buildInvoiceLines({invoice,description,salesItemId,taxItemId,plan,discountAccountId}) {
  const total=money(invoice.total), discount=money(invoice.credit_amount), tax=plan?.tax||0, shipping=plan?.shipping||0;
  const gross=money(total-tax-shipping+discount);
  if(!(total>0)||!(gross>0)||!salesItemId)throw new Error('invalid_invoice_amounts');
  if(discount>0&&!discountAccountId)throw new Error('discount_account_missing');
  if(plan&&!taxItemId)throw new Error('tax_item_missing');
  const lines=[{DetailType:'SalesItemLineDetail',Amount:gross,Description:clean(description).slice(0,4000),
    SalesItemLineDetail:{Qty:1,UnitPrice:gross,ItemRef:{value:String(salesItemId),name:'NSA Portal Sales'},...(plan?{TaxCodeRef:{value:'NON'}}:{})}}];
  if(shipping>0)lines.push({DetailType:'SalesItemLineDetail',Amount:shipping,Description:'Customer shipping',SalesItemLineDetail:{Qty:1,UnitPrice:shipping,ItemRef:{value:String(salesItemId),name:'NSA Portal Sales'},TaxCodeRef:{value:'NON'}}});
  if(plan)lines.push({DetailType:'SalesItemLineDetail',Amount:tax,Description:plan.reconciled?`Sales tax — ${plan.state} ${plan.ratePct}% on $${money(plan.taxable).toFixed(2)}`:`Sales tax — ${plan.state} (as collected)`,SalesItemLineDetail:{Qty:1,UnitPrice:tax,ItemRef:{value:String(taxItemId),name:`NSA Portal Sales Tax — ${plan.state}`},TaxCodeRef:{value:'NON'}}});
  if(discount>0)lines.push({DetailType:'DiscountLineDetail',Amount:discount,Description:'Customer discount / credit — 40200',DiscountLineDetail:{PercentBased:false,DiscountAccountRef:{value:String(discountAccountId)}}});
  return lines;
}

export function paymentIdentity(payment = {}) { return `payment:${clean(payment.id)}`; }
export function paymentReference(payment = {}) { return `NSA-P${clean(payment.id)}`.slice(0,21); }

export function qboPaymentApplications(payments = [], qboInvoiceId) {
  const rows=[];
  for(const payment of payments)for(const line of payment.Line||[])for(const link of line.LinkedTxn||[])
    if(link.TxnType==='Invoice'&&String(link.TxnId)===String(qboInvoiceId))rows.push({
      id:String(payment.Id),amount:money(line.Amount),date:parseDate(payment.TxnDate),customerId:clean(payment.CustomerRef?.value),
      depositAccountId:clean(payment.DepositToAccountRef?.value),ref:clean(payment.PaymentRefNum),payment,
    });
  return rows;
}

export function allocateUnreflectedPayments(sourcePayments = [], alreadyApplied = 0) {
  let covered=money(alreadyApplied);
  return [...sourcePayments].filter(row=>money(row.amount)>0).sort((a,b)=>(parseDate(a.date)||'').localeCompare(parseDate(b.date)||'')||Number(a.id)-Number(b.id)).map(row=>{
    const amount=money(row.amount), used=Math.min(amount,covered);covered=money(covered-used);
    return {...row,sourceAmount:amount,coveredAmount:money(used),remainingAmount:money(amount-used)};
  });
}

export function writeAllowed(settings, entityType, sourceId) {
  if(!settings?.writes_enabled||settings?.kill_switch)return false;
  const phase=clean(settings.phase);
  if(phase==='bounded'||phase==='hourly')return true;
  if(phase===`${entityType}_canary`)return clean(settings[`canary_${entityType}_source_id`])===clean(sourceId);
  return false;
}

export async function sha256(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
