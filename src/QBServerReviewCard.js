import React, { useRef, useState } from 'react';
import { authFetch } from './utils';

const labels = { running: 'Running — not verified', complete: 'Linked balances match', needs_review: 'Needs review', failed: 'Failed', abandoned: 'Abandoned — not verified' };
const money = value => value == null ? 'Unavailable' : '$' + (value / 100).toFixed(2);

export default function QBServerReviewCard() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [waiting, setWaiting] = useState(false);
  const baseline = useRef(null);
  const inFlight = useRef(false);

  async function readHistory() {
    const response = await authFetch('/.netlify/functions/qbo-review-status', { method: 'GET', cache: 'no-store' });
    if (!response.ok) throw new Error('Cannot read server history. Check your accounting/admin session and deployment.');
    const data = await response.json();
    if (!Array.isArray(data.runs) || data.mode !== 'read_only') throw new Error('Server review controls are not deployed yet.');
    setState(data);
    if (baseline.current) {
      const newRun = data.runs.find(r => !baseline.current.has(r.id) && String(r.realm_id) === data.realm);
      if (newRun) {
        setNotice('A new durable run is recorded below: ' + newRun.id + '. Read its status; this is not a migration sign-off.');
        baseline.current = null;
        setWaiting(false);
      }
    }
    return data;
  }

  async function act(start) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const data = await readHistory();
      if (!start) return;
      if (!data.enabled || data.runs.some(r => r.status === 'running')) throw new Error('Review is disabled or a run is already active.');
      baseline.current = new Set(data.runs.map(r => r.id));
      // Background HTTP acceptance does not prove authentication, configuration,
      // a claimed run, or success. Never parse it as a completed report.
      setWaiting(true);
      setNotice('Request sent; awaiting a durable run. Refresh history to verify. Do not start another request while the outcome is unknown.');
      const response = await authFetch('/.netlify/functions/qbo-review-background', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('Request outcome is unverified. Refresh history before retrying.');
    } catch (e) {
      setError(e.message || 'Review unavailable');
      // Preserve waiting after uncertain POST outcomes; an error is not proof
      // that Netlify did not start the background function.
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="card" style={{padding:16, marginBottom:16}} aria-label="Server QBO review">
    <h2>Server QBO review — read only</h2>
    <p>Runs on the server even when this tab closes. No invoices, payments, customer links, or accounting entries are changed. Transaction automation remains off.</p>
    <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
      <button className="btn btn-secondary" disabled={busy} onClick={() => act(false)}>Refresh server history</button>
      <button className="btn btn-primary" disabled={busy || waiting || !state?.enabled || state?.runs.some(r => r.status === 'running')} onClick={() => act(true)}>Run read-only server review</button>
    </div>
    {!state && <p>Refresh history to check server readiness before running.</p>}
    {state && <p>Server review: {state.enabled ? 'enabled' : 'disabled'} · Configured QBO realm: {state.realm || 'not configured'}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
    {state?.runs.length === 0 && <p>No durable runs recorded yet.</p>}
    {state?.runs.map(run => <details key={run.id} style={{marginTop:12}}>
      <summary>{run.started_at} · {labels[run.status] || 'Unknown — not verified'} · {run.id}</summary>
      <p>Realm {run.realm_id} · Finished {run.finished_at || 'not yet'}</p>
      {run.status === 'running' && <p>A running row blocks another run. If interrupted, an operator must verify the worker has ended before releasing it; this screen cannot bypass the lock.</p>}
      {run.error_code && <p>Error: {run.error_code}</p>}
      {run.report && <>
        <p>{run.report.counts?.total} source rows · {run.report.counts?.linked} linked · {run.report.counts?.aligned} aligned · {run.report.counts?.voidVerified} void verified · {run.report.counts?.unlinked} unlinked · {run.report.counts?.deleted} deleted</p>
        <p>{run.report.sourceChanged ? 'Source changed during review — not a clean result.' : 'Source snapshot unchanged during this review.'}</p>
        <p>This compares linked, nondeleted database invoice balances only. Unlinked/deleted records and payment-detail verification remain separate gates.</p>
        <details><summary>Exceptions</summary><div style={{overflowX:'auto'}}><table className="data-table">
          <thead><tr><th>Invoice</th><th>QBO ID</th><th>Finding</th><th>Portal paid</th><th>QBO paid</th></tr></thead>
          <tbody>{(run.report.results || []).filter(r => !['aligned','void_verified'].includes(r.action)).map(r => <tr key={r.invoiceId}><td>{r.invoiceId}</td><td>{r.qboId}</td><td>{r.action}</td><td>{money(r.portalPaidCents)}</td><td>{money(r.qboPaidCents)}</td></tr>)}</tbody>
        </table></div></details>
        <details><summary>Exact source population and exclusions</summary>
          <p>Source hash: {run.report.sourceHash}</p>
          <ul>{(run.report.population || []).map(r => <li key={r.id}>{r.id} · {r.exclusion || 'reviewed'} · QBO {r.qboId || 'unlinked'}</li>)}</ul>
        </details>
      </>}
    </details>)}
  </section>;
}
