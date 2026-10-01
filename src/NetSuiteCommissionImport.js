import React, { useRef, useState } from 'react';
import { buildNetSuiteInvoices } from './lib/netsuiteCommissions';

const money = n => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const repKey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Invoice IDs are global across reps/months. Replace matching invoices on re-import,
// including corrected rep/payment dates, and retain every unrelated invoice.
export function mergeNetSuiteImport(current, invoices, mapping, { replaceManual = false, fileName = '', user = '', at = new Date().toISOString() } = {}) {
  const next = { ...current };
  const ids = new Set(invoices.map(i => i.id));
  Object.entries(current).forEach(([id, c]) => {
    if (Object.keys(c.nsInvoices || {}).some(key => ids.has(key))) {
      next[id] = { ...c, nsInvoices: Object.fromEntries(Object.entries(c.nsInvoices).filter(([key]) => !ids.has(key))) };
    }
  });
  invoices.forEach(invoice => {
    const id = mapping[invoice.repName];
    if (!id) throw new Error('Choose a portal rep for ' + invoice.repName);
    const cur = next[id] || {};
    const nsComm = { ...(cur.nsComm || {}) };
    if (replaceManual) delete nsComm[invoice.month];
    next[id] = { ...cur, nsComm, nsInvoices: { ...(cur.nsInvoices || {}), [invoice.id]: { ...invoice, fileName, importedAt: at, importedBy: user } } };
  });
  return next;
}

export function NetSuiteInvoiceTable({ invoices, onRemove, disabled = false }) {
  if (!invoices.length) return null;
  return <div className="card" style={{ marginTop: 16 }}>
    <div className="card-header"><h2>NetSuite invoices</h2></div>
    <div className="card-body" style={{ overflowX: 'auto' }}>
      <p style={{ fontSize: 12, color: '#64748b' }}>Gross profit = invoice amount − PO cost. Commission is 30% of gross profit through day 90, and 15% from day 91. Invoice and PO amounts are line totals, not unit prices.</p>
      <table style={{ fontSize: 12 }}><thead><tr>
        <th>Invoice / customer</th><th>Invoiced</th><th>Fully paid</th><th>Days</th><th>Revenue</th><th>PO cost</th><th>Gross profit</th><th>Margin</th><th>Rate</th><th>Commission</th>{onRemove && <th />}
      </tr></thead><tbody>{invoices.map(i => <tr key={i.id} style={{ background: i.daysToPay > 90 ? '#eff6ff' : undefined }}>
        <td><details><summary style={{ cursor: 'pointer' }}><strong>{i.id}</strong> · {i.customer}</summary><div>{i.soNumber} · {i.repName}</div><ul>{i.items.map((item, index) => <li key={index}>{item.item} · qty {item.quantity} · {money(item.revenue)} revenue · {money(item.cost)} cost · {item.poNumber}</li>)}</ul></details></td>
        <td>{i.invoiceDate}</td><td>{i.paidDate}</td><td>{i.daysToPay}</td><td>{money(i.revenue)}</td><td>{money(i.cost)}</td><td>{money(i.gp)}</td><td>{i.marginPct == null ? '—' : i.marginPct.toFixed(2) + '%'}</td><td>{Math.round(i.rate * 100)}%</td><td style={{ fontWeight: 700 }}>{money(i.commission)}</td>
        {onRemove && <td><button className="btn btn-sm btn-secondary" disabled={disabled} onClick={() => onRemove(i)}>Remove</button></td>}
      </tr>)}</tbody></table>
    </div>
  </div>;
}

export default function NetSuiteCommissionImport({ reps, repComp, onSave, currentUser, disabled }) {
  const input = useRef(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [manualChoice, setManualChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const parse = async file => {
    if (!file) return;
    setBusy(true);setMessage('');setPreview(null);setManualChoice('');
    try {
      let rows;
      if (/\.csv$/i.test(file.name)) {
        const Papa = await import('papaparse');
        const parsed = Papa.parse(await file.text(), { header: true, skipEmptyLines: 'greedy', transformHeader: h => h.replace(/^\uFEFF/, '').trim() });
        if (parsed.errors.length) throw new Error(parsed.errors[0].message);
        rows = parsed.data;
      } else {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
        if (wb.SheetNames.length !== 1) throw new Error('Use a report with one worksheet, or export the commission sheet as CSV.');
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/^\uFEFF/, '').trim(), v])));
      }
      const result = buildNetSuiteInvoices(rows);
      const matched = {};
      result.invoices.forEach(i => {
        const matches = reps.filter(r => repKey(r.name) === repKey(i.repName));
        matched[i.repName] = matches.length === 1 ? matches[0].id : '';
      });
      setMapping(matched);
      setPreview({ ...result, fileName: file.name });
    } catch (e) { setMessage('Could not read report: ' + e.message); }
    finally { setBusy(false);if (input.current) input.current.value = ''; }
  };
  const invoices = preview?.invoices || [];
  const affected = [...new Set(invoices.map(i => JSON.stringify([mapping[i.repName], i.month])))].map(v => JSON.parse(v));
  const manual = affected.filter(([id, month]) => Number(repComp?.[id]?.nsComm?.[month] || 0) !== 0);
  const existing = new Set(Object.values(repComp || {}).flatMap(c => Object.keys(c.nsInvoices || {})));
  const updateCount = invoices.filter(i => existing.has(i.id)).length;
  const invalid = !invoices.length || preview?.errors.length || invoices.some(i => !mapping[i.repName]) || (manual.length > 0 && !manualChoice);
  const save = async () => {
    if (busy || disabled || invalid) return;
    setBusy(true);setMessage('');
    try {
      const ok = await onSave(current => mergeNetSuiteImport(current, invoices, mapping, { replaceManual: manualChoice === 'replace', fileName: preview.fileName, user: currentUser?.name || '' }));
      if (ok) { setPreview(null);setMessage('Imported ' + invoices.length + ' NetSuite invoices. Commissions are included in their full-payment months.'); }
      else setMessage('The import was not saved. Review the error and retry.');
    } catch (e) { setMessage('Import failed: ' + e.message); }
    finally { setBusy(false); }
  };
  return <div style={{ margin: '12px 0' }}>
    <input ref={input} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={e => parse(e.target.files[0])} />
    <button className="btn btn-sm btn-secondary" disabled={disabled || busy} onClick={() => input.current?.click()}>{busy ? 'Processing…' : 'Import NetSuite commissions…'}</button>
    {message && !preview && <div role="status" style={{ marginTop: 8 }}>{message}</div>}
    {preview && <div role="dialog" aria-label="Review NetSuite commissions" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 1200, maxWidth: '96vw', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
        <h2>Review NetSuite commissions</h2><p>{preview.fileName} · {invoices.length} invoices · {updateCount} replace existing imports · {money(invoices.reduce((a, i) => a + i.commission, 0))} commission</p>
        <p>Invoices go into the month of full payment. Re-imports replace the matching invoice, including its rep and payment month; other invoices stay unchanged. Costs use only the PO amounts in this report.</p>
        {!!preview.errors.length && <div role="alert" style={{ color: '#991b1b' }}><strong>Fix these source rows before importing:</strong><ul>{preview.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
        {!invoices.length && !preview.errors.length && <p>No paid invoices found.</p>}
        {Object.keys(mapping).map(name => <label key={name} style={{ display: 'block', margin: '8px 0' }}>{name} → <select aria-label={'Portal rep for ' + name} value={mapping[name]} disabled={busy} onChange={e => { setMapping(m => ({ ...m, [name]: e.target.value }));setManualChoice(''); }}><option value="">Choose portal rep</option>{reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>)}
        {!!manual.length && <div style={{ padding: 12, background: '#fffbeb' }}>
          <p>These months already have manual NetSuite commission amounts: {manual.map(([id, month]) => (reps.find(r => r.id === id)?.name || id) + ' ' + month + ' ' + money(repComp[id].nsComm[month])).join('; ')}. Choose how to avoid counting the same commission twice.</p>
          <label style={{ display: 'block' }}><input type="radio" name="ns-manual" disabled={busy} checked={manualChoice === 'replace'} onChange={() => setManualChoice('replace')} /> Replace those manual amounts with the imported invoices (use when this report covers those amounts).</label>
          <label style={{ display: 'block' }}><input type="radio" name="ns-manual" disabled={busy} checked={manualChoice === 'keep'} onChange={() => setManualChoice('keep')} /> Keep manual amounts as additional commission for invoices outside this report.</label>
        </div>}
        <NetSuiteInvoiceTable invoices={invoices} />
        {message && <div role="alert">{message}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}><button className="btn btn-secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel</button><button className="btn btn-primary" disabled={disabled || busy || !!invalid} onClick={save}>{busy ? 'Saving…' : 'Import invoices'}</button></div>
      </div>
    </div>}
  </div>;
}
