import React, { useEffect, useState } from 'react';
import { inventoryCostIssues, inventoryPickCosts } from '../lib/inventoryCosts';
import { supabase } from '../lib/supabase';
export default function InventoryCostDetails({ order }) {
  const issues = inventoryCostIssues(order); const [receipts, setReceipts] = useState([]);
  const rows = (order?.items || []).flatMap((it) => {
    const p = inventoryPickCosts(it);
    return [...(p.qty ? [{ name: `${it.name || it.sku} · garment stock`, qty: p.qty, cost: p.cost, ids: p.receipts, missing: p.missing }] : []), ...(it.decorations || []).filter((d) => d.inventory_cost_basis?.length).map((d) => ({ name: `${it.name || it.sku} · ${d.transfer_code}`, qty: d.inventory_cost_basis.reduce((a, b) => a + b.qty, 0), cost: d.inventory_cost_basis.reduce((a, b) => a + b.qty * (b.unit_cost || 0), 0), missing: d.inventory_cost_missing, estimated: d.inventory_cost_basis.some((b) => !b.received), ids: d.inventory_cost_basis.flatMap((b) => b.receipt_ids || []) }))];
  });
  const ids = [...new Set(rows.flatMap((r) => r.ids))].sort().join(',');
  useEffect(() => { let live = true; if (!ids) { setReceipts([]); return; } supabase.from('store_inventory_receipts').select('id,purchase_order_lines(purchase_orders(po_number))').in('id', ids.split(',')).then(({ data }) => { if (live) setReceipts(data || []); }); return () => { live = false; }; }, [ids]);
  if (!rows.length && !issues.length) return null;
  return <section style={{ padding: 14, background: '#f8fafc', borderRadius: 10, marginBottom: 16 }}><h3>Stock used by this order</h3>{issues.length > 0 && <div role="alert" style={{ color: '#b91c1c' }}><b>Margin is incomplete until missing inventory costs are recorded.</b><ul>{issues.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}<p style={{ fontSize: 12 }}>These costs are included in the order, not added a second time. Pending decoration usage uses the current stock estimate; consumed stock keeps its recorded cost.</p>{rows.map((r, i) => <div key={i} style={{ padding: '8px 0', borderTop: '1px solid #e2e8f0' }}><b>{r.name}</b> · {r.qty} units · {r.missing ? 'Cost needed' : `$${r.cost.toFixed(2)}${r.estimated ? ' estimated' : ''}`}<div style={{ fontSize: 12 }}>{[...new Set(r.ids.map((id) => receipts.find((x) => x.id === id)?.purchase_order_lines?.purchase_orders?.po_number).filter(Boolean))].join(', ') || 'Opening stock cost'}</div></div>)}</section>;
}

export function InventoryCostWarning({ orders = [] }) {
  const incomplete = [...new Map(orders.filter(Boolean).filter((o) => inventoryCostIssues(o).length).map((o) => [o.id, o])).values()];
  if (!incomplete.length) return null;
  return <div role="alert" style={{ padding: 14, marginBottom: 16, background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, color: '#9a3412' }}><b>Inventory costs need attention.</b> Margin and commission figures are provisional for {incomplete.map((o) => o.id).join(', ')}. Open each order’s Costs tab to review the missing stock costs.</div>;
}
