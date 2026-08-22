// ═══════════════════════════════════════════════════════════════════════
// ACCOUNTING → IMPORT
//
// The destination for the eight exports in NETSUITE_TAX_EXPORT_HANDOFF.md.
// Drop the files, read the preview, then commit.
//
// The preview step is not decoration. Nobody has run these exports yet, so
// the parsers in lib/netsuiteCsvParser.js were written against NetSuite's
// documented conventions rather than a real file from account 6108444. The
// preview is where a format surprise becomes visible — row counts, the
// header actually matched, the debit/credit tie — BEFORE anything is
// written to the ledger tables.
//
// Two things this screen will not do:
//   • commit a general ledger or trial balance whose debits and credits
//     disagree (handoff §5.2 / §5.3 — an unbalanced export is incomplete)
//   • commit an invoice export with no Internal ID column, because without
//     the idempotency key a re-import duplicates every invoice
//
// gl_* tables are admin/GM-only at the RLS layer (`is_admin_or_gm()`), so
// the page is gated to the same roles — otherwise a rep would see the
// screen and get silent zero-row writes.
// ═══════════════════════════════════════════════════════════════════════
import React from 'react';
import { useAppData } from './AppContext';
import { supabase } from './lib/dbEngine';
import { Icon } from './components';
import {
  parseNetSuiteReport, detectReportType, checkTieOut,
} from './lib/netsuiteCsvParser';

const REPORT_LABELS = {
  chart_of_accounts: 'Chart of Accounts',
  general_ledger: 'General Ledger Detail',
  trial_balance: 'Trial Balance',
  income_statement: 'Income Statement',
  balance_sheet: 'Balance Sheet',
  invoice_search: 'Invoices + Credit Memos',
};

// Which table each report writes to, and how a re-import is de-duplicated.
const REPORT_TARGETS = {
  chart_of_accounts: { table: 'gl_accounts', onConflict: 'netsuite_internal_id', mode: 'upsert' },
  general_ledger: { table: 'gl_entries', mode: 'replace_by_source' },
  trial_balance: { table: 'gl_account_balances', mode: 'replace_by_key' },
  income_statement: { table: 'gl_account_balances', mode: 'replace_by_key' },
  balance_sheet: { table: 'gl_account_balances', mode: 'replace_by_key' },
  invoice_search: { table: 'customer_invoices', onConflict: 'netsuite_internal_id', mode: 'upsert' },
};

const money = (n) => (n === null || n === undefined || isNaN(n)) ? '—'
  : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CHUNK = 500;
const chunked = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const readFileText = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result || ''));
  fr.onerror = () => reject(new Error('Could not read ' + file.name));
  fr.readAsText(file);
});

// Year inferred from the handoff's filenames (gl_detail_2025.csv,
// trial_balance_2026_ytd.csv). The operator can override it per file.
const yearFromName = (name) => {
  const m = /(20\d{2})/.exec(String(name || ''));
  return m ? parseInt(m[1], 10) : null;
};
const isYtdName = (name) => /ytd/i.test(String(name || ''));

export default function AccountingImportPage() {
  const { cu, nf } = useAppData();
  const [files, setFiles] = React.useState([]); // {name, text, reportType, fiscalYear, parsed, status}
  const [busy, setBusy] = React.useState(false);
  const [batches, setBatches] = React.useState([]);
  const fileInput = React.useRef(null);

  // Deliberately the SAME set as the database's is_admin_or_gm(), which is
  // role in ('admin','gm') — note it does NOT include 'super_admin'. Gating
  // the UI on a wider set than RLS allows would let someone open the page,
  // press Import, and get zero rows written with no obvious reason why.
  const isAdmin = cu && (cu.role === 'admin' || cu.role === 'gm');

  const loadBatches = React.useCallback(async () => {
    const { data, error } = await supabase.from('gl_import_batches')
      .select('*').order('imported_at', { ascending: false }).limit(25);
    if (!error) setBatches(data || []);
  }, []);

  React.useEffect(() => { if (isAdmin) loadBatches(); }, [isAdmin, loadBatches]);

  if (!isAdmin) {
    return (
      <div className="card" style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center' }}>
        <div className="card-body" style={{ padding: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <h2 style={{ margin: '0 0 8px', color: '#1e293b' }}>Admin only</h2>
          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
            The general-ledger tables allow only the <code>admin</code> and <code>gm</code> roles
            at the database level (<code>is_admin_or_gm()</code>), so importing needs one of those.
            <br /><br />
            Note that the <code>accounting</code> role is <b>not</b> in that set — if the people who
            actually do the books should be importing here, the row-level security policy on the
            <code> gl_*</code> tables has to be widened first. That is a deliberate security change,
            not something this screen can work around.
          </div>
        </div>
      </div>
    );
  }

  const addFiles = async (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const next = [];
    for (const f of incoming) {
      try {
        const text = await readFileText(f);
        if (/^%PDF/.test(text.slice(0, 8))) {
          nf(`${f.name} is a PDF — the handoff says never export as PDF, it cannot be imported.`, 'error');
          continue;
        }
        const reportType = detectReportType(text, f.name);
        const fiscalYear = yearFromName(f.name);
        next.push({
          key: `${f.name}-${f.size}-${next.length}`,
          name: f.name, text, reportType, fiscalYear,
          ytd: isYtdName(f.name), parsed: null, status: 'pending',
        });
      } catch (e) {
        nf(e.message, 'error');
      }
    }
    setFiles(prev => [...prev, ...next].map(reparse));
  };

  // Parsing is pure and cheap — re-run it whenever the operator changes the
  // detected report type or the fiscal year.
  function reparse(f) {
    if (!f.reportType) return { ...f, parsed: null };
    let parsed;
    try {
      parsed = parseNetSuiteReport(f.text, f.reportType, {
        fiscalYear: f.fiscalYear,
        period: f.ytd ? 'YTD' : null,
      });
    } catch (e) {
      parsed = { rows: [], warnings: ['Parser error: ' + e.message], header: null };
    }
    return { ...f, parsed };
  }

  const updateFile = (key, patch) =>
    setFiles(prev => prev.map(f => f.key === key ? reparse({ ...f, ...patch }) : f));

  const removeFile = (key) => setFiles(prev => prev.filter(f => f.key !== key));

  // A file is blocked from committing when the ledger would be corrupted.
  const blockReason = (f) => {
    if (!f.reportType) return 'Pick a report type';
    if (!f.parsed || !f.parsed.rows.length) return 'Nothing parsed';
    const t = f.parsed.totals;
    if ((f.reportType === 'general_ledger' || f.reportType === 'trial_balance') && t && !t.balanced) {
      return `Out of balance by ${money(t.difference)} — re-run the export`;
    }
    if (f.reportType === 'invoice_search' && f.parsed.summary && !f.parsed.summary.loadable) {
      return 'No Internal ID column — a re-import would duplicate every invoice';
    }
    if (f.reportType !== 'chart_of_accounts' && f.reportType !== 'invoice_search' && !f.fiscalYear) {
      return 'Set the fiscal year';
    }
    return null;
  };

  // ── Commit ─────────────────────────────────────────────────────────────
  const commitFile = async (f) => {
    const target = REPORT_TARGETS[f.reportType];
    const blocked = blockReason(f);
    if (blocked) { nf(`${f.name}: ${blocked}`, 'error'); return; }

    setBusy(true);
    updateFile(f.key, { status: 'writing' });
    const batchId = `glb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let written = 0, replaced = 0;

    try {
      let rows = f.parsed.rows;

      // GL entries and balances carry no account type of their own — resolve
      // account_id and statement_group from gl_accounts so the statements can
      // be grouped. Accounts that are not in the COA stay null rather than
      // being guessed here; the preview reports how many.
      if (f.reportType !== 'chart_of_accounts' && f.reportType !== 'invoice_search') {
        const { data: accts } = await supabase.from('gl_accounts')
          .select('id,account_number,full_name,name,statement_group');
        // Names are NOT unique in this chart of accounts: "Information
        // Technology & Software" is both 14700 (Fixed Asset) and 65500
        // (Expense); "Building Rent" is 53200 (COGS) and 69000 (Expense);
        // "Leasehold Improvements" is 14300 and 65200. A plain Map keeps
        // whichever was inserted last, so a name-only match can file
        // depreciation under assets and quietly move money between statement
        // groups. Ambiguous names are dropped instead of answered wrongly —
        // the account number is unambiguous and is tried first anyway.
        const byFull = new Map(), byNum = new Map(), byName = new Map(), byComposed = new Map();
        const putUnique = (map, key, a) => {
          if (map.has(key)) { const cur = map.get(key); if (!cur || cur.id !== a.id) map.set(key, null); return; }
          map.set(key, a);
        };
        for (const a of accts || []) {
          if (a.full_name) putUnique(byFull, a.full_name.toLowerCase(), a);
          if (a.account_number) byNum.set(String(a.account_number), a);
          if (a.name) putUnique(byName, a.name.toLowerCase(), a);
          // Accounts whose "number" is text rather than digits — Donation,
          // NP11, Viking Loan Liability — print in reports as "Donation -
          // Donation" and "NP11 - NS Undeposited Funds". The number is not
          // numeric, so it never parses out of the label and none of the three
          // lookups above can reach them. Compose the same string from the COA
          // and match on that, rather than loosening the label parser and
          // mis-splitting an account genuinely named "Travel - Meals".
          if (a.account_number && a.name) {
            byComposed.set(`${a.account_number} - ${a.name}`.toLowerCase(), a);
          }
        }
        rows = rows.map(r => {
          const hit = (r.account_full_name && byFull.get(String(r.account_full_name).toLowerCase()))
            || (r.account_number && byNum.get(String(r.account_number)))
            || (r.account_name && byName.get(String(r.account_name).toLowerCase()))
            || (r.account_full_name && byComposed.get(String(r.account_full_name).toLowerCase()))
            || null;
          return { ...r, account_id: hit ? hit.id : null, statement_group: hit ? hit.statement_group : null };
        });
      }

      // Strip the parser's internal bookkeeping fields before writing.
      let clean = rows.map(r => {
        const o = { ...r };
        for (const k of Object.keys(o)) if (k.startsWith('_')) delete o[k];
        return o;
      });

      // customer_invoices.netsuite_internal_id is NOT NULL. One row with a
      // blank Internal ID would otherwise abort the whole batch — drop them
      // and say how many, rather than failing the import or writing silently.
      if (f.reportType === 'invoice_search') {
        const before = clean.length;
        clean = clean.filter(r => r.netsuite_internal_id);
        const dropped = before - clean.length;
        if (dropped) nf(`${f.name}: skipped ${dropped} row(s) with no Internal ID`, 'warn');
      }
      if (!clean.length) throw new Error('No writable rows after filtering');

      if (target.mode === 'replace_by_source') {
        // GL detail has no natural unique key, so a re-import of the same
        // file replaces its previous rows wholesale rather than doubling them.
        const { count } = await supabase.from(target.table)
          .select('id', { count: 'exact', head: true }).eq('source_file', f.name);
        replaced = count || 0;
        if (replaced) {
          const { error: delErr } = await supabase.from(target.table).delete().eq('source_file', f.name);
          if (delErr) throw delErr;
        }
        for (const part of chunked(clean.map(r => ({ ...r, source_file: f.name, import_batch_id: batchId })), CHUNK)) {
          const { error } = await supabase.from(target.table).insert(part);
          if (error) throw error;
          written += part.length;
        }
      } else if (target.mode === 'replace_by_key') {
        // The unique index on this table is an EXPRESSION index —
        //   (report_type, fiscal_year, COALESCE(period,''), COALESCE(account_full_name, account_name))
        // — because `period` is nullable and NULL never equals NULL in a plain
        // unique index. PostgREST can only infer a conflict target from a bare
        // column list, so naming those four columns raises
        //   "there is no unique or exclusion constraint matching the ON CONFLICT
        //    specification"
        // and every balance report fails to import. Conflict on the primary key
        // instead: the parser builds `id` from exactly those same four values,
        // so upserting on it has identical semantics and does match an index.
        for (const part of chunked(clean.map(r => ({ ...r, source_file: f.name, import_batch_id: batchId })), CHUNK)) {
          const { error } = await supabase.from(target.table)
            .upsert(part, { onConflict: 'id' });
          if (error) throw error;
          written += part.length;
        }
      } else {
        for (const part of chunked(clean, CHUNK)) {
          const { error } = await supabase.from(target.table)
            .upsert(part, { onConflict: target.onConflict });
          if (error) throw error;
          written += part.length;
        }
      }

      const totals = f.parsed.totals || {};
      await supabase.from('gl_import_batches').insert({
        id: batchId,
        report_type: f.reportType,
        source_file: f.name,
        fiscal_year: f.fiscalYear || null,
        rows_parsed: f.parsed.rows.length,
        rows_written: written,
        rows_replaced: replaced,
        total_amount: totals.debit !== undefined ? totals.debit : null,
        warnings: (f.parsed.warnings || []).length ? f.parsed.warnings : null,
        imported_by: (cu && (cu.email || cu.name)) || null,
      });

      updateFile(f.key, { status: 'done' });
      nf(`${f.name}: ${written} row${written === 1 ? '' : 's'} written${replaced ? `, ${replaced} replaced` : ''}`);
      loadBatches();
    } catch (e) {
      updateFile(f.key, { status: 'error' });
      nf(`${f.name} failed: ${e.message || e}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const commitAll = async () => {
    // Chart of accounts first — the handoff says GL imports are more accurate
    // once it is loaded, because account types drive the classification.
    const order = ['chart_of_accounts', 'trial_balance', 'general_ledger', 'income_statement', 'balance_sheet', 'invoice_search'];
    const queue = [...files]
      .filter(f => f.status !== 'done' && !blockReason(f))
      .sort((a, b) => order.indexOf(a.reportType) - order.indexOf(b.reportType));
    if (!queue.length) { nf('Nothing ready to import', 'warn'); return; }
    for (const f of queue) {
      // Re-read from state each pass so account resolution sees the COA that
      // an earlier file in this same run just wrote.
      // eslint-disable-next-line no-await-in-loop
      await commitFile(f);
    }
  };

  const invoiceFile = files.find(f => f.reportType === 'invoice_search' && f.parsed && f.parsed.summary);
  const tieOut = invoiceFile ? checkTieOut(invoiceFile.parsed.summary) : null;

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Icon name="upload" />
            <h3 style={{ margin: 0, fontSize: 15, color: '#0f172a' }}>NetSuite financial import</h3>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 1.5 }}>
            Drop the exports from <code>NETSUITE_TAX_EXPORT_HANDOFF.md</code> — CSV, TSV, or NetSuite's
            SpreadsheetML <code>.xls</code>. Every file is parsed and previewed here first; nothing is
            written until you commit. A general ledger or trial balance whose debits and credits
            disagree cannot be committed at all.
          </div>

          <div
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
            onClick={() => fileInput.current && fileInput.current.click()}
            style={{
              border: '2px dashed #cbd5e1', borderRadius: 8, padding: 24, textAlign: 'center',
              cursor: 'pointer', background: '#f8fafc', fontSize: 12, color: '#475569',
            }}
          >
            <div style={{ fontSize: 26, marginBottom: 6 }}>📁</div>
            Drop the export files here, or click to choose
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
              coa.csv · gl_detail_*.csv · trial_balance_*.csv · income_statement_*.csv · balance_sheet_*.csv · invoices_with_tax_2024_2026.csv
            </div>
          </div>
          <input
            ref={fileInput} type="file" multiple accept=".csv,.tsv,.txt,.xls,.xml"
            style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
          />

          {files.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={commitAll}>
                {busy ? 'Importing…' : 'Import all ready files'}
              </button>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setFiles([])}>
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {files.map(f => {
        const p = f.parsed;
        const t = p && p.totals;
        const blocked = blockReason(f);
        // A balance sheet and an income statement export with a single Amount
        // column, so their debit/credit split is derived from the sign of that
        // amount and comparing the two sides is meaningless — NetSuite prints
        // liabilities and equity as positive figures. Only a trial balance and
        // a GL carry real Debit/Credit columns. Calling the others "out of
        // balance" reads as corrupt data when the file is perfectly correct.
        const amountOnly = t && t.hasDebitCredit === false;
        const unbalanced = t && t.balanced === false && !amountOnly;
        return (
          <div className="card" key={f.key} style={{ marginBottom: 12 }}>
            <div className="card-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', wordBreak: 'break-all' }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {p ? `${p.rows.length} row${p.rows.length === 1 ? '' : 's'} parsed` : 'not parsed'}
                    {f.status === 'done' && <span style={{ color: '#16a34a', fontWeight: 700 }}> · imported</span>}
                    {f.status === 'error' && <span style={{ color: '#b91c1c', fontWeight: 700 }}> · failed</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <select
                    value={f.reportType || ''} disabled={busy}
                    onChange={e => updateFile(f.key, { reportType: e.target.value || null })}
                    style={{ fontSize: 11, padding: '4px 6px', borderRadius: 4, border: '1px solid #cbd5e1' }}
                  >
                    <option value="">— report type —</option>
                    {Object.keys(REPORT_LABELS).map(k => <option key={k} value={k}>{REPORT_LABELS[k]}</option>)}
                  </select>
                  {f.reportType && f.reportType !== 'chart_of_accounts' && f.reportType !== 'invoice_search' && (
                    <input
                      type="number" placeholder="year" value={f.fiscalYear || ''} disabled={busy}
                      onChange={e => updateFile(f.key, { fiscalYear: parseInt(e.target.value, 10) || null })}
                      style={{ fontSize: 11, padding: '4px 6px', width: 70, borderRadius: 4, border: '1px solid #cbd5e1' }}
                    />
                  )}
                  <button className="btn btn-sm btn-primary" disabled={busy || !!blocked || f.status === 'done'}
                    onClick={() => commitFile(f)}>Import</button>
                  <button className="btn btn-sm btn-secondary" disabled={busy}
                    onClick={() => removeFile(f.key)}>✕</button>
                </div>
              </div>

              {t && (t.debit !== undefined) && (
                <div style={{
                  marginTop: 10, padding: '8px 10px', borderRadius: 6, fontSize: 12,
                  background: amountOnly ? '#f8fafc' : unbalanced ? '#fef2f2' : '#f0fdf4',
                  color: amountOnly ? '#334155' : unbalanced ? '#991b1b' : '#166534',
                  border: `1px solid ${amountOnly ? '#e2e8f0' : unbalanced ? '#fecaca' : '#bbf7d0'}`,
                }}>
                  {amountOnly ? (
                    <>
                      <b>Amount-only report</b> — NetSuite exports this one without Debit/Credit
                      columns, so there is nothing to balance here
                      {t.netIncome != null && <> · net income <b>{money(t.netIncome)}</b></>}
                    </>
                  ) : (
                    <>
                      <b>{unbalanced ? 'Out of balance' : 'Balanced'}</b> — debits {money(t.debit)} vs credits {money(t.credit)}
                      {unbalanced && <> · difference <b>{money(t.difference)}</b></>}
                    </>
                  )}
                  {t.netIncome !== null && t.netIncome !== undefined && <> · net income {money(t.netIncome)}</>}
                </div>
              )}

              {p && p.summary && (
                <div style={{ marginTop: 10, fontSize: 12, color: '#334155' }}>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <span>Subtotal column: <b style={{ color: p.summary.hasSubtotal ? '#16a34a' : '#b91c1c' }}>{p.summary.hasSubtotal ? 'present' : 'MISSING'}</b></span>
                    <span>Tax column: <b style={{ color: p.summary.hasTax ? '#16a34a' : '#b91c1c' }}>{p.summary.hasTax ? 'present' : 'MISSING'}</b></span>
                    <span>Credit memos: <b style={{ color: p.summary.byType.credit_memo ? '#16a34a' : '#b91c1c' }}>{p.summary.byType.credit_memo || 0}</b></span>
                    <span>Invoices: <b>{p.summary.byType.invoice || 0}</b></span>
                  </div>
                </div>
              )}

              {p && p.warnings && p.warnings.length > 0 && (
                <ul style={{ marginTop: 10, marginBottom: 0, paddingLeft: 18, fontSize: 11.5, color: '#92400e' }}>
                  {p.warnings.slice(0, 12).map((w, i) => <li key={i} style={{ marginBottom: 2 }}>{w}</li>)}
                  {p.warnings.length > 12 && <li style={{ color: '#64748b' }}>…and {p.warnings.length - 12} more</li>}
                </ul>
              )}

              {blocked && f.status !== 'done' && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: '#b91c1c', fontWeight: 600 }}>
                  Cannot import: {blocked}
                </div>
              )}

              {p && p.header && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 11, color: '#64748b', cursor: 'pointer' }}>Header row the parser matched</summary>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 4, wordBreak: 'break-all' }}>
                    {p.header.filter(Boolean).join(' | ')}
                  </div>
                </details>
              )}
            </div>
          </div>
        );
      })}

      {tieOut && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body">
            <h3 style={{ margin: '0 0 4px', fontSize: 14, color: '#0f172a' }}>Tie-out against the portal's invoice data</h3>
            <div style={{ fontSize: 11.5, color: '#92400e', marginBottom: 10, lineHeight: 1.5 }}>
              These expected figures come from the portal's own <code>customer_invoices</code> rows — the same data
              this export is meant to correct. A match confirms the export is internally consistent; it is
              <b> not</b> independent verification against NetSuite. If the original saved search dropped
              invoices the way it dropped credit memos, a re-export will match these and still be incomplete.
            </div>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'right', color: '#64748b', fontSize: 11 }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Year</th>
                  <th style={{ padding: '4px 6px' }}>Expected count</th>
                  <th style={{ padding: '4px 6px' }}>Your count</th>
                  <th style={{ padding: '4px 6px' }}>Expected total</th>
                  <th style={{ padding: '4px 6px' }}>Your total</th>
                  <th style={{ padding: '4px 6px' }}>Off by</th>
                </tr>
              </thead>
              <tbody>
                {tieOut.map(r => (
                  <tr key={r.year} style={{ borderTop: '1px solid #e2e8f0', textAlign: 'right' }}>
                    <td style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 700 }}>{r.year}</td>
                    <td style={{ padding: '4px 6px' }}>{r.expectedCount.toLocaleString()}</td>
                    <td style={{ padding: '4px 6px' }}>{r.actualCount.toLocaleString()}</td>
                    <td style={{ padding: '4px 6px' }}>{money(r.expectedTotal)}</td>
                    <td style={{ padding: '4px 6px' }}>{money(r.actualTotal)}</td>
                    <td style={{
                      padding: '4px 6px', fontWeight: 700,
                      color: r.status === 'match' ? '#16a34a' : r.status === 'material' ? '#b91c1c' : '#b45309',
                    }}>
                      {r.status === 'match' ? 'match' : `${money(r.difference)} (${r.percentOff}%)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {batches.length > 0 && (
        <div className="card">
          <div className="card-body">
            <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#0f172a' }}>Recent imports</h3>
            <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11 }}>
                  <th style={{ padding: '4px 6px' }}>When</th>
                  <th style={{ padding: '4px 6px' }}>Report</th>
                  <th style={{ padding: '4px 6px' }}>File</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>Written</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>Replaced</th>
                  <th style={{ padding: '4px 6px' }}>By</th>
                </tr>
              </thead>
              <tbody>
                {batches.map(b => (
                  <tr key={b.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{new Date(b.imported_at).toLocaleString()}</td>
                    <td style={{ padding: '4px 6px' }}>{REPORT_LABELS[b.report_type] || b.report_type}</td>
                    <td style={{ padding: '4px 6px', wordBreak: 'break-all' }}>{b.source_file}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>{(b.rows_written || 0).toLocaleString()}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>{(b.rows_replaced || 0).toLocaleString()}</td>
                    <td style={{ padding: '4px 6px' }}>{b.imported_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
