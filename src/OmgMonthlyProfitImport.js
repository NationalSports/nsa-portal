import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import { buildManualCommissionCloseout, normalizeOmgProfitRow } from './lib/omgMonthlyProfit';

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
        const repId = customer?.primary_rep_id || store?.rep_id || null;
        const rep = repId ? repMap.get(repId) : null;
        const problems = [];
        if (!parsed.storeCode) problems.push('Missing store code');
        else if (!store) problems.push('Store code not found');
        if (store && store.channel_type !== '24/7') problems.push('Store is not classified 24/7');
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
      const storeIds = [...new Set(readyRows.map(r => r.store.id))];
      const [{ data: priorSnapshots, error: priorError }, { data: linkedOrders, error: linkedError }] = await Promise.all([
        supabase.from('omg_store_profit_snapshots')
          .select('id,store_id,store_code,period_month,is_cumulative,customer_id,rep_id,product_collected,item_cost,product_profit,refunds,omg_fees,processing_fees,invoiced_fees,net_profit')
          .in('store_id', storeIds).lt('period_month', `${period}-01`).order('period_month', { ascending: false }),
        supabase.from('sales_orders').select('id,omg_store_id').in('omg_store_id', storeIds),
      ]);
      if (priorError) throw priorError;
      if (linkedError) throw linkedError;
      const priorByStore = new Map();
      (priorSnapshots || []).forEach(snapshot => { if (!priorByStore.has(snapshot.store_id)) priorByStore.set(snapshot.store_id, snapshot); });
      const linkedByStore = new Map();
      (linkedOrders || []).forEach(order => {
        if (!linkedByStore.has(order.omg_store_id)) linkedByStore.set(order.omg_store_id, []);
        linkedByStore.get(order.omg_store_id).push(order.id);
      });
      const importedAt = new Date().toISOString();
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
        validation_status: 'ready',
        validation: { ready: true, source: 'manual_import', note: 'Verified OMG Margin Report; manual monthly import is the accounting source of truth.' },
        imported_by: currentUser?.id || null,
        imported_at: importedAt,
        updated_at: importedAt,
      }));
      const { data: savedSnapshots, error } = await supabase.from('omg_store_profit_snapshots')
        .upsert(payload, { onConflict: 'store_id,period_month' })
        .select('id,store_id,store_code,period_month,is_cumulative,customer_id,rep_id,product_collected,item_cost,product_profit,refunds,omg_fees,processing_fees,invoiced_fees,net_profit');
      if (error) throw error;
      const savedByStore = new Map((savedSnapshots || []).map(snapshot => [snapshot.store_id, snapshot]));
      const outcomes = readyRows.map(r => {
        const snapshot = savedByStore.get(r.store.id);
        if (!snapshot) throw new Error(`Snapshot save did not return ${r.storeCode}; re-import the file.`);
        return buildManualCommissionCloseout({
          snapshot,
          previousSnapshot: priorByStore.get(r.store.id) || null,
          store: r.store,
          customer: r.customer,
          rep: r.rep,
          linkedSoIds: linkedByStore.get(r.store.id) || [],
          now: importedAt,
        });
      });
      const commissionRows = outcomes.map(outcome => outcome.row).filter(Boolean);
      if (commissionRows.length) {
        const { error: commissionError } = await supabase.from('omg_store_commission_months')
          .upsert(commissionRows, { onConflict: 'store_id,period_month' });
        if (commissionError) throw commissionError;
      }
      const finalized = outcomes.filter(outcome => outcome.kind === 'finalized').length;
      const baselines = outcomes.filter(outcome => outcome.kind === 'baseline').length;
      const held = outcomes.filter(outcome => outcome.kind === 'held').length;
      const heldResult = await supabase.from('omg_store_commission_months').select('id', { count: 'exact', head: true }).eq('status', 'held');
      if (!heldResult.error) setHeldCount(heldResult.count || 0);
      const summary = [
        `${finalized} commission month${finalized === 1 ? '' : 's'} finalized`,
        baselines ? `${baselines} baseline${baselines === 1 ? '' : 's'} saved` : '',
        held ? `${held} held for review` : '',
      ].filter(Boolean).join(' · ');
      notify?.(`Imported ${payload.length} OMG profit snapshot${payload.length === 1 ? '' : 's'} for ${period} · ${summary}`);
      setRows([]); setFileName(''); setOpen(false);
    } catch (error) { notify?.(`OMG profit import failed: ${error.message}`, 'error'); }
    finally { setBusy(false); }
  };

  const downloadTemplate = () => {
    const header = ['Store Code', 'Store Name', 'Products', 'Collected', 'Cost', 'Profit', 'Margin', 'Refunds', 'OMG Fees', 'Processing Fees', 'Invoiced Fees', 'Net Profit'];
    const csvRows = stores.filter(s => s._omg_sale_code && s.channel_type === '24/7').map(s => [s._omg_sale_code, s.store_name || '', '', '', '', '', '', '', '', '', '', '']);
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
