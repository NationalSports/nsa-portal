import React from 'react';
import { garmentMockKey, safeItems, safeNum, safeJobs, safeArt, jobItemDecosOfKind, jobShippedSizes, shippedSizesByLine } from './safeHelpers';

export function garmentProgress(job, order, rows) {
  const scoped = { ...job, items: (job.items || []).map(row => ({ ...row, sku: safeItems(order)[row.item_idx]?.sku || row.sku, color: safeItems(order)[row.item_idx]?.color || row.color })) };
  const shipped = jobShippedSizes(scoped, safeJobs(order), shippedSizesByLine(order._shipments));
  const groups = new Map();
  rows.forEach((row, index) => {
    const item = safeItems(order)[row.item_idx] || row;
    const key = garmentMockKey(item);
    if (!groups.has(key)) groups.set(key, { key, item, sizes: {}, received: {}, shipped: {}, lines: new Set(), specs: new Set() });
    const g = groups.get(key);
    ['art', 'numbers', 'names'].forEach(kind => jobItemDecosOfKind(row, item, kind).forEach(d => {
      const art = safeArt(order).find(a => a.id === d.art_file_id);
      const colors = Object.values(art?.garment_colors?.[key] || {}).flat().filter(Boolean).join(', ') || art?.ink_colors || art?.thread_colors;
      g.specs.add([art?.name || kind, (art?.deco_type || d.num_method || d.type || '').replace(/_/g, ' '), d.position, art?.art_size || d.num_size, colors].filter(Boolean).join(' · '));
    }));
    // A line can appear twice for two decorations, but it is one physical garment.
    if (g.lines.has(row.item_idx)) return;
    g.lines.add(row.item_idx);
    Object.entries(row.sizes || {}).forEach(([size, value]) => {
      const qty = Math.max(0, safeNum(value));
      g.sizes[size] = (g.sizes[size] || 0) + qty;
      g.received[size] = (g.received[size] || 0) + Math.min(qty, Math.max(0, safeNum(row.fulSizes?.[size])));
      // Shipment coverage is SKU/color-wide. Do not count it again for price-split lines.
      g.shipped[size] = Math.max(g.shipped[size] || 0, safeNum(shipped[index]?.[size]));
    });
  });
  return [...groups.values()].map(g => ({ ...g,
    total: Object.values(g.sizes).reduce((a, n) => a + n, 0),
    receivedTotal: Object.values(g.received).reduce((a, n) => a + n, 0),
    shippedTotal: Object.entries(g.sizes).reduce((a, [s, n]) => a + Math.min(n, g.shipped[s] || 0), 0),
  }));
}

export default function JobGarmentProgress({ summary, onViewItem }) {
  if (!summary) return null;
  const sizes = Object.entries(summary.sizes).filter(([, n]) => n > 0);
  const order = ['YXS','YS','YM','YL','YXL','XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL'];
  sizes.sort(([a], [b]) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)));
  return <><div aria-label="Garment quantities and progress" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '12px 4px', fontSize: 12, borderBottom: '1px solid #e2e8f0' }}>
    <strong>QTY {summary.total}</strong>
    <span style={{ flex: 1, minWidth: 120, color: '#475569' }}>{sizes.map(([s, n]) => s + ' ' + n).join(' · ')}</span>
    <span style={{ color: summary.receivedTotal >= summary.total ? '#166534' : '#92400e' }}>Received <strong>{summary.receivedTotal}/{summary.total}</strong></span>
    <span style={{ color: summary.shippedTotal >= summary.total ? '#166534' : '#475569' }}>Shipped <strong>{summary.shippedTotal}/{summary.total}</strong></span>
    {onViewItem && <button type="button" className="btn btn-sm btn-secondary" onClick={() => onViewItem([...summary.lines][0])} title="Open the garment line on this sales order">SO →</button>}
  </div>{summary.specs.size > 0 && <details style={{ fontSize: 11, color: '#475569', padding: '8px 4px' }}><summary style={{ cursor: 'pointer' }}>Decoration details</summary>{[...summary.specs].map(s => <p key={s}>{s}</p>)}</details>}</>;
}
