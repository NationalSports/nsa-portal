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

async function markForReview(admin, claimToken, source, sourceId, bill, plan) {
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
  check(await admin.from('supplier_bill_holds').upsert(hold, { onConflict: 'id' }), 'save review hold');
  if (source === 'ss_orders') {
    check(await admin.from('ss_documents').update({ status: 'reviewed', updated_at: new Date().toISOString() })
      .eq('order_number', sourceId), 'mark S&S review');
  } else if (source === 'sportsinc') {
    check(await admin.from('si_documents').update({ status: 'review', updated_at: new Date().toISOString() })
      .eq('si_doc_number', sourceId), 'mark Sports Inc review');
  }
  if (claimToken) {
    check(await admin.rpc('finish_supplier_bill_claim', {
      p_claim_token: claimToken,
      p_status: 'review',
      p_code: plan.code,
      p_reason: plan.reason,
      p_payload: parsed,
      p_match_plan: plan.mappings || [],
    }), 'finish review claim');
  }
}

async function markSourceApplied(admin, source, sourceId, bill) {
  const patch = {
    applied_doc_number: bill.doc_number || null,
    resolved_by: OWNER,
    resolved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (source === 'ss_orders') {
    check(await admin.from('ss_documents').update({ ...patch, status: 'applied' })
      .eq('order_number', sourceId), 'self-heal S&S applied status');
  } else if (source === 'sportsinc') {
    check(await admin.from('si_documents').update({ ...patch, status: 'approved' })
      .eq('si_doc_number', sourceId), 'self-heal Sports Inc applied status');
  }
}

async function processPortalQueues(admin, limit = 20, claimOwner = `${OWNER}:${randomUUID()}`) {
  const [ssResult, siResult] = await Promise.all([
    admin.from('ss_documents').select('*').eq('status', 'new')
      .eq('has_usable_lines', true).order('invoice_date', { ascending: true }).limit(limit),
    admin.from('si_documents').select('*').eq('status', 'new')
      .eq('source_type', 'edi').order('supplier_doc_date', { ascending: true }).limit(limit),
  ]);
  const queued = [
    ...(check(ssResult, 'load S&S queue') || []).map(row => ({ source: 'ss_orders', sourceId: row.order_number, sortDate: row.invoice_date || row.order_date || '', row })),
    ...(check(siResult, 'load Sports Inc queue') || []).map(row => ({ source: 'sportsinc', sourceId: String(row.si_doc_number), sortDate: row.supplier_doc_date || row.si_doc_date || '', row })),
  ].sort((a, b) => String(a.sortDate).localeCompare(String(b.sortDate))).slice(0, limit);
  const summary = { scanned: queued.length, applied: 0, review: 0, busy: 0, failed: 0 };

  for (const entry of queued) {
    let bill;
    try {
      bill = mapQueuedSupplierBill(entry.source, entry.row);
      const key = supplierBillCoordinationKey(bill);
      if (!key) throw new Error('missing stable bill identity');
      const claim = check(await admin.rpc('claim_supplier_bill', {
        p_bill_key: key,
        p_doc_norm: norm(bill.doc_number),
        p_vendor: bill.vendor || bill.supplier || '',
        p_is_credit: !!bill.is_credit,
        p_source: entry.source,
        p_source_id: entry.sourceId,
        p_owner: claimOwner,
        p_allow_review: false,
      }), 'claim bill');
      if (claim?.state === 'applied') {
        await markSourceApplied(admin, entry.source, entry.sourceId, bill);
        summary.applied += 1;
        continue;
      }
      if (claim?.state === 'busy') {
        summary.busy += 1;
        continue;
      }
      if (claim?.state === 'review') {
        summary.review += 1;
        continue;
      }
      if (claim?.state === 'collision') {
        await markForReview(admin, null, entry.source, entry.sourceId, bill, {
          action: 'review',
          code: 'document_vendor_collision',
          reason: claim.reason || 'Document number already belongs to a different supplier.',
          mappings: [],
        });
        summary.review += 1;
        continue;
      }
      if (claim?.state !== 'claimed' || !claim.token) throw new Error(`unexpected claim state ${claim?.state || 'none'}`);

      const candidates = check(await admin.rpc('supplier_bill_po_candidates', { p_po_number: bill.po_number }), 'load PO candidates') || [];
      const plan = planSupplierBill(bill, candidates);
      if (plan.action !== 'apply') {
        await markForReview(admin, claim.token, entry.source, entry.sourceId, bill, plan);
        summary.review += 1;
        continue;
      }
      const applied = check(await admin.rpc('apply_claimed_supplier_bill', {
        p_claim_token: claim.token,
        p_bill: plan.bill,
        p_actor: OWNER,
      }), 'apply supplier bill');
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

async function queryAllQbo(entity, fields, accessToken, realmId, max = 5000) {
  const rows = [];
  for (let start = 1; start <= max; start += 1000) {
    const query = `SELECT ${fields} FROM ${entity} STARTPOSITION ${start} MAXRESULTS 1000`;
    const response = await qbRequest('GET', `/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`, accessToken);
    if (response.status !== 200 || response.data?.Fault) throw new Error(`QBO ${entity} read failed`);
    const page = response.data?.QueryResponse?.[entity] || [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
  throw new Error(`QBO ${entity} population exceeds ${max}`);
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

// One QBO bill per run leaves room for account/vendor reads, a document-specific
// duplicate query, the write, and its receipt inside Netlify's 30-second ceiling.
// The five-minute cadence still drains twelve bills/hour.
async function processQuickBooks(admin, limit = 1, claimOwner = `${OWNER}:${randomUUID()}`) {
  const configResult = await admin.from('app_state').select('value').eq('id', 'qb_config').maybeSingle();
  const qbConfig = parseValue(check(configResult, 'load QB config')?.value) || {};
  if (qbConfig.autoPushBillsToQB !== true || qbConfig.connected !== true || qbConfig.initialMigrationApproved !== true) {
    return { enabled: false, scanned: 0, applied: 0, review: 0, busy: 0, failed: 0 };
  }
  if (qbConfig.preflight?.status !== 'success' || String(qbConfig.preflight?.realm_id || '') !== String(qbConfig.realm_id || '')) {
    return { enabled: false, reason: 'preflight', scanned: 0, applied: 0, review: 0, busy: 0, failed: 0 };
  }

  const ledger = check(await admin.from('applied_bills').select('*')
    .eq('status', 'pushed').eq('portal_status', 'success').is('qb_status', null)
    .eq('qb_review_required', false).eq('is_credit', false)
    .order('applied_at', { ascending: true }).limit(limit), 'load unsynced bills') || [];
  if (!ledger.length) return { enabled: true, scanned: 0, applied: 0, review: 0, busy: 0, failed: 0 };

  const { access_token: accessToken, realm_id: realmId } = await getValidAccessToken(admin, 'national');
  if (String(realmId) !== String(qbConfig.realm_id)) throw new Error('QBO realm changed after preflight');
  const [accounts, qboVendors, portalVendorResult, linkResult] = await Promise.all([
    queryAllQbo('Account', 'Id, AcctNum, Name, FullyQualifiedName, AccountType, Active', accessToken, realmId),
    queryAllQbo('Vendor', 'Id, DisplayName, CompanyName, Active', accessToken, realmId),
    admin.from('vendors').select('id,name,is_active,qb_vendor_id'),
    admin.from('app_state').select('id,value').like('id', '_qb_link_v1_%'),
  ]);
  const portalVendors = check(portalVendorResult, 'load portal vendors') || [];
  const links = vendorLinkMap(check(linkResult, 'load vendor links') || []);
  const refs = resolveQBAccountRefs(accounts, qbConfig.mapping, ['purchases_account', 'freight_account', 'sports_inc_fee_account', 'ap_account']);
  const summary = { enabled: true, scanned: ledger.length, applied: 0, review: 0, busy: 0, failed: 0 };

  for (const row of ledger) {
    const bill = row.raw_meta && typeof row.raw_meta === 'object' ? row.raw_meta : {};
    const key = supplierBillCoordinationKey({ ...bill, doc_number: row.doc_number || row.doc_norm, is_credit: row.is_credit });
    let claimToken = null;
    try {
      const claim = check(await admin.rpc('claim_supplier_bill_qbo', {
        p_bill_key: key,
        p_doc_norm: row.doc_norm,
        p_vendor: row.vendor || bill.vendor || bill.supplier || '',
        p_is_credit: !!row.is_credit,
        p_owner: claimOwner,
        p_allow_review: false,
      }), 'claim QBO bill');
      if (claim?.state === 'applied') { summary.applied += 1; continue; }
      if (claim?.state === 'busy') { summary.busy += 1; continue; }
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
      check(await admin.from('applied_bills').update({
        qb_status: 'success',
        qb_bill_id: String(qbBill.Id),
        qb_message: existing ? `QB Bill #${qbBill.Id} (existing verified)` : `QB Bill #${qbBill.Id}`,
        qb_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', row.id), 'save QBO receipt');
      check(await admin.rpc('finish_supplier_bill_qbo_claim', {
        p_claim_token: claimToken, p_status: 'applied', p_reason: null,
      }), 'finish QBO claim');
      summary.applied += 1;
    } catch (error) {
      const review = deterministicQboReview(error);
      try {
        await admin.from('applied_bills').update({
          qb_message: `${review ? 'Needs review' : 'Automatic retry pending'}: ${error.message || String(error)}`,
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
      } catch (_) {}
      if (claimToken) {
        try {
          await admin.rpc('finish_supplier_bill_qbo_claim', {
            p_claim_token: claimToken,
            p_status: review ? 'review' : 'failed',
            p_reason: error.message || String(error),
          });
        } catch (_) {}
      }
      summary[review ? 'review' : 'failed'] += 1;
      console.error('[supplier-bill] QBO processing failed', row.id, error.message || error);
    }
  }
  return summary;
}

async function runSupplierBillProcessor({ admin = getSupabaseAdmin(), portalLimit = 20, qboLimit = 1 } = {}) {
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

module.exports = {
  OWNER,
  deterministicQboReview,
  processPortalQueues,
  processQuickBooks,
  queryAllQbo,
  runSupplierBillProcessor,
  vendorLinkMap,
};
