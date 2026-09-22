import React, { useEffect, useRef, useState } from 'react';
import { authFetch } from './utils';
import { collectQBAudit } from './qbAuditExport';

// Uses the existing staff/accounting-authorized endpoint. Does not use qbApi's
// sync-settings error handler, store credentials, or update Portal/QBO records.
async function readAudit(action, payload) {
  if (!['connection_status', 'company_info', 'query'].includes(action)) throw new Error('Read action only.');
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 45000);
  try {
  const response = await authFetch('/.netlify/functions/qb-api', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: timeout.signal,
    body: JSON.stringify({ ...payload, action, company: 'national', sandbox: false }),
  });
  if (!response.ok) {
    const error = new Error(`QBO read failed (HTTP ${response.status}). No complete export was produced.`);
    error.status = response.status;
    throw error;
  }
  return await response.json();
  } finally { clearTimeout(timer); }
}

export default function QBAuditExportCard() {
  const [captureThrough, setCaptureThrough] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const run = async () => {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setReport(null); setProgress(null);
    try {
      const result = await collectQBAudit({ read: readAudit, cutoff: '2026-05-31', captureThrough, signal: abort.signal, onProgress: setProgress });
      if (!abort.signal.aborted) setReport(result);
    } catch (e) { if (!abort.signal.aborted) setError(e.message); }
    finally { controller.current = null; setBusy(false); }
  };
  const download = () => {
    if (!report?.complete) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `NSA-QBO-audit-${report.cutoff}-captured-${report.finishedAt.slice(0, 10)}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="card" aria-label="Read-only migration audit">
    <div className="card-header"><h2>Migration audit — read only</h2></div>
    <div className="card-body">
      <p>Read the full journal lines, bills, credits, payments and application links for the May 31, 2026 reconciliation. No transactions, links or automation settings are changed.</p>
      <p>Include later transactions to trace payments applied after May. This exports current records, not historical aging or deleted transactions. Keep the existing May 31 aging reports as the control.</p>
      <label>Include transactions through <input type="date" value={captureThrough} min="2026-05-31" disabled={busy} onChange={e => { setCaptureThrough(e.target.value); setReport(null); }} /></label>
      <div style={{ marginTop: 12 }}><button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Reading QBO…' : 'Read audit data — no changes'}</button></div>
      {progress && <p role="status">{progress.entity}: {progress.count.toLocaleString()} records read. {busy ? 'Keep this tab open.' : ''}</p>}
      {error && <p role="alert">{error}</p>}
      {report && <><p>Complete capture for {report.companyName}, realm {report.realmId}. Finished {report.finishedAt}.</p>
        <ul>{Object.entries(report.entities).map(([entity, rows]) => <li key={entity}>{entity}: {rows.length.toLocaleString()}</li>)}</ul>
        <button className="btn btn-secondary" onClick={download}>Download audit JSON</button></>}
    </div>
  </section>;
}
