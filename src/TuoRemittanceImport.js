import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import { parseTuoRemittance, allocateFees, suggestCustomers, tuoStoreKey } from './lib/tuoRemittance';

const money = n => {
  const value = Number(n) || 0;
  const body = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `($${body})` : `$${body}`;
};
const moneyColor = n => ((Number(n) || 0) < 0 ? '#b91c1c' : '#0f172a');
const shortDate = iso => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : (iso || '—');
};

const REM_COLS = 'id,remittance_key,remittance_no,date_created,total_orders,item_qty_total,items_ordered,shipping,sales_tax,total_collected,cc_fees,tuo_fees,total_fees,remittance_amount,collected_drift,source_file,imported_at';
const LINE_COLS = 'id,line_no,store_type,store_name,store_key,customer_id,billed,free,assessed';

/**
 * TUO Store Remittance import.
 *
 * Unlike the OMG deposit statement, TUO prints no store code — only a name. So
 * rows are never auto-matched on name: a person confirms which customer a store
 * name belongs to once, that decision is stored in tuo_store_map, and every
 * later remittance reuses it. Rows for a store nobody has mapped yet are still
 * imported; they wait, and adopt the customer the moment it is confirmed.
 *
 * Per-store NET is not shown as money received, because the report does not
 * contain one — fees are charged on the statement. The pro-rata column is
 * labelled an estimate and excluded from any total.
 */
export default function TuoRemittanceImport({ customers = [], currentUser, notify, extractPdfText }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState('');
  const [picks, setPicks] = useState({});          // store_key -> customer_id chosen in the preview
  const [knownMap, setKnownMap] = useState({});    // store_key -> customer_id already confirmed
  const [remittances, setRemittances] = useState([]);
  const [unmapped, setUnmapped] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedLines, setExpandedLines] = useState([]);
  const fileRef = useRef(null);

  const customerById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
  const sortedCustomers = useMemo(
    () => [...customers].filter(c => c && c.id && c.name).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [customers]);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const [remResult, unmappedResult] = await Promise.all([
      supabase.from('tuo_remittances').select(REM_COLS).order('date_created', { ascending: false }).limit(12),
      supabase.from('tuo_remittance_lines').select('store_key,store_name,assessed').is('customer_id', null),
    ]);
    if (!remResult.error) setRemittances(remResult.data || []);
    if (!unmappedResult.error) {
      // Group the parked rows by store name — one decision clears all of them.
      const byKey = new Map();
      (unmappedResult.data || []).forEach(row => {
        const entry = byKey.get(row.store_key) || { store_key: row.store_key, store_name: row.store_name, rows: 0, assessed: 0 };
        entry.rows += 1;
        entry.assessed = Math.round((entry.assessed + (Number(row.assessed) || 0)) * 100) / 100;
        byKey.set(row.store_key, entry);
      });
      setUnmapped([...byKey.values()].sort((a, b) => b.assessed - a.assessed));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const readFile = async file => {
    if (!file) return;
    if (!extractPdfText) return notify?.('PDF reading is unavailable here', 'error');
    if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''))) {
      return notify?.('Drop the TUO Store Remittance Report PDF', 'error');
    }
    setBusy(true);
    try {
      const { fullText } = await extractPdfText(file);
      const result = parseTuoRemittance(fullText);
      setParsed(result);
      setFileName(file.name || 'TUO Store Remittance Report');
      setPicks({});
      // Which of these store names has someone already decided?
      const keys = [...new Set(result.lines.map(l => tuoStoreKey(l.storeName)))];
      if (keys.length && supabase) {
        const { data, error } = await supabase.from('tuo_store_map').select('store_key,customer_id').in('store_key', keys);
        if (!error) setKnownMap(Object.fromEntries((data || []).map(r => [r.store_key, r.customer_id])));
      }
      if (result.problems.length) notify?.(`Report read with ${result.problems.length} problem(s) — review below`, 'error');
      else notify?.(`Read ${result.lines.length} stores · remitting ${money(result.remittanceAmount)}`);
    } catch (error) {
      notify?.(`Could not read the remittance: ${error.message}`, 'error');
      setParsed(null);
    } finally { setBusy(false); }
  };

  // One preview row per store line, with whatever customer is known or suggested.
  const preview = useMemo(() => {
    if (!parsed) return [];
    return allocateFees(parsed.lines, parsed.totalFees).map(line => {
      const key = tuoStoreKey(line.storeName);
      const confirmed = knownMap[key] || null;
      const suggestions = confirmed ? [] : suggestCustomers(line.storeName, customers, 3);
      const exact = suggestions.find(s => s.exact) || null;
      return { ...line, key, confirmed, suggestions, exact, chosen: picks[key] ?? confirmed ?? (exact ? exact.customer.id : '') };
    });
  }, [parsed, knownMap, picks, customers]);

  const newDecisions = preview.filter(r => r.chosen && r.chosen !== r.confirmed);
  const stillUnmapped = preview.filter(r => !r.chosen);
  const existing = parsed ? remittances.find(r => r.remittance_key === parsed.remittanceKey) : null;

  const saveMapping = async (storeKey, storeName, customerId) => {
    const { error } = await supabase.rpc('tuo_map_store', {
      p_store_key: storeKey, p_store_name: storeName, p_customer_id: customerId,
    });
    if (error) throw error;
  };

  const importReport = async () => {
    if (!supabase) return notify?.('Supabase is not connected', 'error');
    if (!parsed || parsed.problems.length) return notify?.('Fix the report problems before importing', 'error');
    setBusy(true);
    try {
      // Mappings first: the import trigger then links every row on insert, and
      // tuo_map_store also adopts rows parked by earlier remittances.
      const decisions = [...new Map(newDecisions.map(r => [r.key, r])).values()];
      for (const row of decisions) await saveMapping(row.key, row.storeName, row.chosen);

      const { error } = await supabase.rpc('tuo_import_remittance', {
        p_remittance: {
          remittance_key: parsed.remittanceKey,
          remittance_no: parsed.remittanceNo || '',
          date_created: parsed.dateCreated,
          total_orders: parsed.totalOrders,
          item_qty_total: parsed.itemQtyTotal,
          items_ordered: parsed.itemsOrdered,
          fundraiser_tax: parsed.fundraiserTax,
          fundraisers: parsed.fundraisers,
          shipping: parsed.shipping,
          bulk_fee: parsed.bulkFee,
          handling: parsed.handling,
          sales_tax: parsed.salesTax,
          store_discounts: parsed.storeDiscounts,
          total_billed: parsed.totalBilled,
          total_collected: parsed.totalCollected,
          cc_fees: parsed.ccFees,
          tuo_fees: parsed.tuoFees,
          total_fees: parsed.totalFees,
          total_re_closed: parsed.totalReClosed,
          remittance_amount: parsed.remittanceAmount,
          collected_drift: parsed.collectedDrift,
          source_file: fileName,
          imported_by: currentUser?.id || '',
        },
        p_lines: parsed.lines.map((line, index) => ({
          line_no: index + 1,
          store_type: line.storeType || '',
          store_name: line.storeName,
          billed: line.billed,
          free: line.free,
          assessed: line.assessed,
        })),
      });
      if (error) throw error;

      const parked = stillUnmapped.length;
      notify?.(`TUO remittance ${parsed.remittanceNo || shortDate(parsed.dateCreated)} imported · ${preview.length - parked} store rows on a customer${parked ? ` · ${parked} still need a customer` : ''}`);
      setParsed(null); setFileName(''); setPicks({}); setKnownMap({});
      await refresh();
    } catch (error) {
      notify?.(`TUO import failed: ${error.message}`, 'error');
    } finally { setBusy(false); }
  };

  const resolveParked = async (entry, customerId) => {
    if (!customerId) return;
    setBusy(true);
    try {
      await saveMapping(entry.store_key, entry.store_name, customerId);
      notify?.(`${entry.store_name} → ${customerById.get(customerId)?.name || 'customer'} · ${entry.rows} row(s) applied`);
      await refresh();
    } catch (error) {
      notify?.(`Could not save that mapping: ${error.message}`, 'error');
    } finally { setBusy(false); }
  };

  const toggleExpand = async remittance => {
    if (expandedId === remittance.id) { setExpandedId(null); setExpandedLines([]); return; }
    setExpandedId(remittance.id); setExpandedLines([]);
    const { data, error } = await supabase.from('tuo_remittance_lines').select(LINE_COLS).eq('remittance_id', remittance.id).order('line_no');
    if (!error) setExpandedLines(data || []);
  };

  const latest = remittances[0] || null;
  const parkedRows = unmapped.reduce((total, e) => total + e.rows, 0);

  const customerSelect = (value, onChange, key) => (
    <select value={value || ''} onChange={e => onChange(e.target.value)} key={key}
      style={{ maxWidth: 240, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 5, fontSize: 11.5 }}>
      <option value="">— choose a customer —</option>
      {sortedCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );

  return <div className="card" style={{ marginBottom: 12, border: '1px solid #a5b4fc' }}>
    <div style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#4338ca' }}>TUO Remittances</div>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
            Upload the TUO <b>Store Remittance Report</b> PDF. Each store row is recorded against a customer — you confirm which customer a store name is <b>once</b>, and every later remittance matches it automatically.
          </div>
          <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 4 }}>
            {latest
              ? <>Last report #{latest.remittance_no || '—'} · {shortDate(latest.date_created)} · remitted <b>{money(latest.remittance_amount)}</b></>
              : 'No TUO remittances imported yet.'}
            {parkedRows ? <span style={{ color: '#b45309' }}> · {parkedRows} row{parkedRows === 1 ? '' : 's'} across {unmapped.length} store{unmapped.length === 1 ? '' : 's'} need a customer</span> : null}
          </div>
        </div>
        <button className="btn btn-sm" style={{ background: '#4338ca', color: '#fff' }} onClick={() => setOpen(v => !v)}>{open ? 'Close' : 'Import remittance'}</button>
      </div>

      {open && <div style={{ marginTop: 14, borderTop: '1px solid #e0e7ff', paddingTop: 14 }}>
        <div
          style={{ border: '2px dashed #a5b4fc', borderRadius: 8, padding: 16, textAlign: 'center', cursor: busy ? 'wait' : 'pointer', background: '#eef2ff' }}
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#4338ca'; }}
          onDragLeave={e => { e.currentTarget.style.borderColor = '#a5b4fc'; }}
          onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#a5b4fc'; readFile(e.dataTransfer.files?.[0]); }}
          onClick={() => { if (!busy) fileRef.current?.click(); }}
        >
          <div style={{ fontSize: 24, marginBottom: 4 }}>🧾</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#4338ca' }}>{busy ? 'Working…' : <>Drop the <u>Store Remittance Report</u> PDF here</>}</div>
          <div style={{ fontSize: 11, color: '#4f46e5' }}>click to select · reads every store row and the settlement totals</div>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={e => { readFile(e.target.files?.[0]); e.target.value = ''; }}/>
        </div>

        {parsed && <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', padding: '9px 12px', background: '#f8fafc', borderRadius: 7, fontSize: 11.5 }}>
            <span><b>#{parsed.remittanceNo || 'no number'}</b> · {shortDate(parsed.dateCreated)}</span>
            <span style={{ color: '#64748b' }}>{parsed.totalOrders} orders · {parsed.itemQtyTotal} items</span>
            <span>items <b>{money(parsed.itemsOrdered)}</b></span>
            <span>shipping <b>{money(parsed.shipping)}</b></span>
            <span>tax <b>{money(parsed.salesTax)}</b></span>
            <span>collected <b>{money(parsed.totalCollected)}</b></span>
            <span>fees <b>{money(-parsed.totalFees)}</b></span>
            <span>remitted <b style={{ color: '#4338ca' }}>{money(parsed.remittanceAmount)}</b></span>
          </div>

          {parsed.problems.length > 0 && <div style={{ marginTop: 10, padding: '9px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, fontSize: 11.5, color: '#b91c1c' }}>
            <b>This report did not read cleanly — nothing will be imported.</b>
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>{parsed.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>}

          {parsed.collectedDrift !== 0 && parsed.problems.length === 0 && <div style={{ marginTop: 10, padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 11, color: '#64748b' }}>
            TUO's components (items + shipping + tax) come to {money(parsed.itemsOrdered + parsed.shipping + parsed.salesTax + parsed.fundraiserTax + parsed.fundraisers + parsed.bulkFee + parsed.handling)}, {money(Math.abs(parsed.collectedDrift))} {parsed.collectedDrift > 0 ? 'above' : 'below'} the {money(parsed.totalCollected)} they report collecting. Their rounding — recorded as-is, not corrected.
          </div>}

          {existing && parsed.problems.length === 0 && <div style={{ marginTop: 10, padding: '9px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, fontSize: 11.5, color: '#92400e' }}>
            Already imported on {shortDate(existing.imported_at)}. Importing again replaces its rows — it will not double the money.
          </div>}

          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead><tr style={{ color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #e2e8f0' }}>Type</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #e2e8f0' }}>TUO store</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>Collected</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }} title="Estimate only — TUO charges fees on the statement, not per store">Est. after fees</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #e2e8f0' }}>Customer</th>
              </tr></thead>
              <tbody>{preview.map(row => <tr key={row.lineNo} style={{ borderBottom: '1px solid #f1f5f9', background: row.chosen ? '#fff' : '#fff7ed' }}>
                <td style={{ padding: '7px 8px', color: '#64748b' }}>{row.storeType || '—'}</td>
                <td style={{ padding: '7px 8px' }}>{row.storeName}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700 }}>{money(row.assessed)}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right', color: '#94a3b8' }}>{money(row.estNet)}</td>
                <td style={{ padding: '7px 8px' }}>
                  {row.confirmed
                    ? <span style={{ color: '#166534', fontWeight: 700 }}>✓ {customerById.get(row.confirmed)?.name || row.confirmed}</span>
                    : <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {customerSelect(row.chosen, v => setPicks(p => ({ ...p, [row.key]: v })), row.key)}
                        {row.suggestions.length > 0 && <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {row.suggestions.map(s => <button key={s.customer.id} className="btn btn-sm btn-secondary"
                            onClick={() => setPicks(p => ({ ...p, [row.key]: s.customer.id }))}
                            title={s.exact ? 'Name matches once season/team wording is ignored' : `Partial name match (${Math.round(s.score * 100)}%)`}
                            style={{ fontSize: 10, padding: '2px 6px', borderColor: s.exact ? '#86efac' : '#e2e8f0', background: row.chosen === s.customer.id ? '#dcfce7' : '#fff' }}>
                            {s.exact ? '★ ' : ''}{s.customer.name}
                          </button>)}
                        </div>}
                      </div>}
                </td>
              </tr>)}</tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {newDecisions.length > 0 && <>Confirming {new Set(newDecisions.map(r => r.key)).size} new store mapping{new Set(newDecisions.map(r => r.key)).size === 1 ? '' : 's'} — remembered for every future remittance. </>}
              {stillUnmapped.length > 0
                ? <span style={{ color: '#b45309' }}>{stillUnmapped.length} row{stillUnmapped.length === 1 ? '' : 's'} left without a customer will still be imported and will wait.</span>
                : 'Every store row has a customer.'}
            </span>
            <button className="btn btn-primary" style={{ background: '#4338ca', borderColor: '#4338ca' }} disabled={busy || !!parsed.problems.length} onClick={importReport}>
              {busy ? 'Importing…' : `Import ${preview.length} store row${preview.length === 1 ? '' : 's'}`}
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 10.5, color: '#94a3b8' }}>
            “Est. after fees” is a pro-rata share of TUO's ${' '}{parsed.totalFees.toFixed(2)} statement fees. TUO does not report a per-store net, and this estimate excludes shipping and sales tax, so it does not add up to the remitted amount. Reference only.
          </div>
        </div>}

        {unmapped.length > 0 && <div style={{ marginTop: 16, padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#92400e', marginBottom: 6 }}>Stores waiting for a customer</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <tbody>{unmapped.map(entry => {
              const suggestions = suggestCustomers(entry.store_name, customers, 3);
              return <tr key={entry.store_key} style={{ borderBottom: '1px solid #fef3c7' }}>
                <td style={{ padding: '6px 8px' }}>{entry.store_name}</td>
                <td style={{ padding: '6px 8px', color: '#92400e' }}>{entry.rows} row{entry.rows === 1 ? '' : 's'} · {money(entry.assessed)}</td>
                <td style={{ padding: '6px 8px' }}>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                    {customerSelect('', v => resolveParked(entry, v), `parked-${entry.store_key}`)}
                    {suggestions.map(s => <button key={s.customer.id} className="btn btn-sm btn-secondary" disabled={busy}
                      onClick={() => resolveParked(entry, s.customer.id)}
                      style={{ fontSize: 10, padding: '2px 6px', borderColor: s.exact ? '#86efac' : '#e2e8f0' }}>
                      {s.exact ? '★ ' : ''}{s.customer.name}
                    </button>)}
                  </div>
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>}

        {remittances.length > 0 && <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Imported remittances</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <tbody>{remittances.map(r => <React.Fragment key={r.id}>
              <tr style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }} onClick={() => toggleExpand(r)}>
                <td style={{ padding: '7px 8px', width: 18, color: '#94a3b8' }}>{expandedId === r.id ? '▾' : '▸'}</td>
                <td style={{ padding: '7px 8px', fontWeight: 700 }}>{shortDate(r.date_created)}</td>
                <td style={{ padding: '7px 8px', fontFamily: 'monospace', color: '#64748b' }}>#{r.remittance_no || '—'}</td>
                <td style={{ padding: '7px 8px', color: '#64748b' }}>{r.total_orders} orders</td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{money(r.total_collected)} collected</td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{money(-Math.abs(r.total_fees))} fees</td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 800, color: moneyColor(r.remittance_amount) }}>{money(r.remittance_amount)}</td>
              </tr>
              {expandedId === r.id && <tr><td colSpan={7} style={{ padding: '0 8px 10px 26px', background: '#f8fafc' }}>
                {expandedLines.length === 0 ? <div style={{ padding: '8px 0', color: '#94a3b8' }}>Loading…</div> : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <tbody>{expandedLines.map(line => <tr key={line.id} style={{ borderBottom: '1px solid #eef2f7' }}>
                    <td style={{ padding: '5px 8px', color: '#64748b', width: 70 }}>{line.store_type || '—'}</td>
                    <td style={{ padding: '5px 8px' }}>{line.store_name}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700 }}>{money(line.assessed)}</td>
                    <td style={{ padding: '5px 8px', width: 220, color: line.customer_id ? '#166534' : '#b45309', fontWeight: 700 }}>
                      {line.customer_id ? (customerById.get(line.customer_id)?.name || line.customer_id) : 'Waiting for a customer'}
                    </td>
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
