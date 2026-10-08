import React from 'react';

export default function ArtworkReadiness({ error, loading, expanded = false, onReview }) {
  const label = loading ? 'Artwork: checking…' : error ? 'Artwork: needs setup' : 'Artwork: ready';
  if (!expanded) return <button type="button" onClick={onReview} className="btn btn-sm btn-secondary"
    title="Review artwork and production setup before launch" style={{ fontSize: 11, color: error ? '#92400e' : '#166534' }}>{label}</button>;
  return <section aria-label="Artwork readiness" style={{ marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
    <strong>{label}</strong>
    <p style={{ fontSize: 12 }}>{loading ? 'Checking catalog…' : error || 'Active offerings have their mockups and decoration setup ready.'}</p>
    <p style={{ fontSize: 12, marginBottom: 0 }}>Stock on hand is not required. You can order blanks and decorations as orders arrive. Transfer, twill and patch designs need a saved production setup in Inventory, even with zero on hand. Embroidery needs its DST file; personalization needs its production templates.</p>
  </section>;
}
