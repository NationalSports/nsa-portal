import { hasSchoolMockup, methodSetupError } from './methodReadiness.shared';
import React, { useState } from 'react';
import { frontArt, logoOptionsForItem } from './adminHelpers';
import ProductionSetupReview from './ProductionSetupReview';

// Sits right above the garment preview: one tile per logo choice, so the rep can see every
// choice and jump to the one to adjust. Keeps the same garment color when switching.
// With onUpdate it also carries the current choice's controls (rename, show first,
// hide/show) — the same for team and 24/7 stores — and onRemove puts an × on each tile.
// productionSetup (24/7) adds the launch-requirements review for the current choice.
export function LogoChoiceSwitcher({ item, catalog = [], onEdit, onUpdate, onSetFirst, onRemove, firstLogoByStyle = {}, productionSetup = false, transfers = [], art = [], stockByWp = {}, staffId, onSaveItem }) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(null);
  const [message, setMessage] = useState('');
  const [reviewItem, setReviewItem] = useState(null);
  const choices = logoOptionsForItem(catalog, item);
  if (choices.length < 2) return null;
  const current = choices.find(({ colors }) => colors.some((color) => color.id === item.id));
  const defaultChoice = choices.find(({ key, colors }) => key === firstLogoByStyle[item.school_style_group_id] && colors.every((color) => color.active !== false))?.key || choices.find(({ colors }) => colors.some((color) => color.active !== false))?.key;
  const run = async (fn, ok) => { setBusy(true); try { if (await fn()) setMessage(ok); } finally { setBusy(false); } };
  const curLive = current && current.colors.every((color) => color.active !== false);
  const curReady = current && current.colors.every(hasSchoolMockup);
  const curLabel = current?.row.school_design_label || 'Original logo';
  const nameVal = name ?? curLabel;
  const nextReview = productionSetup && current && current.colors.find((color) => methodSetupError(color, transfers, art));
  const sameColorIn = (colors, row) => colors.find((color) => color.product_id && color.product_id === item.product_id) || row;
  const remove = async (choice, label) => {
    if (!window.confirm(`Remove the "${label}" logo choice (${choice.colors.length} color${choice.colors.length === 1 ? '' : 's'}) from this store?`)) return;
    const isCurrent = choice.colors.some((color) => color.id === item.id);
    if (isCurrent) { const other = choices.find((ch) => ch.key !== choice.key); if (other) onEdit?.(sameColorIn(other.colors, other.row).id, 'art'); }
    setBusy(true); try { await onRemove(choice.row); } finally { setBusy(false); }
  };
  return <div style={{ marginBottom: 12 }}>
    <div role="group" aria-label="Logo choices" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Logo choice:</span>
      {choices.map(({ key, row, colors }) => {
        const isCurrent = colors.some((color) => color.id === item.id);
        const target = sameColorIn(colors, row);
        const deco = frontArt(target) || frontArt(row);
        const live = colors.every((color) => color.active !== false);
        const label = row.school_design_label || 'Original logo';
        return <span key={key} style={{ position: 'relative', display: 'inline-flex' }}><button type="button" aria-pressed={isCurrent} title={isCurrent ? `Editing ${label}` : `Edit ${label}`} onClick={() => { if (!isCurrent) { setName(null); setMessage(''); onEdit?.(target.id, 'art'); } }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 4px', borderRadius: 8, cursor: isCurrent ? 'default' : 'pointer', background: isCurrent ? '#eef2ff' : '#fff', border: isCurrent ? '2px solid #4f46e5' : '1px solid #cbd5e1', opacity: live ? 1 : 0.7 }}>
          {deco?.art_url ? <img src={deco.art_url} alt="" style={{ width: 36, height: 28, objectFit: 'contain', background: '#f1f5f9', borderRadius: 5 }} /> : <span style={{ width: 36, height: 28, background: '#f1f5f9', borderRadius: 5 }} />}
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#191919', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          {key === defaultChoice && <span style={{ fontSize: 9.5, fontWeight: 800, color: '#166534' }}>FIRST</span>}
          {!live && <span style={{ fontSize: 9.5, fontWeight: 800, color: '#92400e' }}>HIDDEN</span>}
        </button>
        {onRemove && <button type="button" aria-label={`Remove ${label}`} title={`Remove the ${label} logo choice`} disabled={busy} onClick={() => remove({ key, row, colors }, label)}
          style={{ position: 'absolute', top: -7, right: -7, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#b91c1c', color: '#fff', fontSize: 11, fontWeight: 800, lineHeight: '18px', padding: 0, cursor: busy ? 'wait' : 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }}>×</button>}
        </span>;
      })}
    </div>
    {onUpdate && current && <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8, fontSize: 12 }}>
      <input aria-label="Logo choice name" className="form-input" style={{ width: 190, fontSize: 12 }} maxLength={80} value={nameVal} onChange={(e) => setName(e.target.value)} />
      <button type="button" className="btn btn-sm btn-secondary" disabled={busy || !nameVal.trim() || nameVal.trim() === curLabel} onClick={() => run(() => onUpdate(current.row, { school_design_label: nameVal.trim() }), 'Name saved.').then(() => setName(null))}>Save name</button>
      {current.key === defaultChoice ? <b style={{ color: '#166534' }}>Shows first</b> : <button type="button" className="btn btn-sm btn-secondary" disabled={busy || !curReady || !curLive || !onSetFirst} title={!curLive ? 'Show this choice in the store first' : ''} onClick={() => run(() => onSetFirst(current.row), 'This logo now shows first.')}>Show first</button>}
      <button type="button" className="btn btn-sm btn-secondary" disabled={busy || (!curReady && !curLive)} onClick={() => run(() => onUpdate(current.row, { active: !curLive }), curLive ? 'Hidden from shoppers.' : 'Live for shoppers.')}>{curLive ? 'Hide from store' : 'Show in store'}</button>
      {nextReview && onSaveItem && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setReviewItem(nextReview)}>Launch requirements</button>}
      {message && <span role="status" style={{ color: '#334155' }}>{message}</span>}
    </div>}
    {productionSetup && reviewItem && <div style={{ marginTop: 12 }}><ProductionSetupReview key={reviewItem.id} item={catalog.find((row) => row.id === reviewItem.id) || reviewItem} stock={stockByWp[reviewItem.id]} transfers={transfers} art={art} staffId={staffId} onSave={onSaveItem} onClose={() => setReviewItem(null)} /></div>}
  </div>;
}
