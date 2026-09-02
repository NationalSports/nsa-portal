import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import { normalizeOmgProfitRow } from './lib/omgMonthlyProfit';

const money = n => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const previousMonth = () => {
  const d = new Date();
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function OmgMonthlyProfitImport({ stores = [], customers = [], reps = [], currentUser, notify }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(previousMonth);
  const [isCumulative, setIsCumulative] = useState(true);
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const fileRef = useRef(null);
  const byCode = useMemo(() => {
    const out = new Map();
    stores.forEach(store => {
      const code = String(store?._omg_sale_code || '').trim().toUpperCase();
      if (code) out.set(code, store);
    });
    return out;
  }, [stores]);
  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
  const repMap = useMemo(() => new Map(reps.map(r => [r.id, r])), [reps]);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.from('omg_store_commission_months').select('id', { count: 'exact', head: true }).eq('status', 'held').then(heldResult => {
      if (cancelled) return;
      if (!heldResult.error) setHeldCount(heldResult.count || 0);
    });
    return () => { cancelled = true; };
  }, []);

  const parseFile = async file => {
    if (!file) return;
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const normalized = raw.map((r, index) => {
        const parsed = normalizeOmgProfitRow(r, { periodMonth: `${period}-01`, isCumulative });
        const store = byCode.get(parsed.storeCode) || null;
        const customer = store?.customer_id ? customerMap.get(store.customer_id) : null;
        const repId = store?.rep_id || customer?.primary_rep_id || null;
        const rep = repId ? repMap.get(repId) : null;
        const problems = [];
        if (!parsed.storeCode) problems.push('Missing store code');
        else if (!store) problems.push('Store code not found');
        if (store && !customer) problems.push('Store needs a customer');
        if (store && customer && !rep) problems.push('Store/customer needs a rep');
        return { ...parsed, index: index + 2, store, customer, rep, repId, problems };
      }).filter(r => r.storeCode || r.productCollected || r.itemCost || r.productProfit);
      setRows(normalized);
      setFileName(file.name || 'OMG margin import');
      if (!normalized.length) notify?.('No OMG margin rows were found in that file', 'error');
    } catch (error) {
      notify?.(`Could not read OMG margin file: ${error.message}`, 'error');
      setRows([]);
    } finally { setBusy(false); }
  };

  const readyRows = rows.filter(r => !r.problems.length);
  const importRows = async () => {
    if (!supabase) return notify?.('Supabase is not connected', 'error');
    if (!readyRows.length) return notify?.('No fully mapped rows are ready to import', 'error');
    setBusy(true);
    try {
      const payload = readyRows.map(r => ({
        store_id: r.store.id,
        store_code: r.storeCode,
        period_month: r.periodMonth,
        is_cumulative: r.isCumulative,
        customer_id: r.customer.id,
        rep_id: r.repId,
        products: r.products,
        product_collected: r.productCollected,
        item_cost: r.itemCost,
        product_profit: r.productProfit,
        margin_pct: r.marginPct,
        refunds: r.refunds,
        omg_fees: r.omgFees,
        processing_fees: r.processingFees,
        invoiced_fees: r.invoicedFees,
        net_profit: r.netProfit,
        source_file: fileName,
        source_mode: 'manual',
        validation_status: 'pending',
        validation: { source: 'manual_import', note: 'Fallback snapshot; nightly API closeout remains authoritative.' },
        imported_by: currentUser?.id || null,
        imported_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from('omg_store_profit_snapshots')
        .upsert(payload, { onConflict: 'store_id,period_month' });
      if (error) throw error;
      notify?.(`Imported ${payload.length} OMG profit snapshot${payload.length === 1 ? '' : 's'} for ${period}`);
      setRows([]); setFileName(''); setOpen(false);
    } catch (error) { notify?.(`OMG profit import failed: ${error.message}`, 'error'); }
    finally { setBusy(false); }
  };

  const downloadTemplate = () => {
    const header = ['Store Code', 'Store Name', 'Products', 'Collected', 'Cost', 'Profit', 'Margin', 'Refunds', 'OMG Fees', 'Processing Fees', 'Invoiced Fees', 'Net Profit'];
    const csvRows = stores.filter(s => s._omg_sale_code).map(s => [s._omg_sale_code, s.store_name || '', '', '', '', '', '', '', '', '', '', '']);
    const esc = value => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
    const csv = [header, ...csvRows].map(r => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `omg-margin-snapshot-${period}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  return <div className="card" style={{ marginBottom: 12, border: '1px solid #c4b5fd' }}>
    <div style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: 15, fontWeight: 800, color: '#6d28d9' }}>OMG Monthly Profit</div>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>Import one cumulative OMG Margin Report snapshot each month. Store codes assign every row to its customer and rep.</div>
          <div style={{ fontSize: 10.5, color: '#b45309', marginTop: 4 }}>
            OMG's V1 API does not reliably return sale-filtered product costs, so automatic accounting writes are disabled.{heldCount ? ` ${heldCount} commission hold${heldCount === 1 ? '' : 's'} need review.` : ''}
          </div></div>
        <div style={{display:'flex',gap:7}}>
          <button className="btn btn-sm" style={{ background: '#6d28d9', color: '#fff' }} onClick={() => setOpen(v => !v)}>{open ? 'Close' : 'Import monthly snapshot'}</button>
        </div>
      </div>
      {open && <div style={{ marginTop: 14, borderTop: '1px solid #ede9fe', paddingTop: 14 }}>
        <div style={{ padding: '9px 12px', background: '#f5f3ff', borderRadius: 7, color: '#5b21b6', fontSize: 11.5, marginBottom: 12 }}>
          OMG’s Margin Report is cumulative. Keep <b>Cumulative snapshot</b> selected and the portal will subtract the prior snapshot to calculate that month’s profit. The first import becomes the baseline.
        </div>
        <div style={{ display: 'flex', alignItems: 'end', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, color: '#475569' }}>Reporting month<br/><input type="month" value={period} onChange={e => { setPeriod(e.target.value); setRows([]); }} style={{ marginTop: 3, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 5 }}/></label>
          <label style={{ fontSize: 11, color: '#475569' }}>Import type<br/><select value={isCumulative ? 'cumulative' : 'monthly'} onChange={e => { setIsCumulative(e.target.value === 'cumulative'); setRows([]); }} style={{ marginTop: 3, padding: '7px 8px', border: '1px solid #cbd5e1', borderRadius: 5 }}><option value="cumulative">Cumulative OMG snapshot</option><option value="monthly">Monthly totals</option></select></label>
          <button className="btn btn-sm btn-secondary" onClick={downloadTemplate}>Download mapped-store template</button>
          <button className="btn btn-sm btn-primary" disabled={busy || !period} onClick={() => fileRef.current?.click()}>{busy ? 'Reading…' : 'Choose completed CSV / Excel'}</button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={e => { parseFile(e.target.files?.[0]); e.target.value = ''; }}/>
        </div>
        {rows.length > 0 && <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}><thead><tr style={{ color: '#64748b', textAlign: 'left' }}>
            {['Code', 'Store / mapping', 'Collected', 'Cost', 'Product profit', 'Fees + refunds', 'Net profit', 'Status'].map(h => <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid #e2e8f0' }}>{h}</th>)}
          </tr></thead><tbody>{rows.map(r => <tr key={`${r.index}-${r.storeCode}`} style={{ borderBottom: '1px solid #f1f5f9', background: r.problems.length ? '#fff7ed' : '#fff' }}>
            <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontWeight: 800 }}>{r.storeCode || '—'}</td>
            <td style={{ padding: '7px 8px' }}><b>{r.store?.store_name || r.storeName || 'Unknown store'}</b><div style={{ color: '#64748b', fontSize: 10.5 }}>{r.customer?.name || 'No customer'} · {r.rep?.name || 'No rep'}</div></td>
            <td style={{ padding: '7px 8px', textAlign: 'right' }}>{money(r.productCollected)}</td>
            <td style={{ padding: '7px 8px', textAlign: 'right' }}>{money(r.itemCost)}</td>
            <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, color: '#166534' }}>{money(r.productProfit)}</td>
            <td style={{ padding: '7px 8px', textAlign: 'right' }}>{money(r.refunds + r.omgFees + r.processingFees + r.invoicedFees)}</td>
            <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 800, color: '#6d28d9' }}>{money(r.netProfit)}</td>
            <td style={{ padding: '7px 8px', color: r.problems.length ? '#c2410c' : '#166534', fontWeight: 700 }}>{r.problems.length ? r.problems.join(' · ') : 'Ready'}</td>
          </tr>)}</tbody></table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <span style={{ fontSize: 11, color: '#64748b' }}>{readyRows.length} of {rows.length} rows fully mapped</span>
            <button className="btn btn-primary" disabled={busy || !readyRows.length} onClick={importRows}>{busy ? 'Importing…' : `Import ${readyRows.length} snapshot${readyRows.length === 1 ? '' : 's'}`}</button>
          </div>
        </div>}
      </div>}
    </div>
  </div>;
}
