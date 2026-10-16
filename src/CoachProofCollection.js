import React from 'react';
import { nextPendingCoachProof } from './lib/coachProofCollection';

export default function CoachProofCollection({ orderLabel, entries, activeKey, onSelect, previewFor, busy }) {
  const active = entries.findIndex(entry => entry.key === activeKey);
  const available = entries.filter(entry => entry.canOpen);
  const visibleIndex = available.findIndex(entry => entry.key === activeKey);
  const designs = [...new Map(entries.map(entry => [entry.jobId, entry])).values()];
  const approved = designs.filter(entry => entry.status === 'Approved').length;
  const pending = designs.filter(entry => entry.pending).length;
  const nextPending = nextPendingCoachProof(entries, activeKey, entries[active]?.jobId);
  return <section className="cp-proof-collection" aria-label="Order proof collection">
    <style>{`
      .cp-order-proof-body>div{min-width:0}
      @media(max-width:760px){.cp-order-proof-body{grid-template-columns:minmax(0,1fr)!important;padding:18px 16px 40px!important;gap:16px!important}}
      .cp-proof-collection{max-width:1440px;margin:0 auto;padding:18px 24px 0;color:#2A2F3E;font-family:'Source Sans 3',system-ui,sans-serif}
      .cp-proof-collection-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
      .cp-proof-collection h2{font-family:'Barlow Condensed',sans-serif;font-size:21px;letter-spacing:.5px;text-transform:uppercase;color:#192853;margin:0 0 3px;font-weight:800}
      .cp-proof-collection p{font-size:13px;color:#5A6075;margin:0;line-height:1.5}
      .cp-proof-collection button{font-family:inherit;cursor:pointer}
      .cp-proof-resume{border:1px solid #192853;border-radius:4px;padding:9px 13px;background:#fff;color:#192853;font-weight:700;font-size:13px;min-height:40px}
      .cp-proof-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px}
      .cp-proof-entry{min-width:0;display:grid;grid-template-columns:66px minmax(0,1fr);gap:10px;align-items:center;text-align:left;padding:8px;border:1px solid #D1D5DE;border-radius:6px;background:#fff;color:#192853}
      .cp-proof-entry[aria-current="step"]{border:2px solid #192853;padding:7px;background:#F7F8FB}
      .cp-proof-entry:disabled{cursor:default;background:#F7F8FB;color:#5A6075}
      .cp-proof-thumb{height:64px;display:flex;align-items:center;justify-content:center;border-radius:4px;overflow:hidden;background:#fff;color:#5A6075;font-size:12px}
      .cp-proof-thumb img{width:100%;height:100%;object-fit:contain}
      .cp-proof-entry-copy{display:flex;flex-direction:column;gap:3px;min-width:0;overflow-wrap:anywhere}
      .cp-proof-entry strong{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:16px;text-transform:uppercase;line-height:1.15}
      .cp-proof-entry small{font-size:12px;color:#5A6075;line-height:1.3}
      .cp-proof-entry-status{font-size:12px;font-weight:700;color:#192853}
      .cp-proof-entry[data-status="Approved"] .cp-proof-entry-status{color:#1F7A43}
      .cp-proof-entry[data-status="Changes requested"] .cp-proof-entry-status{color:#962C32}
      .cp-proof-walk{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap}
      .cp-proof-walk button{background:transparent;border:0;color:#192853;padding:8px 0;font-weight:700;font-size:13px;min-height:40px}
      .cp-proof-collection button:disabled{opacity:.6;cursor:default}
      .cp-proof-walk span{font-size:12px;color:#5A6075}
      @media(max-width:600px){.cp-proof-collection{padding:16px 16px 0}.cp-proof-strip{grid-template-columns:1fr 1fr}.cp-proof-entry{grid-template-columns:1fr;gap:6px}.cp-proof-thumb{height:76px}.cp-proof-entry strong{font-size:15px}}
    `}</style>
    <div className="cp-proof-collection-head">
      <div><h2>{orderLabel} · Order art review</h2><p>{designs.length} designs · {entries.length} item mockups · {approved} approved · {pending} awaiting approval</p></div>
      <button type="button" className="cp-proof-resume" disabled={busy || !nextPending} onClick={() => nextPending && onSelect(nextPending)}>Next pending design →</button>
    </div>
    <div className="cp-proof-strip">
      {entries.map(entry => {
        const image = entry.canOpen ? previewFor(entry) : null;
        return <button type="button" key={entry.key} className="cp-proof-entry" data-status={entry.status}
          aria-current={entry.key === activeKey ? 'step' : undefined}
          aria-label={`Review ${entry.name}${entry.color ? ' — ' + entry.color : ''}${entry.placement ? ' · ' + entry.placement : ''} · ${entry.status}`}
          disabled={busy || !entry.canOpen} onClick={() => onSelect(entry)}>
          <span className="cp-proof-thumb">{image ? <img src={image} alt="" loading="lazy" /> : <span>{entry.canOpen ? 'Proof' : 'Coming soon'}</span>}</span>
          <span className="cp-proof-entry-copy"><strong>{entry.name}</strong>
            <small>{[entry.color, entry.qty ? entry.qty + ' units' : ''].filter(Boolean).join(' · ')}</small>
            <small>{[entry.placement, entry.method].filter(Boolean).join(' · ')}</small>
            <span className="cp-proof-entry-status">{entry.status}</span>
          </span>
        </button>;
      })}
    </div>
    <div className="cp-proof-walk">
      <button type="button" disabled={busy || visibleIndex <= 0} onClick={() => onSelect(available[visibleIndex - 1])}>← Previous item</button>
      <span aria-live="polite">{active >= 0 ? `Item ${active + 1} of ${entries.length}` : 'Order proofs'} · Decisions apply to the current design only</span>
      <button type="button" disabled={busy || visibleIndex < 0 || visibleIndex >= available.length - 1} onClick={() => onSelect(available[visibleIndex + 1])}>Next item →</button>
    </div>
  </section>;
}
