import React, { useMemo, useState } from 'react';
import { fileUpload } from '../utils';
import { METHODIC_STATUS } from './methodicWorkflow';

const field = { display: 'flex', flexDirection: 'column', gap: 5 };
const label = { fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '.04em' };
const input = { border: '1px solid #cbd5e1', borderRadius: 7, padding: '8px 10px', fontSize: 13, background: 'white' };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 };
const centsToDollars = (value) => value == null ? '' : (Number(value) / 100).toFixed(2);

const options = (items) => Object.entries(items).map(([value, text]) => <option key={value} value={value}>{text}</option>);

export default function MethodicRequestForm({ request, order, teamMembers = [], onSave, onCancel }) {
  const isNew = !request?.id;
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(() => ({
    title: request?.title || order?.memo || '',
    style_number: request?.style_number || '',
    garment_description: request?.garment_description || '',
    garment_color: request?.garment_color || '',
    quantity: request?.quantity || 0,
    size_breakdown: request?.size_breakdown || {},
    priority: request?.priority || 'normal',
    art_job_id: request?.art_job_id || '',
    request_notes: request?.request_notes || '',
    reference_files: request?.reference_files || [],
    pricing_status: request?.pricing_status || 'requested',
    expected_pricing_date: request?.expected_pricing_date || '',
    quoted_unit_cost: centsToDollars(request?.quoted_unit_cost_cents),
    quoted_setup_cost: centsToDollars(request?.quoted_setup_cost_cents),
    pricing_notes: request?.pricing_notes || '',
    mockup_status: request?.mockup_status || 'requested',
    expected_mockup_date: request?.expected_mockup_date || '',
    sample_status: request?.sample_status || 'not_requested',
    expected_sample_date: request?.expected_sample_date || '',
    sample_tracking_number: request?.sample_tracking_number || '',
    sample_tracking_url: request?.sample_tracking_url || '',
    order_status: request?.order_status || 'not_ordered',
    purchase_order_number: request?.purchase_order_number || '',
    methodic_order_number: request?.methodic_order_number || '',
    expected_ship_date: request?.expected_ship_date || '',
    expected_arrival_date: request?.expected_arrival_date || '',
    carrier: request?.carrier || '',
    tracking_number: request?.tracking_number || '',
    tracking_url: request?.tracking_url || '',
    owner_id: request?.owner_id || '',
    blocker: request?.blocker || '',
  }));
  const jobs = useMemo(() => Array.isArray(order?.jobs) ? order.jobs : [], [order]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const chooseJob = (jobId) => {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) { set('art_job_id', jobId); return; }
    const itemIndexes = new Set((job.items || []).map((item) => item.item_idx));
    const lines = (order?.items || []).filter((_, index) => itemIndexes.has(index));
    const sizes = {};
    lines.forEach((line) => Object.entries(line.sizes || {}).forEach(([size, qty]) => { sizes[size] = (sizes[size] || 0) + Number(qty || 0); }));
    setForm((current) => ({
      ...current, art_job_id: jobId,
      style_number: current.style_number || lines.map((line) => line.sku).filter(Boolean).join(' / '),
      garment_description: current.garment_description || lines.map((line) => line.name).filter(Boolean).join(' / '),
      garment_color: current.garment_color || lines.map((line) => line.color).filter(Boolean).join(' / '),
      quantity: Number(current.quantity) > 0 ? current.quantity : (job.total_units || Object.values(sizes).reduce((sum, qty) => sum + qty, 0)),
      size_breakdown: Object.keys(current.size_breakdown || {}).length ? current.size_breakdown : sizes,
    }));
  };

  const submit = async () => {
    setError('');
    if (!form.title.trim()) return setError('Add a short request title.');
    if (form.mockup_status === 'requested' && !form.art_job_id) return setError('Choose the sales-order art job that should receive this mock request.');
    setSaving(true);
    try {
      await onSave({
        ...form,
        quantity: Number(form.quantity || 0),
        quoted_unit_cost_cents: form.quoted_unit_cost === '' ? null : Math.round(Number(form.quoted_unit_cost) * 100),
        quoted_setup_cost_cents: form.quoted_setup_cost === '' ? null : Math.round(Number(form.quoted_setup_cost) * 100),
      });
    } catch (saveError) {
      setError(saveError.message || 'Could not save the Methodic request.');
    } finally { setSaving(false); }
  };

  const upload = async (files) => {
    if (!files?.length) return;
    setUploading(true); setError('');
    try {
      const added = [];
      for (const file of Array.from(files).slice(0, 10)) {
        const url = await fileUpload(file, 'methodic-requests');
        added.push({ url, name: file.name });
      }
      set('reference_files', [...form.reference_files, ...added]);
    } catch (uploadError) { setError(uploadError.message || 'Reference upload failed.'); }
    finally { setUploading(false); }
  };

  return <div>
    <div style={grid}>
      <label style={{ ...field, gridColumn: 'span 2' }}><span style={label}>Request name</span><input style={input} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Varsity basketball uniforms" /></label>
      <label style={field}><span style={label}>Priority</span><select style={input} value={form.priority} onChange={(e) => set('priority', e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="rush">Rush</option></select></label>
      <label style={field}><span style={label}>Methodic owner</span><select style={input} value={form.owner_id} onChange={(e) => set('owner_id', e.target.value)}><option value="">Unassigned</option>{teamMembers.filter((member) => member.is_active !== false).map((member) => <option key={member.id} value={member.id}>{member.name || member.email || member.id}</option>)}</select></label>
      <label style={field}><span style={label}>Style number</span><input style={input} value={form.style_number} onChange={(e) => set('style_number', e.target.value)} /></label>
      <label style={field}><span style={label}>Garment / product</span><input style={input} value={form.garment_description} onChange={(e) => set('garment_description', e.target.value)} /></label>
      <label style={field}><span style={label}>Color</span><input style={input} value={form.garment_color} onChange={(e) => set('garment_color', e.target.value)} /></label>
      <label style={field}><span style={label}>Estimated quantity</span><input style={input} type="number" min="0" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} /></label>
      <div style={field}><span style={label}>Size breakdown</span><div style={{ ...input, minHeight: 36, color: Object.keys(form.size_breakdown || {}).length ? '#334155' : '#94a3b8' }}>{Object.entries(form.size_breakdown || {}).filter(([, qty]) => Number(qty) > 0).map(([size, qty]) => `${size}: ${qty}`).join(' · ') || 'Auto-filled from the selected art job'}</div></div>
    </div>

    <div style={{ ...grid, marginTop: 16, padding: 14, background: '#f8fafc', borderRadius: 10 }}>
      <label style={field}><span style={label}>Pricing</span><select style={input} value={form.pricing_status} onChange={(e) => set('pricing_status', e.target.value)}>{options(METHODIC_STATUS.pricing)}</select></label>
      <label style={field}><span style={label}>Pricing expected</span><input style={input} type="date" value={form.expected_pricing_date} onChange={(e) => set('expected_pricing_date', e.target.value)} /></label>
      {!isNew && <><label style={field}><span style={label}>Quoted unit cost</span><input style={input} type="number" min="0" step="0.01" value={form.quoted_unit_cost} onChange={(e) => set('quoted_unit_cost', e.target.value)} /></label><label style={field}><span style={label}>Setup cost</span><input style={input} type="number" min="0" step="0.01" value={form.quoted_setup_cost} onChange={(e) => set('quoted_setup_cost', e.target.value)} /></label></>}
      <label style={{ ...field, gridColumn: '1/-1' }}><span style={label}>Pricing notes</span><textarea style={{ ...input, minHeight: 60 }} value={form.pricing_notes} onChange={(e) => set('pricing_notes', e.target.value)} /></label>
    </div>

    <div style={{ ...grid, marginTop: 16, padding: 14, background: '#f5f3ff', borderRadius: 10 }}>
      <label style={field}><span style={label}>Mockup status</span><select style={input} value={form.mockup_status} onChange={(e) => set('mockup_status', e.target.value)}>{options(METHODIC_STATUS.mockup)}</select></label>
      <label style={field}><span style={label}>Send to art job</span><select style={input} value={form.art_job_id} onChange={(e) => chooseJob(e.target.value)}><option value="">Choose job…</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.id} — {job.art_name || job.key || 'Art job'}</option>)}</select></label>
      <label style={field}><span style={label}>Mock expected</span><input style={input} type="date" value={form.expected_mockup_date} onChange={(e) => set('expected_mockup_date', e.target.value)} /></label>
      <div style={{ fontSize: 12, color: jobs.length ? '#5b21b6' : '#b45309', alignSelf: 'end', paddingBottom: 8 }}>{jobs.length ? 'Requesting a mock adds it directly to the Art Dashboard.' : 'This order has no art jobs yet. Add/link its artwork before requesting a mock.'}</div>
    </div>

    <div style={{ ...grid, marginTop: 16, padding: 14, background: '#fffbeb', borderRadius: 10 }}>
        <label style={field}><span style={label}>Sample status</span><select style={input} value={form.sample_status} onChange={(e) => set('sample_status', e.target.value)}>{options(METHODIC_STATUS.sample)}</select></label>
        <label style={field}><span style={label}>Sample expected</span><input style={input} type="date" value={form.expected_sample_date} onChange={(e) => set('expected_sample_date', e.target.value)} /></label>
        <label style={field}><span style={label}>Sample tracking</span><input style={input} value={form.sample_tracking_number} onChange={(e) => set('sample_tracking_number', e.target.value)} /></label>
        <label style={field}><span style={label}>Sample tracking URL</span><input style={input} value={form.sample_tracking_url} onChange={(e) => set('sample_tracking_url', e.target.value)} /></label>
    </div>
    {!isNew && <>
      <div style={{ ...grid, marginTop: 16, padding: 14, background: '#ecfdf5', borderRadius: 10 }}>
        <label style={field}><span style={label}>Order status</span><select style={input} value={form.order_status} onChange={(e) => set('order_status', e.target.value)}>{options(METHODIC_STATUS.order)}</select></label>
        <label style={field}><span style={label}>NSA PO</span><input style={input} value={form.purchase_order_number} onChange={(e) => set('purchase_order_number', e.target.value)} /></label>
        <label style={field}><span style={label}>Methodic order #</span><input style={input} value={form.methodic_order_number} onChange={(e) => set('methodic_order_number', e.target.value)} /></label>
        <label style={field}><span style={label}>Expected ship</span><input style={input} type="date" value={form.expected_ship_date} onChange={(e) => set('expected_ship_date', e.target.value)} /></label>
        <label style={field}><span style={label}>Expected arrival</span><input style={input} type="date" value={form.expected_arrival_date} onChange={(e) => set('expected_arrival_date', e.target.value)} /></label>
        <label style={field}><span style={label}>Carrier</span><input style={input} value={form.carrier} onChange={(e) => set('carrier', e.target.value)} /></label>
        <label style={field}><span style={label}>Tracking number</span><input style={input} value={form.tracking_number} onChange={(e) => set('tracking_number', e.target.value)} /></label>
        <label style={field}><span style={label}>Tracking URL</span><input style={input} value={form.tracking_url} onChange={(e) => set('tracking_url', e.target.value)} /></label>
      </div>
    </>}

    <div style={{ ...grid, marginTop: 16 }}>
      <label style={{ ...field, gridColumn: '1/-1' }}><span style={label}>Request details / art direction</span><textarea style={{ ...input, minHeight: 90 }} value={form.request_notes} onChange={(e) => set('request_notes', e.target.value)} placeholder="Product, construction, colors, placements, customer deadline, and what Methodic should price…" /></label>
      <label style={{ ...field, gridColumn: '1/-1' }}><span style={label}>Blocker / waiting on</span><input style={input} value={form.blocker} onChange={(e) => set('blocker', e.target.value)} placeholder="Leave blank when unblocked" /></label>
      <div style={{ gridColumn: '1/-1' }}>
        <div style={label}>Reference files</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
          {form.reference_files.map((file, index) => <span key={`${file.url}-${index}`} style={{ padding: '5px 8px', background: '#eef2ff', borderRadius: 6, fontSize: 11 }}><a href={file.url} target="_blank" rel="noreferrer">{file.name || `Reference ${index + 1}`}</a> <button type="button" onClick={() => set('reference_files', form.reference_files.filter((_, i) => i !== index))} style={{ border: 0, background: 'transparent', color: '#dc2626', cursor: 'pointer' }}>×</button></span>)}
          <label style={{ ...input, cursor: uploading ? 'wait' : 'pointer', color: '#4338ca' }}>{uploading ? 'Uploading…' : '+ Add files'}<input type="file" multiple hidden disabled={uploading} onChange={(e) => upload(e.target.files)} /></label>
        </div>
      </div>
    </div>
    {error && <div style={{ marginTop: 12, color: '#b91c1c', background: '#fef2f2', padding: 9, borderRadius: 7, fontSize: 12, fontWeight: 700 }}>{error}</div>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
      <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
      <button className="btn btn-primary" onClick={submit} disabled={saving || uploading}>{saving ? 'Saving…' : isNew ? 'Create Methodic request' : 'Save Methodic request'}</button>
    </div>
  </div>;
}
