import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './lib/supabase';
import { Icon } from './components';
import {
  parseGlDetail, parseChartOfAccounts, parseBalances, parseInvoiceTotals,
  buildIncomeStatement, buildBalanceSheet, buildTrialBalance, reconcile,
  buildAccountIndex, detectReportType, round2,
} from './lib/netsuiteFinancials';

// ═══════════════════════════════════════════════════════════════════════
// ACCOUNTING — one home for the company's financial data.
//
// Everything here is IMPORTED from NetSuite (the book of record until the
// QuickBooks Online migration). Nothing on this page posts to a ledger; it
// reads gl_entries / gl_account_balances / customer_invoices and builds
// statements from them. See NETSUITE_TAX_EXPORT_HANDOFF.md for how the
// source files are produced.
//
// The design rule throughout: never show a total without showing whether it
// ties. A P&L built from an incomplete GL detail import looks exactly like a
// correct one, and that is the failure mode that reaches a tax return.
// ═══════════════════════════════════════════════════════════════════════

const money = (n, dash = '—') => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return dash;
  const v = Number(n);
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '($' + s + ')' : '$' + s);
};
const int = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));

const C = {
  navy: '#1e293b', slate: '#475569', mute: '#64748b', line: '#e2e8f0',
  good: '#166534', goodBg: '#f0fdf4', warn: '#92400e', warnBg: '#fffbeb',
  bad: '#b91c1c', badBg: '#fef2f2', blue: '#1d4ed8', blueBg: '#eff6ff',
};

const TABS = [
  { id: 'overview',     label: 'Overview' },
  { id: 'statements',   label: 'Financial Statements' },
  { id: 'sales',        label: 'Sales & AR' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'import',       label: 'Import' },
  { id: 'export',       label: 'Tax Export' },
];

// ─── small presentational helpers ────────────────────────────────────
const Banner = ({ tone = 'warn', title, children }) => {
  const bg = tone === 'good' ? C.goodBg : tone === 'bad' ? C.badBg : tone === 'info' ? C.blueBg : C.warnBg;
  const fg = tone === 'good' ? C.good : tone === 'bad' ? C.bad : tone === 'info' ? C.blue : C.warn;
  return (
    <div style={{ background: bg, border: `1px solid ${fg}33`, borderLeft: `3px solid ${fg}`, borderRadius: 4, padding: '10px 14px', marginBottom: 12 }}>
      {title && <div style={{ fontSize: 12, fontWeight: 700, color: fg, marginBottom: children ? 4 : 0 }}>{title}</div>}
      {children && <div style={{ fontSize: 11.5, color: C.slate, lineHeight: 1.5 }}>{children}</div>}
    </div>
  );
};

const Stat = ({ label, value, sub, tone }) => (
  <div style={{ flex: '1 1 160px', minWidth: 150, padding: '12px 14px', border: `1px solid ${C.line}`, borderRadius: 4, background: 'white' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .5, color: C.mute, fontWeight: 700 }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 700, color: tone === 'bad' ? C.bad : tone === 'good' ? C.good : C.navy, marginTop: 4 }}>{value}</div>
    {sub && <div style={{ fontSize: 10.5, color: C.mute, marginTop: 2 }}>{sub}</div>}
  </div>
);

const Th = ({ children, right }) => (
  <th style={{ textAlign: right ? 'right' : 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: .4, color: C.mute, fontWeight: 700, padding: '6px 8px', borderBottom: `2px solid ${C.line}`, whiteSpace: 'nowrap' }}>{children}</th>
);
const Td = ({ children, right, bold, tone }) => (
  <td style={{ textAlign: right ? 'right' : 'left', fontSize: 11.5, padding: '5px 8px', borderBottom: `1px solid ${C.line}`, fontWeight: bold ? 700 : 400, color: tone === 'bad' ? C.bad : tone === 'good' ? C.good : C.navy, whiteSpace: right ? 'nowrap' : undefined }}>{children}</td>
);

// A statement section: rows of accounts plus a total line.
const StatementSection = ({ title, rows, total, negate }) => (
  <>
    <tr><td colSpan={3} style={{ fontSize: 11, fontWeight: 700, color: C.slate, padding: '12px 8px 4px', textTransform: 'uppercase', letterSpacing: .4 }}>{title}</td></tr>
    {rows.length === 0 && <tr><Td><span style={{ color: C.mute, fontStyle: 'italic' }}>No accounts</span></Td><Td /><Td /></tr>}
    {rows.map((a) => (
      <tr key={a.account_full_name}>
        <Td>{a.account_number ? <span style={{ color: C.mute, marginRight: 6 }}>{a.account_number}</span> : null}{a.account_full_name}</Td>
        <Td right>{int(a.entry_count)}</Td>
        <Td right>{money(negate ? -a.display : a.display)}</Td>
      </tr>
    ))}
    <tr>
      <Td bold>Total {title}</Td><Td />
      <Td right bold>{money(negate ? -total : total)}</Td>
    </tr>
  </>
);

// ─── CSV download ────────────────────────────────────────────────────
const toCsv = (headers, rows) => {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
};

const download = (filename, text) => {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Supabase rejects very large single payloads; write in chunks so a 40k-row
// GL import does not fail as one request.
const CHUNK = 500;
const upsertChunked = async (table, rows, onConflict) => {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).upsert(slice, { onConflict });
    if (error) throw new Error(`${table} write failed at row ${i}: ${error.message}`);
    written += slice.length;
  }
  return written;
};

// ═══════════════════════════════════════════════════════════════════════
export default function AccountingPage() {
  const [tab, setTab] = useState('overview');
  const [glYears, setGlYears] = useState([]);
  const [salesYears, setSalesYears] = useState([]);
  const [batches, setBatches] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [year, setYear] = useState(null);

  const reload = useCallback(async () => {
    if (!supabase) { setErr('No database connection.'); setLoading(false); return; }
    setLoading(true); setErr(null);
    try {
      const [gy, sy, gb, ga] = await Promise.all([
        supabase.rpc('gl_year_summary'),
        supabase.rpc('sales_year_summary'),
        supabase.from('gl_import_batches').select('*').order('imported_at', { ascending: false }).limit(25),
        supabase.from('gl_accounts').select('id, account_number, name, full_name, account_type, statement_group, is_inactive').limit(5000),
      ]);
      if (gy.error) throw gy.error;
      if (sy.error) throw sy.error;
      setGlYears(gy.data || []);
      setSalesYears(sy.data || []);
      setBatches(gb.error ? [] : (gb.data || []));
      setAccounts(ga.error ? [] : (ga.data || []));
      const years = (gy.data || []).map((r) => r.fiscal_year);
      setYear((prev) => (prev && years.includes(prev) ? prev : (years[0] ?? null)));
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // The two data gaps this section exists partly to close. Both are computed
  // from live data rather than hard-coded, so they disappear on their own once
  // a corrected invoice export is imported.
  const gaps = useMemo(() => {
    const invoiceRows = salesYears.filter((r) => r.doc_type === 'invoice');
    const totalInvoices = invoiceRows.reduce((a, r) => a + Number(r.doc_count || 0), 0);
    const withTax = salesYears.reduce((a, r) => a + Number(r.with_tax_rows || 0), 0);
    const creditMemos = salesYears.filter((r) => r.doc_type === 'credit_memo')
      .reduce((a, r) => a + Number(r.doc_count || 0), 0);
    return {
      totalInvoices, withTax, creditMemos,
      noTaxSplit: totalInvoices > 0 && withTax === 0,
      noCreditMemos: totalInvoices > 0 && creditMemos === 0,
      noGl: glYears.length === 0,
    };
  }, [salesYears, glYears]);

  const body = () => {
    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.mute, fontSize: 12 }}>Loading accounting data…</div>;
    if (err) return <Banner tone="bad" title="Could not load accounting data">{err}</Banner>;
    switch (tab) {
      case 'overview':     return <Overview glYears={glYears} salesYears={salesYears} batches={batches} accounts={accounts} gaps={gaps} onGo={setTab} />;
      case 'statements':   return <Statements year={year} setYear={setYear} glYears={glYears} />;
      case 'sales':        return <SalesAr salesYears={salesYears} gaps={gaps} />;
      case 'transactions': return <Transactions />;
      case 'import':       return <ImportTab accounts={accounts} onDone={reload} />;
      case 'export':       return <TaxExport glYears={glYears} salesYears={salesYears} />;
      default:             return null;
    }
  };

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', gap: 2, borderBottom: `2px solid ${C.line}`, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '8px 16px', fontSize: 12, fontWeight: tab === t.id ? 700 : 500, cursor: 'pointer',
              border: 'none', background: 'none', color: tab === t.id ? C.blue : C.slate,
              borderBottom: tab === t.id ? `2px solid ${C.blue}` : '2px solid transparent', marginBottom: -2,
            }}>{t.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" style={{ fontSize: 11, alignSelf: 'center' }} onClick={reload}>Refresh</button>
      </div>
      {body()}
    </div>
  );
}

// ─── Overview ────────────────────────────────────────────────────────
function Overview({ glYears, salesYears, batches, accounts, gaps, onGo }) {
  const salesByYear = useMemo(() => {
    const m = new Map();
    for (const r of salesYears) {
      const y = r.fiscal_year;
      if (!m.has(y)) m.set(y, { year: y, invoices: 0, creditMemos: 0, total: 0, tax: 0, withTax: 0 });
      const e = m.get(y);
      if (r.doc_type === 'credit_memo') e.creditMemos += Number(r.doc_count || 0);
      else e.invoices += Number(r.doc_count || 0);
      e.total = round2(e.total + Number(r.total_sum || 0));
      e.tax = round2(e.tax + Number(r.tax_sum || 0));
      e.withTax += Number(r.with_tax_rows || 0);
    }
    return [...m.values()].sort((a, b) => b.year - a.year);
  }, [salesYears]);

  return (
    <div>
      {gaps.noGl && (
        <Banner tone="warn" title="No general-ledger data imported yet">
          Sales data is loaded, but there is no chart of accounts and no ledger detail — so a P&amp;L,
          balance sheet or trial balance cannot be produced yet. Run the eight NetSuite exports in
          <strong> NETSUITE_TAX_EXPORT_HANDOFF.md</strong>, then load them under{' '}
          <button onClick={() => onGo('import')} style={{ border: 'none', background: 'none', color: C.blue, textDecoration: 'underline', cursor: 'pointer', fontSize: 11.5, padding: 0 }}>Import</button>.
        </Banner>
      )}
      {gaps.noTaxSplit && (
        <Banner tone="bad" title="No sales-tax split on any invoice">
          All {int(gaps.totalInvoices)} imported invoices carry a gross total only — <code>subtotal</code> and{' '}
          <code>tax</code> are empty on every row, because the saved search that loaded them selected Amount
          alone. <strong>A sales-tax return cannot be prepared from this data.</strong> Re-run the invoice
          saved search with the <code>Subtotal</code> and <code>Tax Total</code> columns included and import it
          — the figures fill in and this warning clears itself.
        </Banner>
      )}
      {gaps.noCreditMemos && (
        <Banner tone="bad" title="No credit memos have ever been imported">
          Every imported document is an invoice, so revenue here is <strong>gross of every credit issued</strong>{' '}
          and overstated by an unknown amount. Re-run the invoice saved search with
          <code> Type is any of Invoice, Credit Memo</code>; the importer files credits as negatives so they
          reduce revenue.
        </Banner>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <Stat label="Ledger years" value={glYears.length ? int(glYears.length) : '0'} sub={glYears.length ? glYears.map((y) => y.fiscal_year).join(', ') : 'nothing imported'} tone={glYears.length ? undefined : 'bad'} />
        <Stat label="Chart of accounts" value={int(accounts.length)} sub={accounts.length ? 'accounts loaded' : 'not imported'} tone={accounts.length ? undefined : 'bad'} />
        <Stat label="Invoices" value={int(gaps.totalInvoices)} sub="imported from NetSuite" />
        <Stat label="Credit memos" value={int(gaps.creditMemos)} sub={gaps.noCreditMemos ? 'none — revenue is gross' : 'imported'} tone={gaps.noCreditMemos ? 'bad' : undefined} />
        <Stat label="Invoices with tax split" value={int(gaps.withTax)} sub={gaps.noTaxSplit ? 'none — cannot file sales tax' : 'of ' + int(gaps.totalInvoices)} tone={gaps.noTaxSplit ? 'bad' : 'good'} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h2 style={{ fontSize: 14 }}>Ledger data by year</h2></div>
        <div className="card-body" style={{ padding: 0 }}>
          {glYears.length === 0
            ? <div style={{ padding: 20, fontSize: 11.5, color: C.mute }}>No <code>gl_entries</code> rows yet.</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><Th>Year</Th><Th right>Entries</Th><Th>Range</Th><Th right>Debits − credits</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {glYears.map((y) => {
                    const net = Number(y.net_amount || 0);
                    const balanced = Math.abs(net) < 0.01;
                    return (
                      <tr key={y.fiscal_year}>
                        <Td bold>{y.fiscal_year}</Td>
                        <Td right>{int(y.entry_count)}</Td>
                        <Td>{y.min_date} → {y.max_date}</Td>
                        <Td right tone={balanced ? 'good' : 'bad'}>{money(net)}</Td>
                        <Td tone={balanced ? 'good' : 'bad'}>{balanced ? 'Balanced' : 'Incomplete import'}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h2 style={{ fontSize: 14 }}>Billed by year (NetSuite invoice register)</h2></div>
        <div className="card-body" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><Th>Year</Th><Th right>Invoices</Th><Th right>Credit memos</Th><Th right>Sales tax</Th><Th right>Total billed</Th></tr></thead>
            <tbody>
              {salesByYear.map((r) => (
                <tr key={r.year}>
                  <Td bold>{r.year}</Td>
                  <Td right>{int(r.invoices)}</Td>
                  <Td right tone={r.creditMemos ? undefined : 'bad'}>{r.creditMemos ? int(r.creditMemos) : 'none'}</Td>
                  <Td right tone={r.withTax ? undefined : 'bad'}>{r.withTax ? money(r.tax) : 'not imported'}</Td>
                  <Td right bold>{money(r.total)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '8px 12px', fontSize: 10.5, color: C.mute, borderTop: `1px solid ${C.line}` }}>
            Source: <code>customer_invoices</code> — NetSuite invoice headers. Totals are gross (tax included)
            because the tax split has not been imported.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h2 style={{ fontSize: 14 }}>Recent imports</h2></div>
        <div className="card-body" style={{ padding: 0 }}>
          {batches.length === 0
            ? <div style={{ padding: 20, fontSize: 11.5, color: C.mute }}>Nothing imported yet.</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><Th>When</Th><Th>Report</Th><Th>File</Th><Th right>Parsed</Th><Th right>Written</Th><Th right>Net</Th><Th>By</Th></tr></thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <Td>{new Date(b.imported_at).toLocaleString()}</Td>
                      <Td>{b.report_type}</Td>
                      <Td>{b.source_file}</Td>
                      <Td right>{int(b.rows_parsed)}</Td>
                      <Td right>{int(b.rows_written)}</Td>
                      <Td right>{money(b.total_amount)}</Td>
                      <Td>{b.imported_by || '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </div>
  );
}

// ─── Financial statements ────────────────────────────────────────────
function Statements({ year, setYear, glYears }) {
  const [view, setView] = useState('income');
  const [totals, setTotals] = useState([]);
  const [reported, setReported] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!year || !supabase) { setTotals([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const [t, r] = await Promise.all([
          supabase.rpc('gl_account_totals', { p_year: year }),
          supabase.from('gl_account_balances').select('*').eq('fiscal_year', year),
        ]);
        if (t.error) throw t.error;
        if (!cancelled) { setTotals(t.data || []); setReported(r.error ? [] : (r.data || [])); }
      } catch (e) {
        if (!cancelled) setErr(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [year]);

  // gl_account_totals returns account-level sums already shaped like entries,
  // so the same builders serve both the per-entry and pre-aggregated paths.
  const is = useMemo(() => buildIncomeStatement(totals), [totals]);
  const bs = useMemo(() => buildBalanceSheet(totals), [totals]);
  const tb = useMemo(() => buildTrialBalance(totals), [totals]);
  const rec = useMemo(() => (reported.length ? reconcile(totals, reported) : null), [totals, reported]);

  if (!glYears.length) {
    return <Banner tone="warn" title="No ledger data">Import a NetSuite General Ledger export first — see the Import tab.</Banner>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={year || ''} onChange={(e) => setYear(Number(e.target.value))}
          style={{ fontSize: 12, padding: '6px 10px', border: `1px solid ${C.line}`, borderRadius: 4 }}>
          {glYears.map((y) => <option key={y.fiscal_year} value={y.fiscal_year}>FY {y.fiscal_year}</option>)}
        </select>
        {[['income', 'Income Statement'], ['balance', 'Balance Sheet'], ['trial', 'Trial Balance']].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} className="btn btn-sm"
            style={{ fontSize: 11, background: view === id ? C.blue : 'white', color: view === id ? 'white' : C.slate, border: `1px solid ${view === id ? C.blue : C.line}` }}>{label}</button>
        ))}
      </div>

      {loading && <div style={{ padding: 20, color: C.mute, fontSize: 12 }}>Loading…</div>}
      {err && <Banner tone="bad" title="Could not build the statement">{err}</Banner>}

      {!loading && !err && (
        <>
          {!tb.isBalanced && (
            <Banner tone="bad" title={`FY${year} does not balance — out by ${money(tb.totals.difference)}`}>
              Debits and credits should be equal. A difference means the imported ledger detail is missing rows,
              so <strong>every figure below is understated or overstated by some part of that amount</strong>.
              Re-export the full year from NetSuite before using these numbers.
            </Banner>
          )}
          {rec && rec.differing > 0 && (
            <Banner tone="warn" title={`${rec.differing} accounts differ from NetSuite's own reported balances`}>
              Derived-from-detail vs the imported report differ by {money(rec.totalDifference)} in total.
              Largest: {rec.rows.slice(0, 3).map((r) => `${r.account} (${money(r.difference)})`).join(', ')}.
            </Banner>
          )}
          {rec && rec.differing === 0 && rec.matched > 0 && (
            <Banner tone="good" title={`Ties to NetSuite — ${rec.matched} accounts match the imported report exactly`} />
          )}

          {view === 'income' && (
            <div className="card">
              <div className="card-header"><h2 style={{ fontSize: 14 }}>Income Statement — FY{year}</h2></div>
              <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead><tr><Th>Account</Th><Th right>Entries</Th><Th right>Amount</Th></tr></thead>
                  <tbody>
                    <StatementSection title="Revenue" rows={is.sections.income} total={is.totals.revenue} />
                    <StatementSection title="Cost of Goods Sold" rows={is.sections.cogs} total={is.totals.cogs} />
                    <tr style={{ background: C.blueBg }}>
                      <Td bold>Gross Profit</Td><Td />
                      <Td right bold>{money(is.totals.grossProfit)}</Td>
                    </tr>
                    <StatementSection title="Operating Expenses" rows={is.sections.expense} total={is.totals.opex} />
                    <tr style={{ background: C.blueBg }}>
                      <Td bold>Operating Income</Td><Td />
                      <Td right bold>{money(is.totals.operatingIncome)}</Td>
                    </tr>
                    {is.sections.otherIncome.length > 0 && <StatementSection title="Other Income" rows={is.sections.otherIncome} total={is.totals.otherIncome} />}
                    {is.sections.otherExpense.length > 0 && <StatementSection title="Other Expense" rows={is.sections.otherExpense} total={is.totals.otherExpense} />}
                    <tr style={{ background: is.totals.netIncome >= 0 ? C.goodBg : C.badBg }}>
                      <Td bold>Net Income</Td><Td />
                      <Td right bold tone={is.totals.netIncome >= 0 ? 'good' : 'bad'}>{money(is.totals.netIncome)}</Td>
                    </tr>
                  </tbody>
                </table>
                <div style={{ padding: '8px 12px', fontSize: 10.5, color: C.mute, borderTop: `1px solid ${C.line}` }}>
                  {Math.abs(is.checkNetIncome - is.totals.netIncome) < 0.01
                    ? <span style={{ color: C.good }}>✓ Net income re-derived independently from the raw ledger sum and agrees.</span>
                    : <span style={{ color: C.bad }}>⚠ Independent check disagrees ({money(is.checkNetIncome)}) — a group is missing from the statement above.</span>}
                  {' '}Built from {int(is.entryCount)} account totals.
                </div>
              </div>
            </div>
          )}

          {view === 'balance' && (
            <div className="card">
              <div className="card-header"><h2 style={{ fontSize: 14 }}>Balance Sheet — FY{year}</h2></div>
              <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead><tr><Th>Account</Th><Th right>Entries</Th><Th right>Amount</Th></tr></thead>
                  <tbody>
                    <StatementSection title="Assets" rows={bs.sections.assets} total={bs.totals.assets} />
                    <StatementSection title="Liabilities" rows={bs.sections.liabilities} total={bs.totals.liabilities} />
                    <StatementSection title="Equity" rows={bs.sections.equity} total={bs.totals.equity} />
                    <tr style={{ background: C.blueBg }}>
                      <Td bold>Liabilities + Equity</Td><Td />
                      <Td right bold>{money(bs.totals.liabilitiesAndEquity)}</Td>
                    </tr>
                  </tbody>
                </table>
                <div style={{ padding: '8px 12px', fontSize: 10.5, color: C.mute, borderTop: `1px solid ${C.line}` }}>
                  {Math.abs(bs.outOfBalance) < 0.01
                    ? <span style={{ color: C.good }}>✓ Assets equal liabilities plus equity.</span>
                    : <span style={{ color: C.bad }}>⚠ Out of balance by {money(bs.outOfBalance)} — usually current-year net income not yet closed to retained earnings in the imported data.</span>}
                </div>
              </div>
            </div>
          )}

          {view === 'trial' && (
            <div className="card">
              <div className="card-header"><h2 style={{ fontSize: 14 }}>Trial Balance — FY{year}</h2></div>
              <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead><tr><Th>Account</Th><Th>Group</Th><Th right>Debit</Th><Th right>Credit</Th></tr></thead>
                  <tbody>
                    {tb.accounts.map((a) => (
                      <tr key={a.account_full_name}>
                        <Td>{a.account_number ? <span style={{ color: C.mute, marginRight: 6 }}>{a.account_number}</span> : null}{a.account_full_name}</Td>
                        <Td>{a.statement_group || <span style={{ color: C.bad }}>unclassified</span>}</Td>
                        <Td right>{a.debit ? money(a.debit) : ''}</Td>
                        <Td right>{a.credit ? money(a.credit) : ''}</Td>
                      </tr>
                    ))}
                    <tr style={{ background: tb.isBalanced ? C.goodBg : C.badBg }}>
                      <Td bold>Total</Td><Td />
                      <Td right bold>{money(tb.totals.debit)}</Td>
                      <Td right bold>{money(tb.totals.credit)}</Td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sales & AR ──────────────────────────────────────────────────────
function SalesAr({ salesYears, gaps }) {
  const [aging, setAging] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      // Open invoices only — the AR side. 428 rows today, so one page is enough,
      // but the limit keeps a future backlog from hanging the tab.
      const { data, error } = await supabase.from('customer_invoices')
        .select('id, document_number, raw_customer_name, invoice_date, total, status')
        .neq('status', 'paid').order('invoice_date', { ascending: true }).limit(5000);
      if (cancelled) return;
      if (error) { setErr(error.message); return; }
      const today = new Date();
      const buckets = { current: [], d30: [], d60: [], d90: [], d90plus: [] };
      for (const inv of data || []) {
        const age = Math.floor((today - new Date(inv.invoice_date)) / 86400000);
        const b = age <= 30 ? 'current' : age <= 60 ? 'd30' : age <= 90 ? 'd60' : age <= 120 ? 'd90' : 'd90plus';
        buckets[b].push({ ...inv, age });
      }
      setAging(buckets);
    })();
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => salesYears.slice().sort((a, b) => b.fiscal_year - a.fiscal_year || a.doc_type.localeCompare(b.doc_type)), [salesYears]);
  const bucketTotal = (b) => round2((aging?.[b] || []).reduce((a, r) => a + Number(r.total || 0), 0));

  return (
    <div>
      {gaps.noTaxSplit && (
        <Banner tone="bad" title="Sales tax cannot be reported">
          No invoice carries a tax figure. The totals below are gross — revenue and sales tax combined —
          and cannot be separated until the invoice export is re-run with <code>Subtotal</code> and{' '}
          <code>Tax Total</code>.
        </Banner>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h2 style={{ fontSize: 14 }}>Invoice register by year</h2></div>
        <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
            <thead><tr><Th>Year</Th><Th>Type</Th><Th right>Count</Th><Th right>Subtotal (pre-tax)</Th><Th right>Sales tax</Th><Th right>Total</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.fiscal_year + r.doc_type}>
                  <Td bold>{r.fiscal_year}</Td>
                  <Td>{r.doc_type === 'credit_memo' ? 'Credit memo' : 'Invoice'}</Td>
                  <Td right>{int(r.doc_count)}</Td>
                  <Td right>{r.subtotal_sum === null ? <span style={{ color: C.bad }}>not imported</span> : money(r.subtotal_sum)}</Td>
                  <Td right>{r.tax_sum === null ? <span style={{ color: C.bad }}>not imported</span> : money(r.tax_sum)}</Td>
                  <Td right bold>{money(r.total_sum)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h2 style={{ fontSize: 14 }}>Accounts receivable aging</h2></div>
        <div className="card-body">
          {err && <Banner tone="bad" title="Could not load AR">{err}</Banner>}
          {!aging && !err && <div style={{ fontSize: 12, color: C.mute }}>Loading…</div>}
          {aging && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <Stat label="Current (≤30d)" value={money(bucketTotal('current'))} sub={`${aging.current.length} invoices`} />
                <Stat label="31–60 days" value={money(bucketTotal('d30'))} sub={`${aging.d30.length} invoices`} />
                <Stat label="61–90 days" value={money(bucketTotal('d60'))} sub={`${aging.d60.length} invoices`} />
                <Stat label="91–120 days" value={money(bucketTotal('d90'))} sub={`${aging.d90.length} invoices`} tone="bad" />
                <Stat label="Over 120 days" value={money(bucketTotal('d90plus'))} sub={`${aging.d90plus.length} invoices`} tone="bad" />
              </div>
              <div style={{ fontSize: 10.5, color: C.mute }}>
                Aged from invoice date, not due date — NetSuite-imported invoices carry no due date in the portal.
                Open (unpaid) documents only.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Transactions ────────────────────────────────────────────────────
function Transactions() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      // Year/type rollup of the 229k imported NetSuite lines. Counting in the
      // browser would mean shipping every row, so this asks Postgres for the
      // aggregate via the same RPC pattern as the ledger.
      const { data, error } = await supabase.rpc('txn_line_year_summary');
      if (cancelled) return;
      if (error) { setErr(error.message); return; }
      setRows(data || []);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <Banner tone="info" title="Line-level transaction detail">
        These are NetSuite sales orders, invoices and credit memos broken out per line item —
        the supporting detail behind the revenue figures, not a financial statement. To search
        it by customer, document or SKU, use the <strong>Sales History</strong> page.
      </Banner>
      {err && <Banner tone="bad" title="Could not load transaction totals">{err}</Banner>}
      {!rows && !err && <div style={{ padding: 20, fontSize: 12, color: C.mute }}>Loading…</div>}
      {rows && (
        <div className="card">
          <div className="card-header"><h2 style={{ fontSize: 14 }}>Transaction lines by year</h2></div>
          <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead><tr><Th>Year</Th><Th>Type</Th><Th right>Lines</Th><Th right>Documents</Th><Th right>Amount</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.fiscal_year + r.transaction_type}>
                    <Td bold>{r.fiscal_year}</Td>
                    <Td>{String(r.transaction_type || '').replace(/_/g, ' ')}</Td>
                    <Td right>{int(r.line_count)}</Td>
                    <Td right>{int(r.doc_count)}</Td>
                    <Td right bold>{money(r.amount_sum)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: '8px 12px', fontSize: 10.5, color: C.mute, borderTop: `1px solid ${C.line}` }}>
              Sales orders and invoices are separate documents for the same business — do not add them
              together as revenue. Invoice lines are the billed figure.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Import ──────────────────────────────────────────────────────────
function ImportTab({ accounts, onDone }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [reportType, setReportType] = useState('auto');
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const accountIndex = useMemo(() => buildAccountIndex(accounts), [accounts]);

  const readFile = useCallback(async (f) => {
    setError(null); setResult(null); setParsed(null); setFile(f);
    try {
      const XLSX = await import('xlsx');
      const buf = await f.arrayBuffer();
      // SheetJS reads CSV, xlsx and NetSuite's SpreadsheetML .xls with the same
      // call, so one path covers every export format NetSuite offers.
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { setError('That file has no data rows.'); return; }
      const headers = Object.keys(rows[0]);
      const detected = detectReportType(headers);
      setReportType((prev) => (prev === 'auto' ? detected : prev));
      setParsed({ rows, headers, detected });
    } catch (e) {
      setError('Could not read that file: ' + (e.message || String(e)));
    }
  }, []);

  const effectiveType = reportType === 'auto' ? (parsed?.detected || 'unknown') : reportType;

  // Parse for preview without writing anything — the operator sees row counts,
  // totals and every warning before a single row reaches the database.
  const preview = useMemo(() => {
    if (!parsed) return null;
    const opts = { sourceFile: file?.name, accountIndex, fiscalYear };
    try {
      switch (effectiveType) {
        case 'gl_detail':         return { kind: 'gl', ...parseGlDetail(parsed.rows, opts) };
        case 'chart_of_accounts': return { kind: 'coa', ...parseChartOfAccounts(parsed.rows, opts) };
        case 'trial_balance':
        case 'income_statement':
        case 'balance_sheet':     return { kind: 'bal', ...parseBalances(parsed.rows, { ...opts, reportType: effectiveType }) };
        case 'invoice_totals':    return { kind: 'inv', ...parseInvoiceTotals(parsed.rows, opts) };
        default:                  return { kind: 'unknown', warnings: ['Could not tell what kind of report this is — pick the type manually below.'] };
      }
    } catch (e) {
      return { kind: 'error', warnings: ['Parse failed: ' + (e.message || String(e))] };
    }
  }, [parsed, effectiveType, file, accountIndex, fiscalYear]);

  const rowsToWrite = preview?.entries || preview?.accounts || preview?.balances || preview?.invoices || [];

  const doImport = async () => {
    if (!rowsToWrite.length) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const batchId = 'glb_' + Date.now().toString(36);
      const who = (await supabase.auth.getUser())?.data?.user?.email || null;
      const stamped = rowsToWrite.map((r) => ('import_batch_id' in r ? { ...r, import_batch_id: batchId } : r));

      let written = 0;
      let table, conflict;
      if (preview.kind === 'gl')       { table = 'gl_entries';          conflict = 'id'; }
      else if (preview.kind === 'coa') { table = 'gl_accounts';         conflict = 'id'; }
      else if (preview.kind === 'bal') { table = 'gl_account_balances'; conflict = 'id'; }
      // customer_invoices predates this page: its 9,082 rows were loaded by
      // scripts/load-netsuite-invoices.py keyed on netsuite_internal_id, which
      // carries the unique index. Conflicting on id instead would try to insert
      // every re-imported invoice as a new row and fail on that index.
      else if (preview.kind === 'inv') { table = 'customer_invoices';   conflict = 'netsuite_internal_id'; }
      else throw new Error('Nothing importable in this file.');

      written = await upsertChunked(table, stamped, conflict);

      const total = round2(stamped.reduce((a, r) => a + Number(r.amount ?? r.total ?? 0), 0));
      const dates = stamped.map((r) => r.entry_date || r.invoice_date).filter(Boolean).sort();
      await supabase.from('gl_import_batches').insert({
        id: batchId,
        report_type: effectiveType,
        source_file: file?.name || null,
        fiscal_year: preview.kind === 'bal' ? fiscalYear : (dates.length ? parseInt(dates[0].slice(0, 4), 10) : null),
        period_start: dates[0] || null,
        period_end: dates[dates.length - 1] || null,
        rows_parsed: parsed.rows.length,
        rows_written: written,
        rows_replaced: 0,
        total_amount: total,
        warnings: preview.warnings || [],
        imported_by: who,
      });

      setResult({ written, table, total });
      onDone && onDone();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Banner tone="info" title="Import NetSuite exports">
        Drop a NetSuite report export here — CSV, Excel, or NetSuite's SpreadsheetML <code>.xls</code>.
        Nothing is written until you press Import, and the preview below shows exactly what would land,
        including every warning. See <strong>NETSUITE_TAX_EXPORT_HANDOFF.md</strong> for how to produce
        the files.
      </Banner>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <input type="file" accept=".csv,.xls,.xlsx,.xml,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }}
            style={{ fontSize: 12 }} />
          {file && <div style={{ fontSize: 11, color: C.mute, marginTop: 8 }}>{file.name} — {int(parsed?.rows.length)} rows, {parsed?.headers.length} columns</div>}

          {parsed && (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>Report type</label>
              <select value={effectiveType} onChange={(e) => setReportType(e.target.value)}
                style={{ fontSize: 12, padding: '5px 8px', border: `1px solid ${C.line}`, borderRadius: 4 }}>
                <option value="gl_detail">General Ledger detail</option>
                <option value="chart_of_accounts">Chart of accounts</option>
                <option value="trial_balance">Trial balance</option>
                <option value="income_statement">Income statement</option>
                <option value="balance_sheet">Balance sheet</option>
                <option value="invoice_totals">Invoice / credit memo register</option>
                <option value="unknown">— unrecognised —</option>
              </select>
              {parsed.detected !== 'unknown' && <span style={{ fontSize: 10.5, color: C.mute }}>auto-detected: {parsed.detected}</span>}
              {['trial_balance', 'income_statement', 'balance_sheet'].includes(effectiveType) && (
                <>
                  <label style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>Fiscal year</label>
                  <input type="number" value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))}
                    style={{ fontSize: 12, padding: '5px 8px', width: 90, border: `1px solid ${C.line}`, borderRadius: 4 }} />
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <Banner tone="bad" title="Import failed">{error}</Banner>}
      {result && (
        <Banner tone="good" title={`Imported ${int(result.written)} rows into ${result.table}`}>
          Net amount written: {money(result.total)}.
        </Banner>
      )}

      {preview && (
        <div className="card">
          <div className="card-header"><h2 style={{ fontSize: 14 }}>Preview — nothing written yet</h2></div>
          <div className="card-body">
            {(preview.warnings || []).map((w, i) => (
              <div key={i} style={{ fontSize: 11.5, color: /differ|cannot|no figures|not a complete|Parse failed/i.test(w) ? C.bad : C.warn, marginBottom: 4 }}>• {w}</div>
            ))}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '12px 0' }}>
              <Stat label="Rows in file" value={int(parsed.rows.length)} />
              <Stat label="Rows to write" value={int(rowsToWrite.length)} />
              {preview.kind === 'gl' && <Stat label="Debits − credits" value={money(preview.net)} tone={Math.abs(preview.net || 0) < 0.01 ? 'good' : 'bad'} sub={Math.abs(preview.net || 0) < 0.01 ? 'balanced' : 'incomplete period'} />}
            </div>

            {rowsToWrite.length > 0 && (
              <div style={{ overflowX: 'auto', border: `1px solid ${C.line}`, borderRadius: 4, marginBottom: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                  <thead><tr>{Object.keys(rowsToWrite[0]).slice(0, 8).map((k) => <Th key={k}>{k}</Th>)}</tr></thead>
                  <tbody>
                    {rowsToWrite.slice(0, 8).map((r, i) => (
                      <tr key={i}>{Object.keys(rowsToWrite[0]).slice(0, 8).map((k) => <Td key={k}>{String(r[k] ?? '')}</Td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button className="btn btn-primary" disabled={busy || !rowsToWrite.length} onClick={doImport}
              style={{ fontSize: 12, opacity: busy || !rowsToWrite.length ? .5 : 1 }}>
              {busy ? 'Importing…' : `Import ${int(rowsToWrite.length)} rows`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tax export ──────────────────────────────────────────────────────
function TaxExport({ glYears, salesYears }) {
  const years = useMemo(() => {
    const s = new Set([...glYears.map((y) => y.fiscal_year), ...salesYears.map((r) => r.fiscal_year)]);
    return [...s].sort((a, b) => b - a);
  }, [glYears, salesYears]);
  const [year, setYear] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => { if (!year && years.length) setYear(years[0]); }, [years, year]);

  const exportGl = async () => {
    setBusy('gl'); setErr(null);
    try {
      const { data, error } = await supabase.rpc('gl_account_totals', { p_year: year });
      if (error) throw error;
      const tb = buildTrialBalance(data || []);
      download(`trial_balance_${year}.csv`, toCsv(
        ['Account number', 'Account', 'Group', 'Debit', 'Credit'],
        tb.accounts.map((a) => [a.account_number, a.account_full_name, a.statement_group, a.debit || '', a.credit || '']),
      ));
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(null); }
  };

  const exportPl = async () => {
    setBusy('pl'); setErr(null);
    try {
      const { data, error } = await supabase.rpc('gl_account_totals', { p_year: year });
      if (error) throw error;
      const is = buildIncomeStatement(data || []);
      const rows = [];
      const add = (section, list) => list.forEach((a) => rows.push([section, a.account_number, a.account_full_name, a.display]));
      add('Revenue', is.sections.income);
      add('COGS', is.sections.cogs);
      add('Operating expense', is.sections.expense);
      add('Other income', is.sections.otherIncome);
      add('Other expense', is.sections.otherExpense);
      rows.push([], ['TOTALS'], ['Revenue', '', '', is.totals.revenue], ['COGS', '', '', is.totals.cogs],
        ['Gross profit', '', '', is.totals.grossProfit], ['Operating expenses', '', '', is.totals.opex],
        ['Net income', '', '', is.totals.netIncome]);
      download(`income_statement_${year}.csv`, toCsv(['Section', 'Account number', 'Account', 'Amount'], rows));
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(null); }
  };

  const exportInvoices = async () => {
    setBusy('inv'); setErr(null);
    try {
      // Paged: PostgREST caps a response at 1000 rows regardless of .limit(),
      // so a year of invoices needs several requests.
      const out = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('customer_invoices')
          .select('document_number, invoice_date, type, raw_customer_name, status, subtotal, tax, total, rep_name, memo')
          .gte('invoice_date', `${year}-01-01`).lte('invoice_date', `${year}-12-31`)
          .order('invoice_date', { ascending: true }).order('id', { ascending: true })
          .range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if ((data || []).length < 1000) break;
      }
      download(`invoice_register_${year}.csv`, toCsv(
        ['Document', 'Date', 'Type', 'Customer', 'Status', 'Subtotal', 'Tax', 'Total', 'Rep', 'Memo'],
        out.map((r) => [r.document_number, r.invoice_date, r.type, r.raw_customer_name, r.status, r.subtotal ?? '', r.tax ?? '', r.total, r.rep_name, r.memo]),
      ));
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(null); }
  };

  const hasGl = glYears.some((y) => y.fiscal_year === year);

  return (
    <div>
      <Banner tone="info" title="Files for your accountant">
        Each button downloads a CSV built from the portal's imported data. What is <em>not</em> here is
        anything the portal has never been given — see the Overview tab for the current gaps.
      </Banner>
      {err && <Banner tone="bad" title="Export failed">{err}</Banner>}

      <div className="card">
        <div className="card-body">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.slate }}>Tax year</label>
            <select value={year || ''} onChange={(e) => setYear(Number(e.target.value))}
              style={{ fontSize: 12, padding: '6px 10px', border: `1px solid ${C.line}`, borderRadius: 4 }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            {[
              { id: 'pl', label: 'Income statement', desc: 'Revenue, COGS, expenses and net income by account.', fn: exportPl, need: hasGl },
              { id: 'gl', label: 'Trial balance', desc: 'Every account with its debit or credit balance.', fn: exportGl, need: hasGl },
              { id: 'inv', label: 'Invoice register', desc: 'Every invoice and credit memo with customer, date and total.', fn: exportInvoices, need: true },
            ].map((x) => (
              <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 4 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy }}>{x.label}</div>
                  <div style={{ fontSize: 11, color: C.mute }}>{x.desc}</div>
                  {!x.need && <div style={{ fontSize: 11, color: C.bad, marginTop: 2 }}>No ledger data imported for {year} — import a General Ledger export first.</div>}
                </div>
                <button className="btn btn-sm" disabled={!x.need || busy === x.id} onClick={x.fn}
                  style={{ fontSize: 11, opacity: !x.need || busy === x.id ? .5 : 1 }}>
                  <Icon name="save" size={11} /> {busy === x.id ? 'Building…' : 'Download CSV'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
