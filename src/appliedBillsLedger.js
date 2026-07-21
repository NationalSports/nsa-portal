// Pure helpers for the applied_bills server ledger — the supplier-bill system of
// record (Spec 1, FABLE_HANDOFF_SPECS_2026-07-07). Extracted from App.js so the
// row shaping, pre-migration fallback, and the Bill History union are unit-testable.
import { safeNum } from './safeHelpers';
import { billAnomalyFlags } from './lib/billAnomalies';

const _norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

// Bill totals normally arrive as numbers, but can round-trip as numeric strings
// (JSON re-parse / Postgres numeric). safeNum is number-typed only and would silently
// null a string total — coerce here instead. Garbage still maps to 0.
const _total = (v) => { const n = typeof v === 'number' ? v : (v == null || String(v).trim() === '' ? NaN : Number(v)); return Number.isFinite(n) ? n : 0; };

// Shape ledger rows (full, post-00184 column set) from pushed bills. One row per
// keyable bill — a bill with neither a doc # nor an SI/S&S order # can't be keyed
// and stays guarded by the client-side SO _bill_details scan.
export const buildAppliedBillRows = (bills, appliedBy) => {
  const rows = [];
  (bills || []).forEach((b) => {
    const p = b && b.parsed;
    if (!p) return;
    const d = _norm(p.doc_number);
    const s = _norm(p.si_doc_number);
    if (!d && !s) return;
    const soId = p.matchedPO?.so_id || p.matchedPO?.so?.id || null;
    rows.push({
      doc_norm: d || null,
      doc_number: String(p.doc_number == null ? '' : p.doc_number).trim() || null,
      si_doc_number: s || null,
      is_credit: !!p.is_credit,
      vendor: p.vendor || p.supplier || null,
      po_number: p.po_number || null,
      doc_total: _total(p.doc_total) || null,
      source: p.source || null,
      applied_by: appliedBy || null,
      status: 'pushed',
      portal_status: b.portalStatus || 'success',
      applied_so_ids: soId ? [String(soId)] : null,
      // How this push got matched — the accept/override telemetry the 2026-07-21 mining
      // found missing (resolution was NULL on every row, so auto-accept widening couldn't
      // be sized from data). auto_pushed = pushed with no human click; auto_tied = the
      // clean-class sweep staged the match; ai_* = the AI reconcile pass touched lines.
      resolution: {
        auto_pushed: !!p._auto_pushed,
        auto_tied: !!p._auto_tied,
        ai_reconciled: !!p._aiMatched,
        ai_changed: p._aiChangedCount || 0,
        overage_ok: !!p._overage_ok,
        lines: (p._lineMappings || []).length,
        // Post-push review net (shared rules: src/lib/billAnomalies.js — the daily
        // anomaly email recomputes these from raw_meta, so old rows work too).
        flags: billAnomalyFlags(p),
      },
      // Enough to render this bill's history row on a machine that never saw the
      // PDF. rawText/_wizard/_applyKey are big or transient — stripped, same as holds.
      raw_meta: { ...p, rawText: undefined, _wizard: undefined, _applyKey: undefined },
      updated_at: new Date().toISOString(),
    });
  });
  return rows;
};

// Column set that existed before migration 00184 — the fallback payload when the
// upsert reports an unknown column (ledger table not yet migrated).
export const LEGACY_APPLIED_BILL_COLS = ['doc_norm', 'si_doc_number', 'is_credit', 'vendor', 'po_number', 'doc_total', 'source', 'applied_by'];
export const legacyAppliedBillRows = (rows) => (rows || []).map((r) => {
  const o = {};
  LEGACY_APPLIED_BILL_COLS.forEach((k) => { o[k] = r[k] === undefined ? null : r[k]; });
  return o;
});

// PostgREST/Postgres signatures for "column doesn't exist / not in schema cache" —
// same missingFn-style detection the counters RPC uses for missing functions.
export const isMissingLedgerColumnError = (e) => !!e && (e.code === '42703' || e.code === 'PGRST204' ||
  /column .*(does not exist|schema cache)|could not find the .*column/i.test(e.message || ''));

// Union of local saved-bill history and server ledger rows for the Bill History
// view. Local entries win (richer live state: reviewLater, QB status, wizard
// edits); server rows this browser has never seen become read-only pushed entries,
// so pushed history survives cleared localStorage and the local cache cap.
// Credit notes and invoices legitimately share a doc # — keys include is_credit.
export const mergeServerBills = (savedBills, serverRows) => {
  const local = savedBills || [];
  const seen = new Set();
  local.forEach((sb) => {
    const p = sb.parsed || {};
    const c = p.is_credit ? '1' : '0';
    const d = _norm(p.doc_number);
    if (d) seen.add('d|' + c + '|' + d);
    const s = _norm(p.si_doc_number);
    if (s) seen.add('s|' + c + '|' + s);
  });
  const extras = [];
  (serverRows || []).forEach((r) => {
    const c = r.is_credit ? '1' : '0';
    const d = _norm(r.doc_norm || r.doc_number);
    const s = _norm(r.si_doc_number);
    if ((d && seen.has('d|' + c + '|' + d)) || (s && seen.has('s|' + c + '|' + s))) return;
    if (d) seen.add('d|' + c + '|' + d);
    if (s) seen.add('s|' + c + '|' + s);
    const parsed = (r.raw_meta && typeof r.raw_meta === 'object') ? r.raw_meta : {
      doc_number: r.doc_number || r.doc_norm || '',
      si_doc_number: r.si_doc_number || undefined,
      is_credit: !!r.is_credit,
      vendor: r.vendor || undefined,
      po_number: r.po_number || undefined,
      doc_total: _total(r.doc_total) || undefined,
      source: r.source || undefined,
    };
    const ts = r.applied_at ? Date.parse(r.applied_at) : 0;
    extras.push({
      id: 'srv-' + (r.id != null ? r.id : (d || s)),
      file: (r.doc_number || r.doc_norm) ? 'Doc #' + (r.doc_number || r.doc_norm) : 'Bill (server ledger)',
      uploadedAt: Number.isFinite(ts) && ts ? new Date(ts).toLocaleString() : '',
      uploadedTs: Number.isFinite(ts) ? ts : 0,
      parsed,
      qbStatus: null,
      portalStatus: r.portal_status || 'success',
      reviewLater: false,
      _serverLedger: true, // read-only in the UI: can't be parked/deleted locally
    });
  });
  if (!extras.length) return local;
  const ts = (sb) => sb.uploadedTs || Date.parse(sb.uploadedAt || '') || 0;
  return [...local, ...extras].sort((a, b) => ts(b) - ts(a));
};
