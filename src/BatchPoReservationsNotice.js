import React from 'react';

export default function BatchPoReservationsNotice({ items, onManageBatch }) {
  if (!items.length) return null;
  return <div style={{ padding: 12, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, marginBottom: 12 }}>
    <strong style={{ color: '#6d28d9' }}>Already in a batch — ordering locked</strong>
    <div style={{ fontSize: 12, color: '#475569', margin: '5px 0 8px' }}>Remove these items from Batch POs before ordering them on an independent PO or adding them to another batch.</div>
    {items.map(({ item, reservations }) => <div key={item._idx} style={{ padding: '7px 0', borderTop: '1px solid #ddd6fe', fontSize: 12 }}>
      <strong>{item.sku} · {item.name}</strong>{item.color && <span> — {item.color}</span>}
      {reservations.map(batch => <div key={batch.id} style={{ color: '#6d28d9', marginTop: 3 }}>
        Queued in {batch.vendorName || 'vendor'} batch · {batch.poId} · {Object.entries(batch.sizes).filter(([, value]) => value > 0).map(([size, value]) => size + ': ' + value).join(', ')}
      </div>)}
    </div>)}
    {onManageBatch && <button type="button" className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={onManageBatch}>Manage / remove from batch →</button>}
  </div>;
}
