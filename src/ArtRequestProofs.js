import React, { useEffect, useState } from 'react';
const labels = { pending: 'Waiting for customer approval', approved: 'Customer approved', changes_requested: 'Customer requested changes' };
export function ProofHistory({ proofs = [] }) {
  return proofs.map(p => <div key={p.version} style={{ marginTop: 10 }}><strong>Proof {p.version} · {labels[p.status] || p.status}</strong>{p.shared_at && <div>Shared {new Date(p.shared_at).toLocaleString()}</div>}{p.decided_at && <div>Reviewed {new Date(p.decided_at).toLocaleString()}</div>}{p.comment && <p>{p.comment}</p>}{(p.files || []).map((f, i) => { const url = typeof f === 'string' ? f : f?.url; return /^https?:\/\//i.test(url || '') ? <a key={i} href={url} target="_blank" rel="noreferrer" style={{display:'block'}}>Proof {p.version}: {f.name || 'View artwork'}</a> : null; })}</div>);
}
export function ShareArtProof({ row, service, onChanged, portalTag }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latest = row.portal_proofs?.slice(-1)[0];
  const shared = latest && ['pending', 'approved'].includes(latest.status) && JSON.stringify(latest.files) === JSON.stringify(row.result_files);
  return <section aria-label="Customer approval" style={{ marginTop: 12 }}>
    <ProofHistory proofs={row.portal_proofs} />
    {row.status === 'completed' && !shared && <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await service.shareProof(row.id); await onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); }
    }}>{busy ? 'Sharing…' : 'Share in customer portal for approval'}</button>}
    {shared && <p>Shared in the customer portal. Artwork approval does not approve the estimate or order.</p>}
    {shared && portalTag && <a href={`${window.location.origin}/?portal=${encodeURIComponent(portalTag)}`} target="_blank" rel="noreferrer">Open customer portal</a>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
async function portalCall(body) {
  const res = await fetch('/.netlify/functions/art-request-portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not save your response');
  return data;
}
function CustomerProof({ row, alphaTag, onChanged }) {
  const proof = row.portal_proofs.slice(-1)[0];
  const [comment, setComment] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const decide = async decision => {
    setBusy(true); setError('');
    try { const data = await portalCall({ action: 'decide', alphaTag, id: row.id, version: proof.version, decision, comment }); onChanged(row.id, data.proof); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <article style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 16, marginTop: 12, background: '#fff' }}>
    <h3>{row.art_name}</h3><p>{row.estimate_id || row.so_id || 'Customer artwork'}{row.color_way_label ? ` · ${row.color_way_label}` : ''} · Proof {proof.version}</p>
    <strong>{labels[proof.status]}</strong>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '16px 0' }}>{proof.files.map((f, i) => {
      const url = typeof f === 'string' ? f : f.url, name = f.name || 'View artwork';
      if (!/^https?:\/\//i.test(url || '')) return null;
      return <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>{/\.(png|jpe?g|webp)(\?|$)/i.test(url) && <img src={url} alt={name} style={{ display: 'block', maxWidth: '100%', width: 260, maxHeight: 260, objectFit: 'contain', background: '#f1f5f9' }} />}{name}</a>;
    })}</div>
    {proof.status === 'pending' && <><label>Comments or requested changes<textarea value={comment} maxLength={5000} onChange={e => setComment(e.target.value)} style={{ display: 'block', width: '100%', minHeight: 80 }} /></label><div style={{ display: 'flex', gap: 12, marginTop: 12 }}><button disabled={busy} onClick={() => decide('approve')}>Approve artwork</button><button disabled={busy || !comment.trim()} onClick={() => decide('reject')}>Request changes</button></div></>}
    {error && <p role="alert">{error}</p>}
    <details style={{ marginTop: 12 }}><summary>Approval history</summary><ProofHistory proofs={row.portal_proofs} /></details>
  </article>;
}
export default function CustomerArtProofs({ alphaTag, estimateId }) {
  const [rows, setRows] = useState([]), [error, setError] = useState('');
  const decided = (id, proof) => setRows(current => current.map(row => row.id === id ? { ...row, portal_proofs: row.portal_proofs.map(p => p.version === proof.version ? proof : p) } : row));
  useEffect(() => { let alive = true; setRows([]); setError(''); portalCall({ action: 'list', alphaTag }).then(data => { if (alive) setRows(data.requests || []); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [alphaTag]);
  const visible = rows.filter(r => !estimateId || r.estimate_id === estimateId);
  if (!visible.length && !error) return null;
  return <section aria-label="Artwork approvals" style={{ marginBottom: 24 }}><h2>Artwork approvals</h2><p>Review artwork shared by your rep. Approving artwork does not approve an estimate, place an order, or authorize production.</p>{error && <p role="alert">{error}</p>}{visible.map(row => <CustomerProof key={row.id} row={row} alphaTag={alphaTag} onChanged={decided} />)}</section>;
}
