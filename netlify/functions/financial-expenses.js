const { verifyQBOUser } = require('./_shared');
const { getValidAccessToken, qbRequest } = require('./_qb');
const { OWNERS, UUID, check, validateInput, validateMappings, buildPayload, matchesPosting, receiptBuffer } = require('./_financialExpenses');
const TABLE = 'financial_expenses';
const BUCKET = 'expense-receipts';
const FIELDS = 'id,company_key,realm_id,submitted_by,merchant,expense_date,amount_cents,currency,purpose,payment_kind,expense_account_id,expense_account_number,expense_account_name,payment_account_id,payment_account_number,payment_account_name,vendor_id,vendor_name,receipt_name,status,qb_entity_type,qb_entity_id,last_error,posted_at,created_at,updated_at';
const db = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
async function connection(admin, company) {
  const { access_token, realm_id } = await getValidAccessToken(admin, company);
  const request = async (method, path, body) => {
    const result = await qbRequest(method, `/v3/company/${realm_id}${path}`, access_token, body);
    if (result.status < 200 || result.status >= 300 || result.data?.Fault) {
      const message = result.data?.Fault?.Error?.map(e => e.Detail || e.Message).join('; ');
      throw new Error(message || `QuickBooks request failed (${result.status}).`);
    }
    return result.data;
  };
  const query = async (sql, entity) => (await request('GET', `/query?query=${encodeURIComponent(sql)}`)).QueryResponse?.[entity] || [];
  return { realm_id: String(realm_id), request, query };
}
async function getMappings(qbo, row) {
  for (const id of [row.expense_account_id, row.payment_account_id, row.vendor_id].filter(Boolean)) check(/^\d+$/.test(id), 'Invalid QuickBooks account or payee ID.');
  const refs = await Promise.all([
    qbo.request('GET', `/account/${row.expense_account_id}`),
    qbo.request('GET', `/account/${row.payment_account_id}`),
    row.vendor_id ? qbo.request('GET', `/vendor/${row.vendor_id}`) : Promise.resolve({}),
  ]);
  return validateMappings(row, [refs[0].Account, refs[1].Account].filter(Boolean), refs[2].Vendor ? [refs[2].Vendor] : []);
}
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  let claimedId = null, admin;
  try {
    const auth = await verifyQBOUser(event);
    if (!auth.ok) return reply(auth.status, { error: auth.error });
    if (!OWNERS.has(String(auth.teamMemberId))) return reply(403, { error: 'Financials owner access required.' });
    admin = auth.admin;
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON.' }); }
    check(body && typeof body === 'object' && !Array.isArray(body), 'Invalid request.');
    const company = body.company;
    check(['national', 'methodic'].includes(company), 'Choose a business.');

    if (body.action === 'list') {
      const offset = Number(body.offset || 0);
      check(Number.isInteger(offset) && offset >= 0 && offset <= 100000, 'Invalid page.');
      const rows = db(await admin.from(TABLE).select(FIELDS).eq('company_key', company)
        .order('created_at', { ascending: false }).order('id').range(offset, offset + 49));
      return reply(200, { expenses: rows, nextOffset: rows.length === 50 ? offset + 50 : null });
    }
    if (body.action === 'options') {
      const qbo = await connection(admin, company);
      let accounts = [];
      for (let start = 1; ; start += 1000) {
        const page = await qbo.query(`SELECT * FROM Account WHERE Active = true STARTPOSITION ${start} MAXRESULTS 1000`, 'Account');
        accounts.push(...page);
        if (page.length < 1000) break;
        check(start < 5000, 'Too many accounts to load. Contact support.');
      }
      return reply(200, { realm_id: qbo.realm_id, accounts: accounts.map(a => ({
        Id: a.Id,
        AcctNum: a.AcctNum || '',
        Name: a.FullyQualifiedName || a.Name,
        AccountType: a.AccountType,
        CurrencyRef: a.CurrencyRef,
      })) });
    }
    if (body.action === 'vendors') {
      check(typeof body.search === 'string' && body.search.trim().length >= 2 && body.search.length <= 100, 'Enter at least two characters of the reimbursement payee name.');
      const qbo = await connection(admin, company);
      const search = body.search.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[%_]/g, '');
      const vendors = await qbo.query(`SELECT * FROM Vendor WHERE Active = true AND DisplayName LIKE '%${search}%' MAXRESULTS 50`, 'Vendor');
      return reply(200, { vendors: vendors.filter(v => !v.CurrencyRef?.value || v.CurrencyRef.value === 'USD').map(v => ({ Id: v.Id, DisplayName: v.DisplayName })) });
    }
    if (body.action === 'submit') {
      const row = validateInput(body);
      const existing = db(await admin.from(TABLE).select(FIELDS).eq('id', row.id).maybeSingle());
      if (existing) {
        check(existing.company_key === company && existing.submitted_by === auth.teamMemberId, 'Submission ID already belongs to another expense.');
        return reply(200, { expense: existing, alreadySubmitted: true });
      }
      const receipt = receiptBuffer(body.receipt);
      const qbo = await connection(admin, company);
      check(body.realm_id === qbo.realm_id, 'The QuickBooks connection changed. Reload account choices before submitting.');
      const mapping = await getMappings(qbo, row);
      row.realm_id = qbo.realm_id;
      row.submitted_by = auth.teamMemberId;
      row.expense_account_number = mapping.expense.AcctNum || null;
      row.expense_account_name = mapping.expense.FullyQualifiedName || mapping.expense.Name;
      row.payment_account_number = mapping.payment.AcctNum || null;
      row.payment_account_name = mapping.payment.FullyQualifiedName || mapping.payment.Name;
      row.vendor_name = mapping.vendor?.DisplayName || null;
      row.qb_entity_type = row.payment_kind === 'personal' ? 'Bill' : 'Purchase';
      row.qb_payload = buildPayload(row, mapping);
      if (receipt) {
        row.receipt_path = `${company}/${row.id}/receipt`;
        row.receipt_name = receipt.name;
        const upload = await admin.storage.from(BUCKET).upload(row.receipt_path, receipt.buffer, { contentType: receipt.type, upsert: false });
        // Same submission ID retries reuse the first immutable uploaded receipt.
        if (upload.error && String(upload.error.statusCode) !== '409' && !/already exists|duplicate/i.test(upload.error.message || '')) throw new Error(upload.error.message);
      }
      const inserted = await admin.from(TABLE).insert(row).select(FIELDS).single();
      if (inserted.error?.code === '23505') {
        const prior = db(await admin.from(TABLE).select(FIELDS).eq('id', row.id).single());
        check(prior.company_key === company && prior.submitted_by === auth.teamMemberId, 'Submission ID conflict.');
        return reply(200, { expense: prior, alreadySubmitted: true });
      }
      return reply(200, { expense: db(inserted) });
    }
    check(['receipt', 'post', 'cancel'].includes(body.action), 'Unknown expense action.');
    check(UUID.test(body.id || ''), 'Invalid expense ID.');
    const row = db(await admin.from(TABLE).select('*').eq('id', body.id).eq('company_key', company).maybeSingle());
    if (!row) return reply(404, { error: 'Expense not found in this business.' });
    if (body.action === 'receipt') {
      check(row.receipt_path, 'No receipt attached.');
      const signed = db(await admin.storage.from(BUCKET).createSignedUrl(row.receipt_path, 60));
      return reply(200, { url: signed.signedUrl });
    }
    if (body.action === 'cancel') {
      const cancelled = db(await admin.from(TABLE).update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('status', 'submitted').select(FIELDS).maybeSingle());
      if (!cancelled) return reply(409, { error: 'Only submissions that have never been posted can be cancelled. Reconcile any posting attempt first.' });
      return reply(200, { expense: cancelled });
    }
    check(row.status !== 'cancelled', 'This submission was cancelled.');
    if (row.status === 'posted') return reply(200, { expense: row, alreadyPosted: true });
    const qbo = await connection(admin, company);
    check(qbo.realm_id === row.realm_id, 'This expense belongs to a different QuickBooks company connection. Restore that connection before posting.');
    // Compare-and-set claim; timed-out invocations can be recovered after two minutes.
    const cutoff = new Date(Date.now() - 120000).toISOString();
    const claimed = db(await admin.from(TABLE).update({ status: 'posting', updated_at: new Date().toISOString(), last_error: null })
      .eq('id', row.id).eq('company_key', company)
      .or(`status.in.(submitted,error),and(status.eq.posting,updated_at.lt.${cutoff})`).select('id').maybeSingle());
    if (!claimed) return reply(409, { error: 'Posting is already in progress. Refresh, or retry after two minutes.' });
    claimedId = row.id;
    // Recover a successful QBO write whose local acknowledgement was lost.
    // A document-number collision or edited remote transaction requires manual review.
    const found = await qbo.query(`SELECT * FROM ${row.qb_entity_type} WHERE DocNumber = '${row.qb_payload.DocNumber}' MAXRESULTS 2`, row.qb_entity_type);
    let entity;
    if (found.length) {
      check(found.length === 1 && matchesPosting(found[0], row.qb_payload), 'A conflicting QuickBooks transaction exists. Review it before retrying.');
      entity = found[0];
    } else {
      await getMappings(qbo, row);
      const result = await qbo.request('POST', `/${row.qb_entity_type.toLowerCase()}?requestid=${row.id}`, row.qb_payload);
      entity = result[row.qb_entity_type];
      check(entity?.Id && matchesPosting(entity, row.qb_payload), 'QuickBooks returned an unexpected posting result. Retry to reconcile it.');
    }
    const saved = db(await admin.from(TABLE).update({ status: 'posted', qb_entity_id: String(entity.Id),
      posted_at: new Date().toISOString(), posted_by: auth.teamMemberId, updated_at: new Date().toISOString(), last_error: null })
      .eq('id', row.id).eq('status', 'posting').select(FIELDS).single());
    return reply(200, { expense: saved });
  } catch (error) {
    if (claimedId && admin) {
      // Preserve immutable payload and request ID even for ambiguous network failures.
      await admin.from(TABLE).update({ status: 'error', last_error: String(error.message).slice(0, 1000), updated_at: new Date().toISOString() })
        .eq('id', claimedId).eq('status', 'posting');
    }
    return reply(error.status || 500, { error: error.message || 'Expense request failed.' });
  }
};
