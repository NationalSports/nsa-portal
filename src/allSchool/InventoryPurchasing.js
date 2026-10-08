import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
const money = (v) => v == null ? 'Cost needed' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const blank = () => ({ item: '', size: '', qty: '', cost: '' });
const button = 'btn btn-sm btn-secondary';
export default function InventoryPurchasing({ onReceived, storeId, catalog = [], transfers = [] }) {
  const [pos, setPos] = useState([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false); const [vendor, setVendor] = useState(''); const [lines, setLines] = useState([blank()]);
  const [openingItem, setOpeningItem] = useState(''); const [openingSize, setOpeningSize] = useState(''); const [openingCost, setOpeningCost] = useState(''); const [receipt, setReceipt] = useState(null); const request = useRef(null); const [message, setMessage] = useState('');
  const choices = useMemo(() => {
    const garments = [...new Map(catalog.filter((p) => p.product_id && p.kind !== 'bundle').map((p) => [p.product_id, p])).values()];
    return [...transfers.map((t) => ({ key: `t:${t.id}`, label: t.label || t.code, transfer_id: t.id, cost: t.unit_cost, supplier: t.supplier_id })), ...garments.map((p) => ({ key: `p:${p.id}`, label: p.display_name || p.sku, webstore_product_id: p.id, product_id: p.product_id, sku: p.sku }))];
  }, [catalog, transfers]);
  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('purchase_orders').select('*,purchase_order_lines(*,store_inventory_receipts(*))').eq('all_school_store_id', storeId).eq('origin', 'store_inventory').order('created_at', { ascending: false });
    if (e) setError(e.message); else setPos(data || []);
  }, [storeId]);
  useEffect(() => { load(); }, [load]);
  const update = (i, patch) => { request.current = null; setLines((v) => v.map((l, n) => n === i ? { ...l, ...patch } : l)); };
  const create = async () => {
    setError(''); setBusy(true);
    try {
      const payload = lines.map((l) => {
        const c = choices.find((x) => x.key === l.item);
        if (!c || !Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0 || l.cost === '' || !Number.isFinite(Number(l.cost)) || Number(l.cost) < 0 || (!c.transfer_id && !l.size.trim())) throw new Error('Choose each item and enter its quantity, unit cost, and garment size.');
        return { transfer_id: c.transfer_id, webstore_product_id: c.webstore_product_id, size: l.size.trim(), qty: Number(l.qty), unit_cost_cents: Math.round(Number(l.cost) * 100) };
      });
      if (!vendor.trim()) throw new Error('Enter the supplier name.');
      request.current ||= crypto.randomUUID();
      const { error: e } = await supabase.rpc('create_store_inventory_po', { p_store_id: storeId, p_request_id: request.current, p_vendor: vendor.trim(), p_lines: payload });
      if (e) throw e;
      setOpen(false); setLines([blank()]); setVendor(''); request.current = null; setMessage('Inventory PO created. Download it for your supplier, then receive deliveries here.'); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const receive = async () => {
    setBusy(true); setError('');
    try {
      if (!Number.isInteger(Number(receipt.qty)) || Number(receipt.qty) <= 0 || receipt.cost === '' || !Number.isFinite(Number(receipt.cost)) || Number(receipt.cost) < 0) throw new Error('Enter the quantity received and actual unit cost.');
      const { error: e } = await supabase.rpc('receive_store_inventory_po', { p_line_id: receipt.line.id, p_request_id: receipt.requestId, p_qty: Number(receipt.qty), p_unit_cost: Number(receipt.cost) });
      if (e) throw e;
      setReceipt(null); setMessage('Received into stock at the recorded unit cost.'); await load(); await onReceived?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const setOpening = async () => {
    setError(''); setBusy(true);
    try {
      if (openingCost === '' || !Number.isFinite(Number(openingCost)) || Number(openingCost) < 0) throw new Error('Enter the unit cost of your existing stock.');
      const { error: e } = await supabase.rpc('set_store_opening_inventory_cost', { p_store_id: storeId, p_product_id: receipt?.line.product_id || choices.find(c=>c.key===openingItem)?.product_id, p_size: receipt?.line.size || openingSize.trim(), p_unit_cost: Number(openingCost) });
      if (e) throw e;
      setMessage('Opening garment cost saved. Future stock pulls and receipts will use this cost.'); setOpeningCost('');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const closePo = async (po) => {
    setBusy(true); setError('');
    try { const { error: e } = await supabase.rpc('close_store_inventory_po', { p_po_id: po.id }); if(e) throw e; setMessage('Unreceived balance closed. Received stock is unchanged. Contact the supplier separately if an order was sent.'); await load(); }
    catch(e) { setError(e.message); } finally { setBusy(false); }
  };
  const exportPo = (po) => {
    const escape = (v) => '"' + String(v ?? '').replace(/"/g, '""').replace(/^[=+@-]/, "'") + '"';
    const rows = [['PO', 'Supplier', 'Item', 'SKU', 'Size', 'Quantity', 'Unit cost', 'Line total', 'Decoration type', 'Artwork version', 'Width (in)', 'Height (in)', 'Application instructions', 'Production artwork file'], ...po.purchase_order_lines.map((l) => [po.po_number, po.vendor, l.meta?.label, l.sku, l.size, l.qty, l.unit_cost_cents / 100, l.qty * l.unit_cost_cents / 100, l.meta?.decoration_type, l.meta?.artwork_version, l.meta?.width_in, l.meta?.height_in, l.meta?.application_instructions, l.meta?.production_file?.name])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${po.po_number}-inventory.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return <section className="card" style={{ padding: 20 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><h3 style={{ margin: 0 }}>Inventory purchase orders</h3><button className="btn btn-sm btn-primary" onClick={() => setOpen(!open)}>+ Create inventory PO</button></div>
    <p style={{ color: '#64748b', fontSize: 13 }}>Replenish garments, DTF, twill, and patches. Receive partial deliveries at their actual unit cost, including any allocated freight. Each sales order carries only the stock it uses. POs are saved as drafts for you to send to the supplier.</p>
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}{message && <p role="status" style={{ color: '#166534' }}>{message}</p>}
    {open && <div style={{ background: '#f8fafc', padding: 16, borderRadius: 12 }}><label>Supplier<input className="form-input" value={vendor} onChange={(e) => { request.current = null; setVendor(e.target.value); }} placeholder="Supplier name" /></label>
      {lines.map((l, i) => <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'end' }}><label style={{ flex: '2 1 240px' }}>Stock item<select className="form-input" value={l.item} onChange={(e) => { const c = choices.find((x) => x.key === e.target.value); update(i, { item: e.target.value, size: '', cost: c?.cost == null ? '' : String(c.cost) }); }}><option value="">Choose artwork or garment…</option>{choices.map((c) => <option key={c.key} value={c.key}>{c.transfer_id ? 'Artwork · ' : 'Garment · '}{c.label}{c.sku ? ` · ${c.sku}` : ''}</option>)}</select></label>
        {!l.item.startsWith('t:') && <label>Size<input className="form-input" style={{ width: 90 }} value={l.size} onChange={(e) => update(i, { size: e.target.value })} placeholder="e.g. XL" /></label>}
        <label>Quantity<input className="form-input" style={{ width: 100 }} type="number" min="1" step="1" value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} /></label><label>Unit cost ($)<input className="form-input" style={{ width: 110 }} type="number" min="0" step="0.01" value={l.cost} onChange={(e) => update(i, { cost: e.target.value })} /></label><button className={button} disabled={lines.length === 1} onClick={() => { request.current = null; setLines(lines.filter((_, n) => n !== i)); }}>Remove</button></div>)}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}><button className={button} onClick={() => { request.current = null; setLines([...lines, blank()]); }}>+ Add stock item</button><button className="btn btn-sm btn-primary" disabled={busy} onClick={create}>{busy ? 'Saving…' : 'Create draft PO'}</button><button className={button} onClick={() => setOpen(false)}>Cancel</button></div></div>}
    {!receipt && <details style={{ marginTop: 16 }}><summary>Set cost for garments already in stock</summary><p style={{ fontSize: 13 }}>Record the cost paid for existing stock before its first receipt or warehouse pull. Decoration costs can be entered in the decoration inventory below.</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}><label>Garment<select className="form-input" value={openingItem} onChange={(e)=>setOpeningItem(e.target.value)}><option value="">Choose garment…</option>{choices.filter(c=>c.product_id).map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></label><label>Size<input className="form-input" value={openingSize} onChange={(e)=>setOpeningSize(e.target.value)} /></label><label>Opening unit cost ($)<input className="form-input" type="number" min="0" step="0.01" value={openingCost} onChange={(e)=>setOpeningCost(e.target.value)} /></label><button className={button} disabled={busy||!openingItem||!openingSize} onClick={setOpening}>Save opening cost</button></div></details>}
    {pos.length === 0 && <p style={{ color: '#64748b' }}>No inventory POs yet.</p>}
    {pos.map((po) => <details key={po.id} style={{ marginTop: 14, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}><summary style={{ cursor: 'pointer', fontWeight: 700 }}>{po.po_number} · {po.vendor} · {money(po.totals_cents / 100)} · {po.submission_state?.replace('inventory_', '').replace('_', ' ')}</summary><button className={button} style={{ margin: '12px 0' }} onClick={() => exportPo(po)}>Download supplier PO</button>{po.status!=='cancelled'&&po.submission_state!=='inventory_received'&&<button className={button} style={{marginLeft:8}} disabled={busy} onClick={()=>closePo(po)}>Close unreceived balance</button>}
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>Stock item</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Cost</th><th /></tr></thead><tbody>{po.purchase_order_lines.map((l) => { const received = (l.store_inventory_receipts || []).reduce((a, r) => a + r.qty, 0); return <tr key={l.id}><td style={{ padding: '10px 0' }}>{l.meta?.label || l.sku}{l.size && ` · ${l.size}`}</td><td>{l.qty}</td><td>{received}</td><td>{l.qty - received}</td><td>{money(l.unit_cost_cents / 100)}</td><td>{l.qty > received && po.status !== 'cancelled' && <button className={button} onClick={() => setReceipt({ line: l, qty: String(l.qty - received), cost: String(l.unit_cost_cents / 100), requestId: crypto.randomUUID() })}>Receive delivery</button>}</td></tr>; })}</tbody></table></div>
      {po.purchase_order_lines.flatMap((l) => (l.store_inventory_receipts || []).map((r) => <p key={r.id} style={{ fontSize: 12, color: '#64748b' }}>Received {r.qty} × {l.meta?.label || l.sku} {l.size || ''} at {money(r.unit_cost)} each · {new Date(r.created_at).toLocaleDateString()}</p>))}</details>)}
    {receipt && <div role="dialog" aria-label="Receive inventory delivery" style={{ background: '#eff6ff', padding: 20, marginTop: 16, borderRadius: 12 }}><h4>Receive {receipt.line.meta?.label || receipt.line.sku} {receipt.line.size}</h4>{receipt.line.product_id && <details style={{ marginBottom: 12 }}><summary>Existing garment stock has no cost?</summary><p>Enter the cost per unit of the stock already on the shelf. This is required only before the first costed receipt.</p><label>Opening stock unit cost ($)<input className="form-input" type="number" min="0" step="0.01" value={openingCost} onChange={(e) => setOpeningCost(e.target.value)} /></label><button className={button} disabled={busy} onClick={setOpening}>Save opening cost</button></details>}<label>Quantity received<input className="form-input" type="number" min="1" value={receipt.qty} onChange={(e) => setReceipt({ ...receipt, qty: e.target.value, requestId: crypto.randomUUID() })} /></label><label>Actual unit cost, including allocated freight ($)<input className="form-input" type="number" min="0" step="0.0001" value={receipt.cost} onChange={(e) => setReceipt({ ...receipt, cost: e.target.value, requestId: crypto.randomUUID() })} /></label><div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button className="btn btn-sm btn-primary" disabled={busy} onClick={receive}>Receive into inventory</button><button className={button} disabled={busy} onClick={() => setReceipt(null)}>Cancel</button></div></div>}
  </section>;
}
