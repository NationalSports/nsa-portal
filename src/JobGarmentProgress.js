import React from 'react';
import { garmentMockKey, safeItems, safeNum, safeJobs, safeArt, jobItemDecosOfKind, jobShippedSizes, shippedSizesByLine } from './safeHelpers';

export function garmentProgress(job, order, rows) {
  const scoped = { ...job, items: (job.items || []).map(row => ({ ...row, sku: safeItems(order)[row.item_idx]?.sku || row.sku, color: safeItems(order)[row.item_idx]?.color || row.color })) };
  const shipped = jobShippedSizes(scoped, safeJobs(order), shippedSizesByLine(order._shipments));
  const groups = new Map();
  rows.forEach((row, index) => {
    const item = safeItems(order)[row.item_idx] || row;
    const key = garmentMockKey(item);
    if (!groups.has(key)) groups.set(key, { key, item, sizes: {}, received: {}, shipped: {}, lines: new Set(), specs: new Map() });
    const g = groups.get(key);
    ['art', 'numbers', 'names'].forEach(kind => jobItemDecosOfKind(row, item, kind).forEach(d => {
      const art = safeArt(order).find(a => a.id === d.art_file_id);
      const colors = Object.values(art?.garment_colors?.[key] || {}).flat().filter(Boolean).join(', ') || art?.ink_colors || art?.thread_colors;
      const spec = { name: art?.name || (kind === 'numbers' ? 'Numbers' : kind === 'names' ? 'Names' : 'Artwork'),
        method: (art?.deco_type || d.num_method || d.type || '').replace(/_/g, ' '),
        placement: d.position || '', size: art?.art_size || d.num_size || '', colors: colors || '',
        colorLabel: art?.deco_type === 'embroidery' ? 'Thread colors' : 'Colors' };
      g.specs.set(JSON.stringify(spec), spec);
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
    specs: [...g.specs.values()],
    total: Object.values(g.sizes).reduce((a, n) => a + n, 0),
    receivedTotal: Object.values(g.received).reduce((a, n) => a + n, 0),
    shippedTotal: Object.entries(g.sizes).reduce((a, [s, n]) => a + Math.min(n, g.shipped[s] || 0), 0),
  }));
}

export function sizeProgressCell(qty, received, shipped) {
  const total = Math.max(0, safeNum(qty));
  const sent = Math.min(total, Math.max(0, safeNum(shipped)));
  const arrived = Math.min(total, Math.max(sent, safeNum(received)));
  const blue = total ? sent / total * 100 : 0;
  const green = total ? arrived / total * 100 : 0;
  const background = sent === total && total ? '#dbeafe' : arrived === total && !sent && total ? '#dcfce7'
    : !arrived ? '#fef3c7' : `linear-gradient(90deg,#dbeafe 0%,#dbeafe ${blue}%,#dcfce7 ${blue}%,#dcfce7 ${green}%,#fef3c7 ${green}%,#fef3c7 100%)`;
  return { background, color: sent ? '#1e40af' : arrived === total && total ? '#166534' : '#92400e',
    label: sent ? (sent < total ? `${sent}/${total}` : `${total}`) : arrived && arrived < total ? `${arrived}/${total}` : `${total}`,
    status: sent ? (sent === total ? 'Shipped' : 'Part shipped') : arrived === total && total ? 'Received' : arrived ? 'Part received' : 'Waiting',
    title: `QTY ${total} · Received ${Math.min(total, Math.max(0, safeNum(received)))}/${total} · Shipped ${sent}/${total}` };
}

export default function JobGarmentProgress({ summary, onViewItem }) {
  if (!summary) return null;
  const sizes = Object.entries(summary.sizes).filter(([, n]) => n > 0);
  const order = ['YXS','YS','YM','YL','YXL','XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL'];
  sizes.sort(([a], [b]) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)));
  return <><div aria-label="Garment quantities and progress" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '12px 4px', fontSize: 12, borderBottom: '1px solid #e2e8f0' }}>
    <strong>QTY {summary.total}</strong>
    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {sizes.map(([size, qty]) => {
        const cell = sizeProgressCell(qty, summary.received[size], summary.shipped[size]);
        return <div key={size} aria-label={`${size}: ${cell.title}. ${cell.status}`} title={`${size}: ${cell.title}. ${cell.status}`} style={{ width: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 3 }}>{size}</div>
          <div style={{ border: '1px solid #cbd5e1', borderRadius: 4, background: 'white', color: '#0f172a', fontSize: 14, fontWeight: 700, padding: '4px 0' }}>{qty}</div>
          <div style={{ marginTop: 5, borderRadius: 4, padding: '3px 0', fontWeight: 700, background: cell.background, color: cell.color }}>{cell.label}</div>
          <div style={{ fontSize: 8, marginTop: 3, color: '#475569', whiteSpace: 'nowrap' }}>{cell.status}</div>
        </div>;
      })}
    </div>
    <span style={{ color: summary.receivedTotal >= summary.total ? '#166534' : '#92400e' }}>Received <strong>{summary.receivedTotal}/{summary.total}</strong></span>
    <span style={{ color: summary.shippedTotal >= summary.total ? '#166534' : '#475569' }}>Shipped <strong>{summary.shippedTotal}/{summary.total}</strong></span>
    {onViewItem && <button type="button" className="btn btn-sm btn-secondary" onClick={() => onViewItem([...summary.lines][0])} title="Open the garment line on this sales order">SO →</button>}
  </div><GarmentDecorationSpecs specs={Array.from(summary.specs || [])} /></>;
}

export function GarmentDecorationSpecs({ specs }) {
  if (!specs.length) return null;
  return <section aria-label="Decoration details" style={{ marginTop: 10, padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: 'white' }}>
    <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 800, color: '#64748b', marginBottom: 10 }}>Decoration</div>
    {specs.map((spec, index) => <div key={JSON.stringify(spec)} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 24px', ...(index ? { borderTop: '1px solid #eef2f6', paddingTop: 10, marginTop: 10 } : {}) }}>
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', overflowWrap: 'anywhere' }}>{spec.name}</div>
        {spec.method && <span style={{ display: 'inline-block', marginTop: 5, padding: '3px 8px', borderRadius: 4, background: '#eef2ff', color: '#4338ca', fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>{spec.method}</span>}
      </div>
      {[['Placement', spec.placement], ['Art size', spec.size], [spec.colorLabel, spec.colors]].filter(([,value]) => value !== '' && value != null).map(([label,value]) => <div key={label} style={{ maxWidth: '100%' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', overflowWrap: 'anywhere' }}>{value}</div>
      </div>)}
    </div>)}
  </section>;
}
