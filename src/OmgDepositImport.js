import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import { parseOmgDepositStatement } from './lib/omgDeposit';

const money = n => {
  const value = Number(n) || 0;
  const body = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `($${body})` : `$${body}`;
};
const moneyColor = n => ((Number(n) || 0) < 0 ? '#b91c1c' : '#065f46');
const shortDate = iso => {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}/${match[3]}/${match[1].slice(2)}` : (iso || '—');
};

const DEPOSIT_COLS = 'id,statement_key,statement_no,statement_date,deposit_status,bank_account,stores_included,total_collected,omg_fee,processing_fee,net_amount,source_file,imported_at';
const LINE_COLS = 'id,line_no,store_code,work_order,store_name,store_id,collected,omg_fee,processing_fee,net_deposit';

/**
 * OMG Deposit Statements — upload the weekly PDF once, and every store row on it
 * is recorded against its OMG store.
 *
 * A row for a store the portal has not ingested yet is kept, not dropped: it
 * parks against its sale code and a database trigger links it the moment that
 * store appears. So the statement can be uploaded before or after a store is
 * processed and the money lands either way.
 */
export default function OmgDepositImport({ stores = [], currentUser, notify, extractPdfText }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState('');
  const [deposits, setDeposits] = useState([]);
  const [waitingCount, setWaitingCount] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedLines, setExpandedLines] = useState([]);
  const fileRef = useRef(null);

  const byCode = useMemo(() => {
    const out = new Map();
    stores.forEach(store => {
      const code = String(store?._omg_sale_code || '').trim().toUpperCase();
      if (code && !out.has(code)) out.set(code, store);
    });
    return out;
  }, [stores]);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const [statementResult, waitingResult] = await Promise.all([
      supabase.from('omg_deposits').select(DEPOSIT_COLS).order('statement_date', { ascending: false }).limit(12),
      supabase.from('omg_deposit_lines').select('id', { count: 'exact', head: true }).is('store_id', null),
    ]);
    if (!statementResult.error) setDeposits(statementResult.data || []);
    if (!waitingResult.error) setWaitingCount(waitingResult.count || 0);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const readFile = async file => {
    if (!file) return;
    if (!extractPdfText) return notify?.('PDF reading is unavailable here', 'error');
    if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''))) {
      return notify?.('Drop the OMG Deposit Statement PDF', 'error');
    }
    setBusy(true);
    try {
      const { fullText } = await extractPdfText(file);
      const result = parseOmgDepositStatement(fullText);
      setParsed(result);
      setFileName(file.name || 'OMG Deposit Statement');
      if (result.problems.length) notify?.(`Statement read with ${result.problems.length} problem(s) — review below`, 'error');
      else notify?.(`Read ${result.lines.length} stores · net ${money(result.netAmount)}`);
    } catch (error) {
      notify?.(`Could not read the deposit statement: ${error.message}`, 'error');
      setParsed(null);
    } finally { setBusy(false); }
  };

  const preview = useMemo(() => {
    if (!parsed) return [];
    return parsed.lines.map(line => ({ ...line, store: byCode.get(line.storeCode) || null }));
  }, [parsed, byCode]);
  const matchedCount = preview.filter(row => row.store).length;
  const existing = parsed ? deposits.find(d => d.statement_key === parsed.statementKey) : null;

  const importStatement = async () => {
    if (!supabase) return notify?.('Supabase is not connected', 'error');
    if (!parsed || parsed.problems.length) return notify?.('Fix the statement problems before importing', 'error');
    setBusy(true);
    try {
      // One RPC = one transaction. Re-importing the same statement replaces its
      // rows rather than doubling them (statement_key keys it), and a failure
      // part-way cannot leave the statement holding header totals with no rows.
      const { error } = await supabase.rpc('omg_import_deposit', {
        p_deposit: {
          statement_key: parsed.statementKey,
          statement_no: parsed.statementNo || '',
          statement_date: parsed.statementDate,
          deposit_status: parsed.depositStatus || '',
          bank_account: parsed.bankAccount || '',
          stores_included: parsed.storesIncluded,
          total_collected: parsed.totalCollected,
          omg_fee: parsed.omgFee,
          processing_fee: parsed.processingFee,
          net_amount: parsed.netAmount,
          source_file: fileName,
          imported_by: currentUser?.id || '',
        },
        p_lines: parsed.lines.map((line, index) => ({
          line_no: index + 1,
          store_code: line.storeCode,
          work_order: line.workOrder || '',
          store_name: line.storeName || '',
          collected: line.collected,
          omg_fee: line.omgFee,
          processing_fee: line.processingFee,
          net_deposit: line.netDeposit,
        })),
      });
      if (error) throw error;

      const parked = parsed.lines.length - matchedCount;
      notify?.(`Deposit ${parsed.statementNo || shortDate(parsed.statementDate)} imported · ${matchedCount} applied to stores${parked ? ` · ${parked} waiting for their store` : ''}`);
      setParsed(null); setFileName('');
      await refresh();
    } catch (error) {
      notify?.(`Deposit import failed: ${error.message}`, 'error');
    } finally { setBusy(false); }
  };

  const toggleExpand = async deposit => {
    if (expandedId === deposit.id) { setExpandedId(null); setExpandedLines([]); return; }
    setExpandedId(deposit.id); setExpandedLines([]);
    const { data, error } = await supabase.from('omg_deposit_lines').select(LINE_COLS).eq('deposit_id', deposit.id).order('line_no');
    if (!error) setExpandedLines(data || []);
  };

  const latest = deposits[0] || null;

  return <div className="card" style={{ marginBottom: 12, border: '1px solid #6ee7b7' }}>
    <div style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#047857' }}>OMG Deposits</div>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
            Upload the weekly OMG <b>Deposit Statement</b> PDF. Every store row on it is applied to that store — and rows for stores you haven’t ingested yet wait and attach themselves later.
          </div>
          <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 4 }}>
            {latest
              ? <>Last statement {shortDate(latest.statement_date)} · {latest.stores_included} stores · net <b style={{ color: moneyColor(latest.net_amount) }}>{money(latest.net_amount)}</b></>
              : 'No deposit statements imported yet.'}
            {waitingCount ? <span style={{ color: '#b45309' }}> · {waitingCount} row{waitingCount === 1 ? '' : 's'} waiting for their store</span> : null}
          </div>
        </div>
        <button className="btn btn-sm" style={{ background: '#047857', color: '#fff' }} onClick={() => setOpen(v => !v)}>{open ? 'Close' : 'Import deposit statement'}</button>
      </div>

      {open && <div style={{ marginTop: 14, borderTop: '1px solid #d1fae5', paddingTop: 14 }}>
        <div
          style={{ border: '2px dashed #6ee7b7', borderRadius: 8, padding: 16, textAlign: 'center', cursor: busy ? 'wait' : 'pointer', background: '#ecfdf5' }}
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#047857'; }}
          onDragLeave={e => { e.currentTarget.style.borderColor = '#6ee7b7'; }}
          onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#6ee7b7'; readFile(e.dataTransfer.files?.[0]); }}
          onClick={() => { if (!busy) fileRef.current?.click(); }}
        >
          <div style={{ fontSize: 24, marginBottom: 4 }}>🏦</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#047857' }}>{busy ? 'Reading…' : <>Drop the <u>Deposit Statement</u> PDF here</>}</div>
          <div style={{ fontSize: 11, color: '#059669' }}>click to select · reads the store code and Net Deposit on every row</div>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={e => { readFile(e.target.files?.[0]); e.target.value = ''; }}/>
        </div>

        {parsed && <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', padding: '9px 12px', background: '#f8fafc', borderRadius: 7, fontSize: 11.5 }}>
            <span><b>{parsed.statementNo || 'No statement #'}</b> · {shortDate(parsed.statementDate)}</span>
            {parsed.depositStatus && <span style={{ color: '#64748b' }}>status {parsed.depositStatus}</span>}
            {parsed.bankAccount && <span style={{ color: '#64748b' }}>{parsed.bankAccount}</span>}
            <span>collected <b>{money(parsed.totalCollected)}</b></span>
            <span>OMG fee <b>{money(parsed.omgFee)}</b></span>
            <span>processing <b>{money(parsed.processingFee)}</b></span>
            <span>net deposit <b style={{ color: moneyColor(parsed.netAmount) }}>{money(parsed.netAmount)}</b></span>
          </div>

          {parsed.problems.length > 0 && <div style={{ marginTop: 10, padding: '9px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, fontSize: 11.5, color: '#b91c1c' }}>
            <b>This statement did not read cleanly — nothing will be imported.</b>
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>{parsed.problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>
          </div>}

          {existing && parsed.problems.length === 0 && <div style={{ marginTop: 10, padding: '9px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, fontSize: 11.5, color: '#92400e' }}>
            Already imported on {shortDate(existing.imported_at)}. Importing again replaces its rows — it will not double the money.
          </div>}

          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead><tr style={{ color: '#64748b', textAlign: 'left' }}>
                {['Code', 'Store', 'Collected', 'OMG fee', 'Processing', 'Net deposit', 'Applies to'].map(h =>
                  <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid #e2e8f0', textAlign: h === 'Code' || h === 'Store' || h === 'Applies to' ? 'left' : 'right' }}>{h}</th>)}
              </tr></thead>
              <tbody>{preview.map(row => <tr key={row.lineNo} style={{ borderBottom: '1px solid #f1f5f9', background: row.problems.length ? '#fff7ed' : '#fff' }}>
                <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontWeight: 800 }}>{row.storeCode}{row.workOrder ? <div style={{ color: '#94a3b8', fontWeight: 400, fontSize: 10 }}>{row.workOrder}</div> : null}</td>
                <td style={{ padding: '7px 8px' }}>{row.store?.store_name || row.storeName || '—'}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{money(row.collected)}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{money(row.omgFee)}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{money(row.processingFee)}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 800, color: moneyColor(row.netDeposit) }}>{money(row.netDeposit)}</td>
                <td style={{ padding: '7px 8px', fontWeight: 700, color: row.store ? '#166534' : '#b45309' }}>
                  {row.store ? 'This store' : 'Waits for this store'}
                </td>
              </tr>)}</tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {matchedCount} of {preview.length} rows match a store in the portal today. The other {preview.length - matchedCount} are still recorded and attach automatically when those stores are ingested.
            </span>
            <button className="btn btn-primary" style={{ background: '#047857', borderColor: '#047857' }} disabled={busy || !!parsed.problems.length} onClick={importStatement}>
              {busy ? 'Importing…' : `Import ${preview.length} store row${preview.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>}

        {deposits.length > 0 && <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Imported statements</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <tbody>{deposits.map(deposit => <React.Fragment key={deposit.id}>
              <tr style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }} onClick={() => toggleExpand(deposit)}>
                <td style={{ padding: '7px 8px', width: 18, color: '#94a3b8' }}>{expandedId === deposit.id ? '▾' : '▸'}</td>
                <td style={{ padding: '7px 8px', fontWeight: 700 }}>{shortDate(deposit.statement_date)}</td>
                <td style={{ padding: '7px 8px', fontFamily: 'monospace', color: '#64748b' }}>{deposit.statement_no || '—'}</td>
                <td style={{ padding: '7px 8px', color: '#64748b' }}>{deposit.stores_included} stores</td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{money(deposit.total_collected)} collected</td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 800, color: moneyColor(deposit.net_amount) }}>{money(deposit.net_amount)}</td>
              </tr>
              {expandedId === deposit.id && <tr><td colSpan={6} style={{ padding: '0 8px 10px 26px', background: '#f8fafc' }}>
                {expandedLines.length === 0 ? <div style={{ padding: '8px 0', color: '#94a3b8' }}>Loading…</div> : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <tbody>{expandedLines.map(line => <tr key={line.id} style={{ borderBottom: '1px solid #eef2f7' }}>
                    <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontWeight: 700 }}>{line.store_code}</td>
                    <td style={{ padding: '5px 8px' }}>{line.store_name || '—'}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, color: moneyColor(line.net_deposit) }}>{money(line.net_deposit)}</td>
                    <td style={{ padding: '5px 8px', width: 150, color: line.store_id ? '#166534' : '#b45309', fontWeight: 700 }}>{line.store_id ? 'Applied' : 'Waiting for store'}</td>
                  </tr>)}</tbody>
                </table>}
              </td></tr>}
            </React.Fragment>)}</tbody>
          </table>
        </div>}
      </div>}
    </div>
  </div>;
}

/**
 * The deposits side of one OMG store: every statement that has paid it, and the
 * running total of cash actually received. Shown on the store detail page.
 */
export function OmgStoreDeposits({ store }) {
  const [lines, setLines] = useState(null);
  const storeId = store?.id || '';
  const saleCode = String(store?._omg_sale_code || '').trim().toUpperCase();

  useEffect(() => {
    if (!supabase || !storeId) { setLines([]); return; }
    let cancelled = false;
    setLines(null);
    supabase.from('omg_deposit_lines')
      .select('id,store_code,collected,omg_fee,processing_fee,net_deposit,omg_deposits(statement_date,statement_no,deposit_status)')
      .eq('store_id', storeId)
      .then(({ data, error }) => {
        if (cancelled) return;
        setLines(error ? [] : (data || []));
      });
    return () => { cancelled = true; };
  }, [storeId]);

  if (!saleCode) return null;
  const rows = [...(lines || [])].sort((a, b) =>
    String(a.omg_deposits?.statement_date || '').localeCompare(String(b.omg_deposits?.statement_date || '')));
  const totalNet = rows.reduce((total, row) => total + (Number(row.net_deposit) || 0), 0);
  const totalCollected = rows.reduce((total, row) => total + (Number(row.collected) || 0), 0);
  // What the closeout Accounting Report says OMG owes us in total, when it has
  // been entered. The gap is money still to be deposited (or over-deposited).
  const reportedNet = Number(store?._omg_net_revenue) || 0;
  const outstanding = reportedNet ? Math.round((reportedNet - totalNet) * 100) / 100 : null;

  return <div className="card" style={{ borderLeft: '4px solid #047857', margin: 0 }}><div style={{ padding: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 800, background: '#d1fae5', color: '#047857', padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>③ Cash in ↑</span>
      <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>OMG Deposits</span>
    </div>
    <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 10 }}>
      Money OMG has actually deposited for <b>{saleCode}</b>, from the weekly Deposit Statements imported on the OMG Stores page.
    </div>
    {lines === null
      ? <div style={{ fontSize: 11.5, color: '#94a3b8' }}>Loading…</div>
      : rows.length === 0
        ? <div style={{ fontSize: 11.5, color: '#94a3b8' }}>No deposit statement has included this store yet.</div>
        : <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead><tr style={{ color: '#64748b', textAlign: 'left' }}>
              {['Statement', 'Collected', 'OMG fee', 'Processing', 'Net deposit'].map((h, i) =>
                <th key={h} style={{ padding: '5px 8px', borderBottom: '1px solid #e2e8f0', textAlign: i ? 'right' : 'left' }}>{h}</th>)}
            </tr></thead>
            <tbody>{rows.map(row => <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '6px 8px' }}>{shortDate(row.omg_deposits?.statement_date)}<span style={{ color: '#94a3b8', marginLeft: 6, fontFamily: 'monospace', fontSize: 10 }}>{row.omg_deposits?.statement_no || ''}</span></td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(row.collected)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(row.omg_fee)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(row.processing_fee)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, color: moneyColor(row.net_deposit) }}>{money(row.net_deposit)}</td>
            </tr>)}</tbody>
            <tfoot><tr style={{ borderTop: '2px solid #e2e8f0' }}>
              <td style={{ padding: '7px 8px', fontWeight: 800 }}>{rows.length} deposit{rows.length === 1 ? '' : 's'}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700 }}>{money(totalCollected)}</td>
              <td colSpan={2}/>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 800, color: moneyColor(totalNet) }}>{money(totalNet)}</td>
            </tr></tfoot>
          </table>
          {outstanding !== null && <div style={{ marginTop: 8, fontSize: 11, color: Math.abs(outstanding) < 1 ? '#166534' : '#b45309' }}>
            {Math.abs(outstanding) < 1
              ? `✓ Fully deposited — matches the Accounting Report net revenue of ${money(reportedNet)}`
              : `Accounting Report net revenue is ${money(reportedNet)} — ${money(Math.abs(outstanding))} ${outstanding > 0 ? 'not yet deposited' : 'deposited above the report'}`}
          </div>}
        </>}
  </div></div>;
}
