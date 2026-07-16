import React, { useCallback, useEffect, useRef, useState } from 'react';

// Top Star digitizing vendor portal — queue of embroidery jobs sent out for
// digitizing (netlify/functions/vendor-digitizing.js), DST upload, and a
// "mark complete" confirmation. A staff-only lazy chunk routed at
// /vendor-digitizing by src/index.js (same wiring as /floor-station), but
// unlike FloorStation this page has NO staff sign-in path at all — it's opened
// by one outside vendor from a bookmarked link carrying ?token=, and every
// call authenticates with that static token alone. This page never imports
// App.js, OrderEditor.js, or the Supabase client — the vendor only ever talks
// to the one hand-curated, money-free, PII-free function endpoint.
//
// Token: read once from the URL on first load and cached in sessionStorage so
// a reload (or a second tab opened from a bookmark without the query string)
// keeps working for the rest of the browser session. Never written anywhere
// more persistent than that.
//
// Upload: the vendor's browser uploads the DST straight to Cloudinary with the
// same unsigned preset OrderEditor's dstUploadModal / src/utils.js's fileUpload
// use (mirrored standalone here, not imported — this chunk must not pull in
// OrderEditor's dependency tree), then hands the resulting secure_url to the
// function's `upload` action, which is the only thing that ever writes to the
// database.

const TOKEN_KEY = 'nsa_vendor_digitizing_token';
const CLOUDINARY_CLOUD = 'dwlyljyuz';
const CLOUDINARY_PRESET = 'ml_default_nsaportal';

const tokenFromUrl = () => {
  try { return new URLSearchParams(window.location.search).get('token') || null; }
  catch { return null; }
};

function getToken() {
  const fromUrl = tokenFromUrl();
  if (fromUrl) {
    try { sessionStorage.setItem(TOKEN_KEY, fromUrl); } catch {}
    return fromUrl;
  }
  try { return sessionStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

async function callVendorFn(body, token) {
  const res = await fetch('/.netlify/functions/vendor-digitizing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-vendor-token': token || '' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

// Client-side Cloudinary upload — same shape as src/utils.js's fileUpload, kept
// standalone so this chunk doesn't depend on the rest of the portal.
async function cloudinaryUpload(file, folder = 'nsa-production') {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_PRESET);
  fd.append('folder', folder);
  fd.append('filename_override', file.name);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`, { method: 'POST', body: fd });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.secure_url;
}

const S = {
  page: { fontFamily: 'system-ui,-apple-system,sans-serif', background: '#f8fafc', color: '#0f172a', minHeight: '100vh', padding: 20 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' },
  btn: (bg) => ({ padding: '10px 18px', fontSize: 14, fontWeight: 700, background: bg, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }),
  btnSecondary: { padding: '10px 18px', fontSize: 14, fontWeight: 700, background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' },
  label: { fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
};

function GarmentTable({ garment }) {
  if (!garment || !garment.length) return <div style={{ fontSize: 13, color: '#94a3b8' }}>No garment info</div>;
  return (
    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
          <th style={{ padding: '4px 6px' }}>SKU</th>
          <th style={{ padding: '4px 6px' }}>Item</th>
          <th style={{ padding: '4px 6px' }}>Color</th>
          <th style={{ padding: '4px 6px' }}>Sizes</th>
        </tr>
      </thead>
      <tbody>
        {garment.map((g, i) => (
          <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
            <td style={{ padding: '4px 6px', fontFamily: 'ui-monospace,monospace' }}>{g.sku || '—'}</td>
            <td style={{ padding: '4px 6px' }}>{g.name || '—'}</td>
            <td style={{ padding: '4px 6px' }}>{g.color || '—'}</td>
            <td style={{ padding: '4px 6px' }}>
              {Object.entries(g.sizes || {}).filter(([, qty]) => Number(qty) > 0).map(([sz, qty]) => `${sz}:${qty}`).join(' ') || '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function JobDetail({ job, token, busy, onBusy, onMsg, onUploaded, onCompleted }) {
  const fileInputRef = useRef(null);

  const doUpload = async (file) => {
    if (!file) return;
    onBusy(true);
    onMsg(null);
    try {
      const secureUrl = await cloudinaryUpload(file, 'nsa-production');
      const r = await callVendorFn({ action: 'upload', so_id: job.so_id, job_id: job.job_id, file_url: secureUrl, file_name: file.name }, token);
      onBusy(false);
      if (!r.ok) { onMsg({ kind: 'err', text: 'Upload failed: ' + (r.error || 'unknown error') }); return; }
      onMsg({ kind: 'info', text: r.auto_completed ? 'DST uploaded — all designs on this job are confirmed, art marked complete.' : 'DST uploaded.' });
      onUploaded(job, r);
    } catch (e) {
      onBusy(false);
      onMsg({ kind: 'err', text: 'Upload failed: ' + (e.message || String(e)) });
    }
  };

  const doComplete = async () => {
    onBusy(true);
    onMsg(null);
    const r = await callVendorFn({ action: 'complete', so_id: job.so_id, job_id: job.job_id }, token);
    onBusy(false);
    if (!r.ok) { onMsg({ kind: 'err', text: 'Could not mark complete: ' + (r.error || 'unknown error') }); return; }
    onMsg({ kind: 'info', text: 'Marked complete — thanks!' });
    onCompleted(job);
  };

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{job.art_name || 'Unnamed Art'}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{job.so_id} · {job.job_id}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{job.total_units || 0} units</div>
          {job.digitizing_due_at && <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 700 }}>Due {new Date(job.digitizing_due_at).toLocaleDateString()}</div>}
        </div>
      </div>

      {job.positions && <div style={{ fontSize: 13, color: '#475569', marginBottom: 10 }}>Positions: {job.positions}</div>}

      <div style={{ marginBottom: 12 }}>
        <div style={S.label}>Garment</div>
        <GarmentTable garment={job.garment} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={S.label}>Art to Download</div>
        {(!job.art_files || !job.art_files.length) ? (
          <div style={{ fontSize: 13, color: '#94a3b8' }}>No art files on this job.</div>
        ) : job.art_files.map((f) => (
          <a key={f.url} href={f.url} target="_blank" rel="noreferrer"
             style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#1d4ed8', margin: '4px 0', wordBreak: 'break-all' }}>
            ↓ {f.name || f.url}
          </a>
        ))}
      </div>

      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".dst"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) doUpload(f); }}
        />
        <button type="button" disabled={busy} onClick={() => fileInputRef.current && fileInputRef.current.click()} style={S.btn(busy ? '#94a3b8' : '#7c3aed')}>
          {busy ? 'Working…' : '📎 Upload DST'}
        </button>
        <button type="button" disabled={busy} onClick={doComplete} style={S.btn(busy ? '#94a3b8' : '#166534')}>
          ✓ Mark Complete
        </button>
      </div>
    </div>
  );
}

function VendorDigitizingScreen({ token }) {
  const [jobs, setJobs] = useState(null); // null = loading
  const [selected, setSelected] = useState(null); // {so_id, job_id}
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const loadQueue = useCallback(async () => {
    const r = await callVendorFn({ action: 'list' }, token);
    if (!r.ok) {
      setJobs([]);
      setMsg({
        kind: 'err',
        text: r.status === 401 || r.status === 503
          ? 'Not authorized — open this page with the link your rep sent you.'
          : 'Could not load jobs: ' + (r.error || 'unknown error'),
      });
      return;
    }
    setJobs(r.jobs || []);
  }, [token]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const selectedJob = jobs && selected ? jobs.find((j) => j.so_id === selected.so_id && j.job_id === selected.job_id) : null;

  const onUploaded = () => { loadQueue(); };
  const onCompleted = () => { loadQueue(); };

  return (
    <div style={S.page}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Top Star Digitizing Queue</h1>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 0, marginBottom: 16 }}>
          Embroidery jobs waiting on a digitized file. Upload the .DST when it's ready, then mark the job complete.
        </p>

        {msg && (
          <div style={{
            marginBottom: 14, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: msg.kind === 'err' ? '#fef2f2' : '#f0fdf4',
            color: msg.kind === 'err' ? '#b91c1c' : '#166534',
            border: '1px solid ' + (msg.kind === 'err' ? '#fecaca' : '#bbf7d0'),
          }}>
            {msg.text}
          </div>
        )}

        {selectedJob ? (
          <>
            <button type="button" onClick={() => setSelected(null)} style={{ ...S.btnSecondary, marginBottom: 12 }}>← Back to queue</button>
            <JobDetail
              job={selectedJob}
              token={token}
              busy={busy}
              onBusy={setBusy}
              onMsg={setMsg}
              onUploaded={onUploaded}
              onCompleted={onCompleted}
            />
          </>
        ) : jobs === null ? (
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Loading…</div>
        ) : jobs.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Nothing in the queue right now.</div>
        ) : (
          jobs.map((j) => (
            <div key={j.so_id + j.job_id} style={{ ...S.card, cursor: 'pointer' }} onClick={() => setSelected({ so_id: j.so_id, job_id: j.job_id })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{j.art_name || 'Unnamed Art'}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{j.so_id} · {j.job_id} · {j.total_units || 0} units</div>
                </div>
                {j.digitizing_due_at && <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 700 }}>Due {new Date(j.digitizing_due_at).toLocaleDateString()}</div>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function VendorDigitizing() {
  const [token] = useState(getToken);

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ textAlign: 'center', color: '#334155' }}>
          <p>This link is missing its access token.</p>
          <p style={{ fontSize: 13, color: '#64748b' }}>Use the link your NSA rep sent you.</p>
        </div>
      </div>
    );
  }
  return <VendorDigitizingScreen token={token} />;
}
