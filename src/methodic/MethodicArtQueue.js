import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fileUpload } from '../utils';
import { methodicApi } from './methodicApi';

const ACTIVE = new Set(['requested', 'in_art', 'ready_for_rep', 'revisions_requested']);
const statusLabel = {
  requested: 'Waiting for art', in_art: 'In progress', ready_for_rep: 'Ready for rep', revisions_requested: 'Revisions requested',
};

export default function MethodicArtQueue({ estimates = [], salesOrders = [], customers = [], teamMembers = [], notify, onOpenDocument }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const customerById = useMemo(() => new Map(customers.map((row) => [row.id, row])), [customers]);
  const repById = useMemo(() => new Map(teamMembers.map((row) => [row.id, row])), [teamMembers]);
  const documentById = useMemo(() => new Map([...estimates, ...salesOrders].map((row) => [row.id, row])), [estimates, salesOrders]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await methodicApi('list');
      setRequests((data.requests || []).filter((row) => !row.art_job_id && ACTIVE.has(row.mockup_status)));
    } catch (loadError) { setError(loadError.message || 'Could not load Methodic art requests.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener('methodic-updated', refresh);
    return () => window.removeEventListener('methodic-updated', refresh);
  }, [load]);

  const update = async (row, patch, message) => {
    setBusyId(row.id); setError('');
    try {
      await methodicApi('update', { id: row.id, ...patch });
      window.dispatchEvent(new CustomEvent('methodic-updated', { detail: { salesOrderId: row.sales_order_id, estimateId: row.estimate_id } }));
      notify?.(message);
      await load();
    } catch (updateError) { setError(updateError.message || 'Could not update Methodic art.'); }
    finally { setBusyId(''); }
  };

  const upload = async (row, files) => {
    if (!files?.length) return;
    setBusyId(row.id); setError('');
    try {
      const added = [];
      for (const file of Array.from(files).slice(0, 10)) {
        const url = await fileUpload(file, 'methodic-mockups');
        added.push({ url, name: file.name });
      }
      await methodicApi('update', { id: row.id, mockup_files: [...(row.mockup_files || []), ...added], mockup_status: 'ready_for_rep' });
      window.dispatchEvent(new CustomEvent('methodic-updated', { detail: { salesOrderId: row.sales_order_id, estimateId: row.estimate_id } }));
      notify?.(`${row.request_number} mockup uploaded and ready for the rep`);
      await load();
    } catch (uploadError) { setError(uploadError.message || 'Mockup upload failed.'); }
    finally { setBusyId(''); }
  };

  if (!loading && !requests.length && !error) return null;
  return <div className="card" style={{ marginBottom: 14, border: '1px solid #c7d2fe', overflow: 'hidden' }}>
    <div style={{ padding: '11px 14px', background: 'linear-gradient(135deg,#eef2ff,#f5f3ff)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontWeight: 900, color: '#3730a3' }}>METHODIC PRE-JOB MOCKUPS</span>
      <span style={{ borderRadius: 999, padding: '2px 7px', background: '#4338ca', color: 'white', fontSize: 10, fontWeight: 900 }}>{requests.length}</span>
      <span style={{ color: '#6366f1', fontSize: 11 }}>Estimate and SO requests waiting for a normal art job</span>
      <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
    </div>
    {error && <div style={{ margin: 10, padding: 9, color: '#b91c1c', background: '#fef2f2', borderRadius: 7 }}>{error}</div>}
    <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(270px,1fr))', gap: 8 }}>
      {requests.map((row) => {
        const documentId = row.estimate_id || row.sales_order_id;
        const document = documentById.get(documentId);
        const customer = customerById.get(row.customer_id || document?.customer_id);
        const rep = repById.get(row.rep_id || customer?.primary_rep_id || document?.created_by);
        const working = busyId === row.id;
        return <div key={row.id} style={{ border: row.priority === 'rush' ? '2px solid #ef4444' : '1px solid #dbe3ef', borderRadius: 9, padding: 11, background: 'white' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontFamily: 'monospace', fontWeight: 900, color: '#4338ca' }}>{row.request_number}</span><span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 900, textTransform: 'uppercase', color: row.mockup_status === 'ready_for_rep' ? '#166534' : '#92400e', background: row.mockup_status === 'ready_for_rep' ? '#dcfce7' : '#fef3c7', borderRadius: 999, padding: '2px 6px' }}>{statusLabel[row.mockup_status]}</span></div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginTop: 6 }}>{customer?.name || 'Unknown customer'}</div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{row.style_number || 'No style'} · {row.garment_description || row.title}{row.garment_color ? ` · ${row.garment_color}` : ''}</div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>{documentId} · line {Number(row.item_index || 0) + 1} · {row.quantity || 0} units · Rep: {rep?.name || '—'}</div>
          {row.request_notes && <div style={{ fontSize: 10, color: '#334155', marginTop: 7, padding: 7, background: '#f8fafc', borderRadius: 6, whiteSpace: 'pre-wrap' }}>{row.request_notes}</div>}
          {(row.reference_files || []).length > 0 && <div style={{ marginTop: 7, fontSize: 10 }}>References: {(row.reference_files || []).map((file, index) => <React.Fragment key={`${file.url}-${index}`}><a href={file.url} target="_blank" rel="noreferrer">{file.name || `File ${index + 1}`}</a>{index < row.reference_files.length - 1 ? ' · ' : ''}</React.Fragment>)}</div>}
          {(row.mockup_files || []).length > 0 && <div style={{ marginTop: 7, padding: 7, background: '#f0fdf4', borderRadius: 6, fontSize: 10 }}>Mockups: {(row.mockup_files || []).map((file, index) => <React.Fragment key={`${file.url}-${index}`}><a href={file.url} target="_blank" rel="noreferrer">{file.name || `Mockup ${index + 1}`}</a>{index < row.mockup_files.length - 1 ? ' · ' : ''}</React.Fragment>)}</div>}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 9 }}>
            {row.mockup_status === 'requested' && <button className="btn btn-sm" disabled={working} style={{ background: '#1d4ed8', color: 'white', border: 0 }} onClick={() => update(row, { mockup_status: 'in_art' }, `${row.request_number} moved to Art in progress`)}>Start working</button>}
            {['in_art', 'revisions_requested'].includes(row.mockup_status) && <label className="btn btn-sm" style={{ background: '#7c3aed', color: 'white', border: 0, cursor: working ? 'wait' : 'pointer' }}>{working ? 'Uploading…' : 'Upload mockup'}<input hidden type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.ai,.eps,.svg" disabled={working} onChange={(event) => upload(row, event.target.files)} /></label>}
            {row.mockup_status === 'ready_for_rep' && <button className="btn btn-sm" disabled={working} style={{ background: '#166534', color: 'white', border: 0 }} onClick={() => update(row, { mockup_status: 'approved' }, `${row.request_number} mockup approved`)}>Approve mockup</button>}
            <button className="btn btn-sm btn-secondary" onClick={() => onOpenDocument?.(row.estimate_id ? 'estimate' : 'sales_order', documentId)}>Open {row.estimate_id ? 'estimate' : 'SO'}</button>
          </div>
        </div>;
      })}
    </div>
  </div>;
}
