import React, { useState, useEffect, useCallback, useRef } from 'react';
import useCoachSession from './useCoachSession';

// Team logo library for a selected customer — the union of the team's staff
// art library and prior Team Shop uploads, from netlify/functions/teamshop-art.js
// (coach-JWT-authed, same bearer pattern as TeamPicker). Coaches can also
// upload a new logo here: the file is base64-encoded client-side and written
// by the service-role function (00187 made artwork-bucket writes staff-only,
// so the browser never touches storage directly).
//
// TODO(stage-4): the real garment → logo placement flow mounts this from the
// product customization step and consumes onSelect(logo); for now the Logos
// nav view just browses/uploads.

const ACCEPTED = 'image/png,image/jpeg,image/svg+xml,application/pdf';
const MAX_BYTES = 10 * 1024 * 1024;

// FileReader → bare base64 (data:...;base64, prefix stripped).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf('base64,');
      resolve(i >= 0 ? s.slice(i + 7) : s);
    };
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

export default function LogoPicker({ customer, onSelect, onLogosChange }) {
  const { accessToken } = useCoachSession();
  const [state, setState] = useState('loading'); // loading|ready|error
  const [logos, setLogos] = useState([]);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);

  const customerId = customer && customer.id;

  const callArt = useCallback(async (payload) => {
    const res = await fetch('/.netlify/functions/teamshop-art', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Request failed');
    return json;
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !customerId) return undefined;
    let alive = true;
    setState('loading');
    (async () => {
      try {
        const json = await callArt({ action: 'list', customer_id: customerId });
        if (!alive) return;
        setLogos(Array.isArray(json.logos) ? json.logos : []);
        setState('ready');
      } catch (e) {
        if (alive) { setError(e.message || 'Could not load logos'); setState('error'); }
      }
    })();
    return () => { alive = false; };
  }, [accessToken, customerId, callArt]);

  // Optional: report the current logo list upward (e.g. AccountPage's "saved
  // logos" count) without forking the fetch above — same one list, reported
  // whenever it changes (initial load, or a new upload).
  useEffect(() => {
    if (onLogosChange) onLogosChange(logos);
  }, [logos, onLogosChange]);

  const uploadFile = useCallback(async (file) => {
    if (!file) return;
    setUploadError('');
    if (file.size > MAX_BYTES) { setUploadError('File too large (max 10 MB)'); return; }
    setUploading(true);
    try {
      const b64 = await fileToBase64(file);
      const json = await callArt({
        action: 'upload',
        customer_id: customerId,
        name: file.name.replace(/\.[^.]+$/, ''),
        file_base64: b64,
        mime: file.type || 'application/octet-stream',
      });
      if (json.logo) setLogos((prev) => [json.logo, ...prev]);
    } catch (e) {
      setUploadError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [callArt, customerId]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    uploadFile(file);
  }, [uploadFile]);

  if (!customerId) return null;
  if (state === 'loading') return <p style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>Loading logos…</p>;
  if (state === 'error') return <p style={{ color: '#dc2626', textAlign: 'center', padding: 24 }}>{error}</p>;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Team Logos</h1>
      <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px' }}>
        {customer.name || customer.id} — pick a logo for your gear, or upload a new one.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInput.current && fileInput.current.click()}
        style={{
          border: `2px dashed ${dragOver ? '#0f172a' : '#cbd5e1'}`,
          borderRadius: 10,
          padding: '24px 16px',
          textAlign: 'center',
          color: '#64748b',
          fontSize: 14,
          cursor: 'pointer',
          marginBottom: 20,
          background: dragOver ? '#f8fafc' : '#fff',
        }}
      >
        {uploading ? 'Uploading…' : 'Drop a logo here or click to browse (PNG, JPG, SVG, or PDF — max 10 MB)'}
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED}
          style={{ display: 'none' }}
          onChange={(e) => { uploadFile(e.target.files && e.target.files[0]); e.target.value = ''; }}
        />
      </div>
      {uploadError && <p style={{ color: '#dc2626', fontSize: 13, marginTop: -12, marginBottom: 16 }}>{uploadError}</p>}

      {!logos.length && <p style={{ color: '#64748b' }}>No logos yet — upload one above, or your rep can add art to your account.</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16 }}>
        {logos.map((logo) => (
          <button
            key={`${logo.source}:${logo.id}`}
            onClick={() => onSelect && onSelect(logo)}
            style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fff', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
          >
            <div style={{ aspectRatio: '1 / 1', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {logo.url ? (
                <img src={logo.url} alt={logo.name || 'Logo'} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>No preview</span>
              )}
            </div>
            <div style={{ padding: '8px 10px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {logo.name || 'Logo'}
              </div>
              <span style={{
                display: 'inline-block',
                marginTop: 4,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: logo.source === 'art_library' ? '#3730a3' : '#166534',
                background: logo.source === 'art_library' ? '#eef2ff' : '#f0fdf4',
                borderRadius: 4,
                padding: '2px 6px',
              }}>
                {logo.source === 'art_library' ? 'Your art library' : 'Uploaded'}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
