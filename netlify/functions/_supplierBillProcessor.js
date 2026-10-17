const { randomUUID } = require('crypto');
const { getSupabaseAdmin } = require('./_shared');
const { getValidAccessToken, qbRequest } = require('./_qb');
const {
  buildVendorBillLines,
  billVendorMatchName,
  findExistingVendorBill,
  findUniqueVendorMatch,
  normalizeVendorName,
  parseQBDateValue,
  qboAccountOnlyBill,
  qbWriteAccountRef,
  resolveQBAccountRefs,
} = require('../../src/qbAccountMappings');
const {
  mapQueuedSupplierBill,
  planSupplierBill,
  qboSupplierBillRequestId,
  supplierBillCoordinationKey,
} = require('../../src/lib/supplierBillAutomation');

const OWNER = 'netlify:supplier-bill-processor';
const num = value => Math.round((Number(value) || 0) * 100) / 100;
const clean = value => String(value == null ? '' : value).trim();
const norm = value => clean(value).toLowerCase();
const parseValue = value => {
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
};

const check = (result, label) => {
  if (result?.error) throw new Error(`${label}: ${result.error.message || result.error}`);
  return result?.data;
};

const withSignal = (query, signal) =>
  signal && typeof query?.abortSignal === 'function' ? query.abortSignal(signal) : query;

const signalUntil = (deadlineMs, unref = true) => {
  if (!deadlineMs) return null;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('Supplier bill operation exceeded its deadline')),
    Math.max(1, deadlineMs - Date.now()),
  );
  if (unref && typeof timer.unref === 'function') timer.unref();
  return controller.signal;
};

async function supplierBillAutomationEnabled(admin, signal) {
  const row = check(await withSignal(
    admin.from('supplier_bill_automation_settings').select('enabled').eq('id', 'national').maybeSingle(),
    signal,
  ), 'load supplier bill automation gate');
  return row?.enabled === true;
}

async function pageFiltered(makeQuery, accept, wanted, label, signal, maxRows = 20000) {
  const rows = [];
  const pageSize = 1000;
  let inspected = 0;
  let lastPageWasFull = false;
  for (let from = 0; from < maxRows && rows.length < wanted; from += pageSize) {
    const page = check(await withSignal(makeQuery().range(from, from + pageSize - 1), signal), label) || [];
    inspected += page.length;
    lastPageWasFull = page.length === pageSize;
    rows.push(...page.filter(accept));
    if (page.length < pageSize) break;
  }
  if (rows.length < wanted && inspected >= maxRows && lastPageWasFull) {
    throw new Error(`${label}: pagination truncated after ${maxRows} rows`);
  }
  return rows.slice(0, wanted);
}

async function markForReview(admin, claimToken, source, sourceId, bill, plan, signal) {
  const id = `server-${source}-${sourceId}`;
  const parsed = { ...bill, _auto_hold: [plan.reason], _server_review_code: plan.code };
  const hold = {
    id,
    file: `${bill.supplier || 'Supplier'} · Inv ${bill.doc_number || '?'}${bill.po_number ? ` · ${bill.po_number}` : ''}`,
    doc_number: bill.doc_number || null,
    si_doc_number: bill.si_doc_number == null ? null : String(bill.si_doc_number),
    source,
    vendor: bill.vendor || bill.supplier || null,
    po_number: bill.po_number || null,
    doc_total: Number(bill.doc_total) || null,
    freight: Number(bill.freight) || null,
    parsed,
    status: 'parked',
    portal_status: null,
    resolution: { disposition: 'server_review', note: plan.reason, by: OWNER, at: new Date().toISOString() },
    held_by: OWNER,
    updated_at: new Date().toISOString(),
  };
  check(await withSignal(admin.from('supplier_bill_holds').upsert(hold, { onConflict: 'id' }), signal), 'save review hold');
  if (source === 'ss_orders') {
    check(await withSignal(admin.from('ss_documents').update({ status: 'reviewed', updated_at: new Date().toISOString() })
      .eq('order_number', sourceId), signal), 'mark S&S review');
  } else if (source === 'sportsinc') {
    check(await withSignal(admin.from('si_documents').update({ status: 'review', updated_at: new Date().toISOString() })
      .eq('si_doc_number', sourceId), signal), 'mark Sports Inc review');
  }
  if (claimToken) {
    check(await withSignal(admin.rpc('finish_supplier_bill_claim', {
      p_claim_token: claimToken,
      p_status: 'review',
      p_code: plan.code,
      p_reason: plan.reason,
      p_payload: parsed,
      p_match_plan: plan.mappings || [],
    }), signal), 'finish review claim');
  }
}

async function markSourceApplied(admin, source, sourceId, bill, signal) {
  const patch = {
    applied_doc_number: bill.doc_number || null,
    resolved_by: OWNER,
    resolved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (source === 'ss_orders') {
    check(await withSignal(admin.from('ss_documents').update({ ...patch, status: 'applied' })
      .eq('order_number', sourceId), signal), 'self-heal S&S applied status');
  } else if (source === 'sportsinc') {
    check(await withSignal(admin.from('si_documents').update({ ...patch, status: 'approved' })
      .eq('si_doc_number', sourceId), signal), 'self-heal Sports Inc applied status');
  }
}

async function processPortalQueues(admin, limit = 20, claimOwner = `${OWNER}:${randomUUID()}`, options = {}) {
  const skipSourceKeys = options.skipSourceKeys || new Set();
  const querySignal = signalUntil(options.deadlineMs);
  const [ssRows, siRows] = await Promise.all([
    pageFiltered(
      () => admin.from('ss_documents').select('*').eq('status', 'new')
        .eq('has_usable_lines', true).order('invoice_date', { ascending: true }),
      row => !skipSourceKeys.has(`ss_orders|${row.order_number}`),
      limit,
      'load S&S queue',
      querySignal,
    ),
    pageFiltered(
      () => admin.from('si_documents').select('*').eq('status', 'new')
        .eq('source_type', 'edi').order('supplier_doc_date', { ascending: true }),
      row => !skipSourceKeys.has(`sportsinc|${row.si_doc_number}`),
      limit,
      'load Sports Inc queue',
      querySignal,
    ),
  ]);
  const queued = [
    ...ssRows.map(row => ({ source: 'ss_orders', sourceId: row.order_number, sortDate: row.invoice_date || row.order_date || '', row })),
    ...siRows.map(row => ({ source: 'sportsinc', sourceId: String(row.si_doc_number), sortDate: row.supplier_doc_date || row.si_doc_date || '', row })),
  ].sort((a, b) => String(a.sortDate).localeCompare(String(b.sortDate))).slice(0, limit);
  const summary = {
    scanned: queued.length, applied: 0, review: 0, busy: 0, failed: 0,
    sourceKeys: queued.map(entry => `${entry.source}|${entry.sourceId}`),
    busySourceKeys: [], retryableBusySourceKeys: [],
    timeBudgetReached: false,
  };

  for (const entry of queued) {
    if (options.deadlineMs && Date.now() >= options.deadlineMs) {
      summary.timeBudgetReached = true;
      break;
    }
    let bill;
    try {
      const signal = signalUntil(options.deadlineMs);
      bill = mapQueuedSupplierBill(entry.source, entry.row);
      const key = supplierBillCoordinationKey(bill);
      if (!key) throw new Error('missing stable bill identity');
      const claim = check(await withSignal(admin.rpc('claim_supplier_bill', {
        p_bill_key: key,
        p_doc_norm: norm(bill.doc_number),
        p_vendor: bill.vendor || bill.supplier || '',
        p_is_credit: !!bill.is_credit,
        p_source: entry.source,
        p_source_id: entry.sourceId,
        p_owner: claimOwner,
        p_allow_review: false,
      }), signal), 'claim bill');
      if (claim?.state === 'applied') {
        await markSourceApplied(admin, entry.source, entry.sourceId, bill, signal);
        summary.applied += 1;
        continue;
      }
      if (claim?.state === 'busy') {
        const sourceKey = `${entry.source}|${entry.sourceId}`;
        summary.busy += 1;
        summary.busySourceKeys.push(sourceKey);
        if (options.deadlineMs && Date.parse(claim.lease_until || '') <= options.deadlineMs) {
          summary.retryableBusySourceKeys.push(sourceKey);
        }
        continue;
      }
      if (claim?.state === 'review') {
        await markForReview(admin, null, entry.source, entry.sourceId, bill, {
          action: 'review',
          code: claim.code || 'server_review',
          reason: claim.reason || 'This bill is waiting for staff review.',
          mappings: [],
        }, signal);
        summary.review += 1;
        continue;
      }
      if (claim?.state === 'collision') {
        await markForReview(admin, null, entry.source, entry.sourceId, bill, {
          action: 'review',
          code: 'document_vendor_collision',
          reason: claim.reason || 'Document number already belongs to a different supplier.',
          mappings: [],
        }, signal);
        summary.review += 1;
        continue;
      }
      if (claim?.state !== 'claimed' || !claim.token) throw new Error(`unexpected claim state ${claim?.state || 'none'}`);

      const candidates = check(await withSignal(
        admin.rpc('supplier_bill_po_candidates', { p_po_number: bill.po_number }),
        signal,
      ), 'load PO candidates') || [];
      const plan = planSupplierBill(bill, candidates);
      if (plan.action !== 'apply') {
        await markForReview(admin, claim.token, entry.source, entry.sourceId, bill, plan, signal);
        summary.review += 1;
        continue;
      }
      const applied = check(await withSignal(admin.rpc('apply_claimed_supplier_bill', {
        p_claim_token: claim.token,
        p_bill: plan.bill,
        p_actor: OWNER,
      }), signal), 'apply supplier bill');
      if (!['applied', 'already_applied', 'ledger_repaired'].includes(applied?.state)) {
        throw new Error(`unexpected apply state ${applied?.state || 'none'}`);
      }
      summary.applied += 1;
    } catch (error) {
      summary.failed += 1;
      console.error('[supplier-bill] portal processing failed', entry.source, entry.sourceId, error.message || error);
    }
  }
  return summary;
}

async function queryAllQbo(entity, fields, accessToken, realmId, options = {}) {
  const rows = [];
  const request = options.request || qbRequest;
  for (let start = 1; ; start += 1000) {
    if (options.deadlineMs && Date.now() >= options.deadlineMs - 10000) {
      throw new Error(`QBO ${entity} pagination reached the time budget`);
    }
    const query = `SELECT ${fields} FROM ${entity} STARTPOSITION ${start} MAXRESULTS 1000`;
    const response = await request('GET', `/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`, accessToken);
    if (response.status !== 200 || response.data?.Fault) throw new Error(`QBO ${entity} read failed`);
    const page = response.data?.QueryResponse?.[entity] || [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function vendorLinkMap(rows) {
  const links = {};
  (rows || []).forEach(row => {
    const value = parseValue(row.value);
    if (value?.active !== false && value?.map_key === 'vendorQBMap' && value.source_id && value.qbo_id) {
      links[String(value.source_id)] = String(value.qbo_id);
    }
  });
  return links;
}

const deterministicQboReview = error => /vendor|account|document .* exists|date|total|credit|portal PO|not found|duplicated|ambiguous/i.test(error?.message || '');

async function prepareQuickBooksContext(admin, options = {}) {
  const querySignal = signalUntil(options.deadlineMs);
  const configResult = await withSignal(admin.from('app_state').select('value').eq('id', 'qb_config').maybeSingle(), querySignal);
  const qbConfig = parseValue(check(configResult, 'load QB config')?.value) || {};
  if (qbConfig.autoPushBillsToQB !== true || qbConfig.connected !== true || qbConfig.initialMigrationApproved !== true) {
    return { enabled: false };
  }
  if (qbConfig.preflight?.status !== 'success' || String(qbConfig.preflight?.realm_id || '') !== String(qbConfig.realm_id || '')) {
    return { enabled: false, reason: 'preflight' };
  }
  const tokenTimeoutMs = options.deadlineMs
    ? Math.max(1, Math.min(8000, options.deadlineMs - Date.now()))
    : 8000;
  const { access_token: accessToken, realm_id: realmId } = await getValidAccessToken(admin, 'national', {
    signal: signalUntil(options.deadlineMs),
    timeoutMs: tokenTimeoutMs,
  });
  if (String(realmId) !== String(qbConfig.realm_id)) throw new Error('QBO realm changed after preflight');
  const [accounts, qboVendors, portalVendorResult, linkResult] = await Promise.all([
    queryAllQbo('Account', 'Id, AcctNum, Name, FullyQualifiedName, AccountType, Active', accessToken, realmId, options),
    queryAllQbo('Vendor', 'Id, DisplayName, CompanyName, Active', accessToken, realmId, options),
    withSignal(admin.from('vendors').select('id,name,is_active,qb_vendor_id'), querySignal),
    withSignal(admin.from('app_state').select('id,value').like('id', '_qb_link_v1_%'), querySignal),
  ]);
  const portalVendors = check(portalVendorResult, 'load portal vendors') || [];
  const links = vendorLinkMap(check(linkResult, 'load vendor links') || []);
  const refs = resolveQBAccountRefs(accounts, qbConfig.mapping, ['purchases_account', 'freight_account', 'sports_inc_fee_account', 'ap_account']);
  return { enabled: true, qbConfig, accessToken, realmId, qboVendors, portalVendors, links, refs };
}

// The synchronous helper defaults to one QBO bill; the daily background runner
// raises the batch size and supplies a deadline so it can drain the backlog
// without starting a write too close to Netlify's execution ceiling.
async function processQuickBooks(admin, limit = 1, claimOwner = `${OWNER}:${randomUUID()}`, options = {}) {
  const skipLedgerIds = options.skipLedgerIds || new Set();
  const querySignal = signalUntil(options.deadlineMs);
  const qboContext = options.qboContext || await prepareQuickBooksContext(admin, options);
  if (qboContext.enabled !== true) {
    return { enabled: false, reason: qboContext.reason, scanned: 0, applied: 0, review: 0, busy: 0, failed: 0, ledgerIds: [], timeBudgetReached: false };
  }
  const { qbConfig, accessToken, realmId, qboVendors, portalVendors, links, refs } = qboContext;

  const ledger = await pageFiltered(
    () => admin.from('applied_bills').select('*')
      .eq('status', 'pushed').eq('portal_status', 'success').is('qb_status', null)
      .eq('qb_review_required', false).eq('is_credit', false)
      .order('applied_at', { ascending: true }),
    row => !skipLedgerIds.has(String(row.id)),
    limit,
    'load unsynced bills',
    querySignal,
  );
  if (!ledger.length) return { enabled: true, scanned: 0, applied: 0, review: 0, busy: 0, failed: 0, ledgerIds: [], timeBudgetReached: false };
  const summary = {
    enabled: true, scanned: ledger.length, applied: 0, review: 0, busy: 0, failed: 0,
    ledgerIds: ledger.map(row => String(row.id)), busyLedgerIds: [], retryableBusyLedgerIds: [], timeBudgetReached: false,
  };

  for (const row of ledger) {
    // Leave enough room for one bounded Intuit request and durable receipt.
    if (options.deadlineMs && Date.now() >= options.deadlineMs - 10000) {
      summary.timeBudgetReached = true;
      break;
    }
    const bill = row.raw_meta && typeof row.raw_meta === 'object' ? row.raw_meta : {};
    const key = supplierBillCoordinationKey({ ...bill, doc_number: row.doc_number || row.doc_norm, is_credit: row.is_credit });
    let claimToken = null;
    try {
      const signal = signalUntil(options.deadlineMs);
      const claim = check(await withSignal(admin.rpc('claim_supplier_bill_qbo', {
        p_bill_key: key,
        p_doc_norm: row.doc_norm,
        p_vendor: row.vendor || bill.vendor || bill.supplier || '',
        p_is_credit: !!row.is_credit,
        p_owner: claimOwner,
        p_allow_review: false,
      }), signal), 'claim QBO bill');
      if (claim?.state === 'applied') { summary.applied += 1; continue; }
      if (claim?.state === 'busy') {
        const ledgerId = String(row.id);
        summary.busy += 1;
        summary.busyLedgerIds.push(ledgerId);
        if (options.deadlineMs && Date.parse(claim.lease_until || '') <= options.deadlineMs) {
          summary.retryableBusyLedgerIds.push(ledgerId);
        }
        continue;
      }
      if (claim?.state === 'review') { summary.review += 1; continue; }
      if (claim?.state === 'collision') { summary.review += 1; continue; }
      if (claim?.state !== 'claimed' || !claim.token) throw new Error(`unexpected QBO claim state ${claim?.state || 'none'}`);
      claimToken = claim.token;

      const vendorName = billVendorMatchName(bill) || row.vendor;
      const portalVendor = findUniqueVendorMatch(vendorName, portalVendors);
      if (!portalVendor) throw new Error(`Vendor ${vendorName} is not uniquely present in the portal`);
      let vendorId = links[portalVendor.id] || portalVendor.qb_vendor_id;
      if (vendorId && !qboVendors.some(v => String(v.Id) === String(vendorId) && v.Active !== false)) vendorId = null;
      if (!vendorId) {
        const target = normalizeVendorName(vendorName);
        const matches = qboVendors.filter(v => v.Active !== false &&
          [v.DisplayName, v.CompanyName].some(name => normalizeVendorName(name) === target));
        if (matches.length !== 1) throw new Error(`Vendor ${vendorName} is not uniquely linked in QBO`);
        vendorId = matches[0].Id;
      }

      const accountBill = qboAccountOnlyBill({ ...bill, doc_number: row.doc_number || row.doc_norm, doc_total: row.doc_total });
      const built = buildVendorBillLines(accountBill, refs, {});
      const txnDate = parseQBDateValue(accountBill.doc_date);
      if (!txnDate) throw new Error('Bill date is missing or invalid');
      const docNumber = clean(row.doc_number || row.doc_norm);
      const escapedDoc = docNumber.replace(/'/g, "\\'");
      const duplicateResponse = await qbRequest('GET',
        `/v3/company/${realmId}/query?query=${encodeURIComponent(`SELECT Id, DocNumber, VendorRef, TotalAmt, TxnDate FROM Bill WHERE DocNumber = '${escapedDoc}' MAXRESULTS 100`)}`,
        accessToken);
      if (duplicateResponse.status !== 200 || duplicateResponse.data?.Fault) throw new Error('QBO Bill duplicate read failed');
      const existingRows = duplicateResponse.data?.QueryResponse?.Bill || [];
      const existing = findExistingVendorBill(existingRows, {
        docNumber, vendorId, total: built.total, txnDate,
      });
      let qbBill = existing;
      if (!qbBill) {
        const payload = {
          VendorRef: { value: String(vendorId) },
          APAccountRef: qbWriteAccountRef(refs.ap_account),
          TxnDate: txnDate,
          ...(parseQBDateValue(accountBill.due_date) ? { DueDate: parseQBDateValue(accountBill.due_date) } : {}),
          DocNumber: docNumber,
          Line: built.lines,
          PrivateNote: [`PO: ${accountBill.po_number || ''}`, `Server source: ${row.id}`].join(' | '),
        };
        const requestId = qboSupplierBillRequestId(realmId, { ...bill, doc_number: docNumber, is_credit: row.is_credit });
        const response = await qbRequest('POST', `/v3/company/${realmId}/bill?requestid=${encodeURIComponent(requestId)}`, accessToken, payload);
        if (response.status !== 200 || !response.data?.Bill?.Id) throw new Error('QBO bill create failed');
        qbBill = response.data.Bill;
        if (Math.abs(num(qbBill.TotalAmt) - built.total) >= 0.005 ||
            String(qbBill.VendorRef?.value || '') !== String(vendorId) ||
            String(qbBill.TxnDate || '').slice(0, 10) !== txnDate) {
          throw new Error(`QBO Bill #${qbBill.Id} stored different vendor, date, or total`);
        }
      }
      check(await withSignal(admin.from('applied_bills').update({
        qb_status: 'success',
        qb_bill_id: String(qbBill.Id),
        qb_message: existing ? `QB Bill #${qbBill.Id} (existing verified)` : `QB Bill #${qbBill.Id}`,
        qb_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', row.id), signal), 'save QBO receipt');
      check(await withSignal(admin.rpc('finish_supplier_bill_qbo_claim', {
        p_claim_token: claimToken, p_status: 'applied', p_reason: null,
      }), signal), 'finish QBO claim');
      summary.applied += 1;
    } catch (error) {
      const review = deterministicQboReview(error);
      try {
        await withSignal(admin.from('applied_bills').update({
          qb_message: `${review ? 'Needs review' : 'Automatic retry pending'}: ${error.message || String(error)}`,
          updated_at: new Date().toISOString(),
        }).eq('id', row.id), signalUntil(options.deadlineMs));
      } catch (_) {}
      if (claimToken) {
        try {
          await withSignal(admin.rpc('finish_supplier_bill_qbo_claim', {
            p_claim_token: claimToken,
            p_status: review ? 'review' : 'failed',
            p_reason: error.message || String(error),
          }), signalUntil(options.deadlineMs));
        } catch (_) {}
      }
      summary[review ? 'review' : 'failed'] += 1;
      console.error('[supplier-bill] QBO processing failed', row.id, error.message || error);
    }
  }
  return summary;
}

async function runSupplierBillProcessor({
  admin = getSupabaseAdmin(),
  portalLimit = 20,
  qboLimit = 1,
  gateLoader = supplierBillAutomationEnabled,
} = {}) {
  if (!(await gateLoader(admin))) {
    return {
      gated: true,
      portal: { scanned: 0, applied: 0, review: 0, busy: 0, failed: 0 },
      quickbooks: { enabled: false, scanned: 0, applied: 0, review: 0, busy: 0, failed: 0 },
    };
  }
  const claimOwner = `${OWNER}:${randomUUID()}`;
  const portal = await processPortalQueues(admin, portalLimit, claimOwner);
  let quickbooks;
  try { quickbooks = await processQuickBooks(admin, qboLimit, claimOwner); }
  catch (error) {
    console.error('[supplier-bill] QBO sweep failed', error.message || error);
    quickbooks = { enabled: true, scanned: 0, applied: 0, review: 0, busy: 0, failed: 1, error: error.message || String(error) };
  }
  return { portal, quickbooks };
}

const addSummary = (target, row) => {
  ['scanned', 'applied', 'review', 'busy', 'failed'].forEach(key => { target[key] += Number(row?.[key]) || 0; });
};

// Netlify background functions have a 15-minute ceiling. Stop at 13 minutes so
// the last QBO response and database receipt have time to settle. Source/ledger
// ids already attempted in this run are skipped on later pages; failures remain
// queued without poisoning the rest, and the thrown background run is retried.
async function runSupplierBillBacklog({
  admin = getSupabaseAdmin(),
  timeBudgetMs = 13 * 60 * 1000,
  portalBatchSize = 100,
  qboBatchSize = 50,
  clock = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  gateLoader = supplierBillAutomationEnabled,
  qboContextLoader = prepareQuickBooksContext,
  portalProcessor = processPortalQueues,
  qboProcessor = processQuickBooks,
} = {}) {
  const startedAt = clock();
  const deadlineMs = startedAt + timeBudgetMs;
  if (!(await gateLoader(admin, signalUntil(deadlineMs)))) {
    return {
      gated: true,
      portal: { scanned: 0, applied: 0, review: 0, busy: 0, failed: 0, batches: 0, timeBudgetReached: false },
      quickbooks: { enabled: false, scanned: 0, applied: 0, review: 0, busy: 0, failed: 0, batches: 0, timeBudgetReached: false },
      duration_ms: clock() - startedAt,
      time_budget_reached: false,
    };
  }
  // Reserve most of the background window for Intuit I/O; Portal writes are
  // database-only and get the first third (capped at four minutes).
  const portalDeadlineMs = Math.min(deadlineMs, startedAt + Math.min(4 * 60 * 1000, Math.floor(timeBudgetMs / 3)));
  const claimOwner = `${OWNER}:daily:${randomUUID()}`;
  const portal = { scanned: 0, applied: 0, review: 0, busy: 0, failed: 0, batches: 0, timeBudgetReached: false };
  const quickbooks = { enabled: true, scanned: 0, applied: 0, review: 0, busy: 0, failed: 0, batches: 0, timeBudgetReached: false };
  const seenSources = new Set();
  const seenLedger = new Set();
  let portalDrained = false;
  let qboDrained = false;

  while (clock() < portalDeadlineMs) {
    const row = await portalProcessor(admin, portalBatchSize, claimOwner, { deadlineMs: portalDeadlineMs, skipSourceKeys: seenSources });
    portal.batches += 1;
    addSummary(portal, row);
    const retryableBusySources = new Set(row.retryableBusySourceKeys || []);
    const completedSources = (row.sourceKeys || []).filter(key => !retryableBusySources.has(key));
    completedSources.forEach(key => seenSources.add(key));
    if (row.timeBudgetReached) { portal.timeBudgetReached = true; break; }
    if (!row.scanned) { portalDrained = true; break; }
    if (!completedSources.length && retryableBusySources.size > 0) {
      await sleep(Math.min(30000, Math.max(0, portalDeadlineMs - clock())));
    }
  }
  if (!portalDrained && clock() >= portalDeadlineMs) portal.timeBudgetReached = true;

  // Account/vendor/token reads are stable for one run and can be expensive.
  // Load them once, then reuse them across every QBO ledger batch.
  const qboContext = await qboContextLoader(admin, { deadlineMs });
  while (clock() < deadlineMs) {
    const row = await qboProcessor(admin, qboBatchSize, claimOwner, {
      deadlineMs,
      skipLedgerIds: seenLedger,
      ...(qboContext ? { qboContext } : {}),
    });
    quickbooks.batches += 1;
    quickbooks.enabled = row.enabled !== false;
    if (row.reason) quickbooks.reason = row.reason;
    addSummary(quickbooks, row);
    const retryableBusyLedger = new Set((row.retryableBusyLedgerIds || []).map(String));
    const completedLedger = (row.ledgerIds || []).map(String).filter(id => !retryableBusyLedger.has(id));
    completedLedger.forEach(id => seenLedger.add(id));
    if (row.timeBudgetReached) { quickbooks.timeBudgetReached = true; break; }
    if (row.enabled === false || !row.scanned) { qboDrained = true; break; }
    if (!completedLedger.length && retryableBusyLedger.size > 0) {
      await sleep(Math.min(30000, Math.max(0, deadlineMs - clock())));
    }
  }
  if (!qboDrained && clock() >= deadlineMs) quickbooks.timeBudgetReached = true;

  const finishedAt = clock();
  return {
    portal,
    quickbooks,
    duration_ms: finishedAt - startedAt,
    time_budget_reached: finishedAt >= deadlineMs || portal.timeBudgetReached || quickbooks.timeBudgetReached,
  };
}

module.exports = {
  OWNER,
  deterministicQboReview,
  pageFiltered,
  prepareQuickBooksContext,
  processPortalQueues,
  processQuickBooks,
  queryAllQbo,
  runSupplierBillBacklog,
  runSupplierBillProcessor,
  signalUntil,
  supplierBillAutomationEnabled,
  vendorLinkMap,
};
