// Deliberately separate from sync engines: this collector can only request reads.
export const AUDIT_REALM = '9341456492604246';
export const AUDIT_ENTITIES = ['Account', 'Vendor', 'Customer', 'Item', 'JournalEntry', 'Bill', 'VendorCredit', 'BillPayment', 'Invoice', 'Payment', 'CreditMemo', 'Purchase', 'Deposit'];
const LISTS = new Set(['Account', 'Vendor', 'Customer', 'Item']);

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function checked(result) {
  if (!result || result.error || result.Fault || result.__qbTransportError) {
    throw new Error(result?.error || result?.Fault?.Error?.[0]?.Detail || 'QBO read failed; export is incomplete.');
  }
  return result;
}

export async function collectQBAudit({ read, cutoff, captureThrough, onProgress = () => {}, signal }) {
  if (!validDate(cutoff) || !validDate(captureThrough) || cutoff > captureThrough) {
    throw new Error('Choose valid dates with the audit cutoff on or before the capture-through date.');
  }
  const call = async (action, payload = {}) => {
    if (signal?.aborted) throw new Error('Audit stopped. No complete export was produced.');
    if (!['connection_status', 'company_info', 'query'].includes(action)) throw new Error('Read action only.');
    return checked(await read(action, payload));
  };
  const connection = await call('connection_status');
  if (!connection.connected || String(connection.realm_id) !== AUDIT_REALM) throw new Error('Wrong or disconnected QBO company; no transactions read.');
  const company = (await call('company_info')).CompanyInfo;
  if (!company || company.CompanyName?.trim().toLowerCase() !== 'national sports apparel llc') throw new Error('Live QBO company identity could not be verified.');
  const report = {
    format: 'nsa-qbo-audit-v1', realmId: AUDIT_REALM, companyName: company.CompanyName,
    cutoff, captureThrough, startedAt: new Date().toISOString(), complete: false,
    notice: 'Current transaction records and application links, not a historical aging report. Later-dated records are included to trace later applications. Deleted records and historical versions are not supplied. Compare with the May 31 aging and source GL before proposing corrections. The capture is paginated, not an atomic snapshot.',
    entities: {},
  };
  for (const entity of AUDIT_ENTITIES) {
    const records = [], seen = new Set();
    let done = false, pageSize = 500;
    for (let start = 1; start <= 100000;) {
      const where = LISTS.has(entity) ? 'Active IN (true, false)' : `TxnDate <= '${captureThrough}'`;
      let result;
      for (;;) {
        const query = `SELECT * FROM ${entity} WHERE ${where} ORDERBY Id STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
        try { result = await call('query', { query }); break; }
        catch (error) {
          if (!signal?.aborted && [500, 502, 503, 504].includes(error.status) && pageSize > 20) {
            pageSize = pageSize === 500 ? 100 : 20;
            onProgress({ entity, count: records.length });
            continue;
          }
          throw new Error(`${entity}, record ${start}: ${error.message}`);
        }
      }
      const response = result.QueryResponse;
      if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error(`${entity}: invalid query response.`);
      const page = response[entity] === undefined ? [] : response[entity];
      if (!Array.isArray(page) || page.length > pageSize) throw new Error(`${entity}: invalid page.`);
      for (const row of page) {
        if (!row?.Id || seen.has(String(row.Id))) throw new Error(`${entity}: missing or repeated ID; restart capture.`);
        seen.add(String(row.Id)); records.push(row);
      }
      onProgress({ entity, count: records.length });
      if (page.length < pageSize) { done = true; break; }
      start += page.length;
    }
    if (!done) throw new Error(`${entity}: safety limit reached; export is incomplete.`);
    report.entities[entity] = records;
  }
  // Recheck the connection after capture. A realm change invalidates the export.
  const finalConnection = await call('connection_status');
  if (!finalConnection.connected || String(finalConnection.realm_id) !== AUDIT_REALM) throw new Error('QBO connection changed during capture; discard export.');
  report.complete = true;
  report.finishedAt = new Date().toISOString();
  return report;
}
