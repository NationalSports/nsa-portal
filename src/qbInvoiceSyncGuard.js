const clean = value => String(value == null ? '' : value).trim();
const cents = value => Math.round((Number(value) || 0) * 100);

export function normalizeQBInvoiceDocumentNumber(value) {
  return clean(value).replace(/^NS-/i, '');
}

export function qbInvoiceDocumentNumberForms(value) {
  const normalized = normalizeQBInvoiceDocumentNumber(value);
  return normalized ? [normalized, 'NS-' + normalized] : [];
}

export function qbInvoiceSourceKey(invoice = {}) {
  const netsuiteId = clean(invoice.netsuite_internal_id);
  if (netsuiteId) return 'netsuite:' + netsuiteId;
  const portalId = clean(invoice._hist_id || invoice.id);
  return portalId ? 'portal:' + portalId : '';
}

export function compareQBInvoiceIdentity(source = {}, qbo = {}) {
  const differences = [];
  if (normalizeQBInvoiceDocumentNumber(qbo.DocNumber) !== normalizeQBInvoiceDocumentNumber(source.documentNumber)) {
    differences.push({field:'invoice_number', source:normalizeQBInvoiceDocumentNumber(source.documentNumber), qbo:normalizeQBInvoiceDocumentNumber(qbo.DocNumber)});
  }
  if (clean(qbo.CustomerRef?.value) !== clean(source.qboCustomerId)) {
    differences.push({field:'customer', source:clean(source.qboCustomerId), qbo:clean(qbo.CustomerRef?.value)});
  }
  if (clean(qbo.TxnDate).slice(0, 10) !== clean(source.date).slice(0, 10)) {
    differences.push({field:'date', source:clean(source.date).slice(0, 10), qbo:clean(qbo.TxnDate).slice(0, 10)});
  }
  if (cents(qbo.TotalAmt) !== cents(source.total)) {
    differences.push({field:'amount', source:cents(source.total) / 100, qbo:cents(qbo.TotalAmt) / 100});
  }
  return {matches:differences.length === 0, differences};
}

// A number collision is never resolved by invoice number alone. Exactly one
// customer/date/cents match may be linked; every other collision is manual.
export function classifyQBInvoiceDuplicate(source = {}, qboInvoices = []) {
  const normalized = normalizeQBInvoiceDocumentNumber(source.documentNumber);
  const sameNumber = (qboInvoices || []).filter(invoice =>
    normalizeQBInvoiceDocumentNumber(invoice?.DocNumber) === normalized);
  if (!sameNumber.length) return {disposition:'create', matches:[], conflicts:[]};
  const comparisons = sameNumber.map(invoice => ({invoice, ...compareQBInvoiceIdentity(source, invoice)}));
  const exact = comparisons.filter(row => row.matches);
  if (exact.length === 1 && sameNumber.length === 1) {
    return {disposition:'link_existing', qboId:clean(exact[0].invoice.Id), match:exact[0].invoice, matches:exact, conflicts:[]};
  }
  return {
    disposition:'manual_review',
    matches:exact,
    conflicts:comparisons.map(row => ({
      qboId:clean(row.invoice.Id),
      documentNumber:clean(row.invoice.DocNumber),
      customerId:clean(row.invoice.CustomerRef?.value),
      date:clean(row.invoice.TxnDate).slice(0, 10),
      total:cents(row.invoice.TotalAmt) / 100,
      differences:row.differences,
    })),
  };
}

export function applyQBInvoiceLiveReadiness(rows = [], qboInvoices = []) {
  return (rows || []).map(row => {
    if (!row.duplicateCheckEligible) return row;
    const duplicate = classifyQBInvoiceDuplicate(row, qboInvoices);
    if (duplicate.disposition === 'create') return {...row, qboDisposition:row.action === 'ready' ? 'create' : 'blocked'};
    if (duplicate.disposition === 'link_existing') {
      return {...row, action:'link_existing', qboDisposition:'link_existing', qboId:duplicate.qboId,
        reason:'Exact QBO invoice already exists under an accepted document-number form'};
    }
    return {...row, action:'manual_review', qboDisposition:'manual_review',
      reason:'QBO invoice number exists but customer, date, amount, or uniqueness differs', conflicts:duplicate.conflicts};
  });
}

const escapeQBO = value => clean(value).replace(/'/g, "\\'");

export async function loadQBInvoicesForDuplicateCheck(qbApi, rows = [], {chunkSize=50} = {}) {
  const numbers = [...new Set((rows || []).flatMap(row => qbInvoiceDocumentNumberForms(row.documentNumber)))];
  const invoices = [];
  for (let start = 0; start < numbers.length; start += chunkSize) {
    const chunk = numbers.slice(start, start + chunkSize);
    const where = chunk.map(value => "'" + escapeQBO(value) + "'").join(',');
    const response = await qbApi('query', {query:
      `SELECT Id, DocNumber, CustomerRef, TxnDate, TotalAmt FROM Invoice WHERE DocNumber IN (${where}) MAXRESULTS 1000`});
    const fault = response?.Fault?.Error?.[0];
    if (fault) throw new Error(fault.Detail || fault.Message || 'QBO invoice duplicate query failed');
    invoices.push(...(response?.QueryResponse?.Invoice || []));
  }
  return [...new Map(invoices.map(invoice => [clean(invoice.Id), invoice])).values()];
}

export async function acquireQBInvoiceSyncClaim(client, {realmId, sourceId, claimToken, leaseSeconds=300}) {
  if (!client || !clean(realmId) || !clean(sourceId) || !clean(claimToken)) throw new Error('Invoice sync claim requires database, realm, source ID, and token.');
  const {data,error} = await client.rpc('acquire_qbo_invoice_sync_claim', {
    p_realm_id:clean(realmId), p_source_invoice_id:clean(sourceId), p_claim_token:clean(claimToken), p_lease_seconds:leaseSeconds,
  });
  if (error) throw new Error('Could not lock source invoice: ' + error.message);
  if (data !== true) throw new Error('Source invoice is already being processed by another QBO run.');
  return true;
}

export async function releaseQBInvoiceSyncClaim(client, {realmId, sourceId, claimToken}) {
  if (!client) return false;
  const {data,error} = await client.rpc('release_qbo_invoice_sync_claim', {
    p_realm_id:clean(realmId), p_source_invoice_id:clean(sourceId), p_claim_token:clean(claimToken),
  });
  if (error) throw new Error('Could not release source invoice lock: ' + error.message);
  return data === true;
}
