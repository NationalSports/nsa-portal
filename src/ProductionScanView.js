/* eslint-disable */
// Production scan page — operator scans a barcode on a job ticket;
// this pulls up the full job card on a big screen at the press.
// USB barcode scanners act like keyboards: they "type" the barcode
// value followed by Enter into the hidden input.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './lib/supabase';

function ProductionScanView({ onBack }) {
  const [queueRow, setQueueRow] = useState(null);
  const [so, setSo] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [artFile, setArtFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | found | notfound | error
  const [lastScan, setLastScan] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const inputRef = useRef(null);

  // Keep the hidden input focused at all times — scanners need it
  useEffect(() => {
    const focus = () => { if (inputRef.current) inputRef.current.focus(); };
    focus();
    const id = setInterval(focus, 800);
    window.addEventListener('click', focus);
    return () => { clearInterval(id); window.removeEventListener('click', focus); };
  }, []);

  const lookup = useCallback(async (rawVal) => {
    const val = (rawVal || '').trim();
    if (!val) return;
    setLastScan(val);
    setStatus('loading');
    setErrMsg('');
    setQueueRow(null); setSo(null); setCustomer(null); setArtFile(null);
    try {
      if (!supabase) throw new Error('Supabase not configured');
      const { data: q, error: qe } = await supabase
        .from('production_queue')
        .select('*')
        .eq('barcode_value', val)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (qe) throw new Error(qe.message);
      if (!q) { setStatus('notfound'); return; }
      setQueueRow(q);
      const { data: soData } = await supabase
        .from('sales_orders').select('*').eq('id', q.so_id).maybeSingle();
      setSo(soData || null);
      if (soData?.customer_id) {
        const { data: c } = await supabase
          .from('customers').select('*').eq('id', soData.customer_id).maybeSingle();
        setCustomer(c || null);
      }
      const af = Array.isArray(soData?.art_files)
        ? soData.art_files.find((a) => a?.id === q.art_id) : null;
      setArtFile(af || null);
      setStatus('found');
    } catch (e) {
      setErrMsg(e.message || String(e));
      setStatus('error');
    }
  }, []);

  const markStarted = async () => {
    if (!so) return;
    try {
      await supabase.from('sales_orders')
        .update({ status: 'in_production', updated_at: new Date().toISOString() })
        .eq('id', so.id);
      setSo({ ...so, status: 'in_production' });
    } catch (e) {
      setErrMsg('Update failed: ' + (e.message || String(e)));
    }
  };

  const colorsSrc = queueRow?.deco_type === 'embroidery'
    ? (artFile?.thread_colors || '')
    : (artFile?.ink_colors || '');
  const colors = String(colorsSrc || '')
    .split(/\n|,/).map(s => s.trim()).filter(Boolean);
  const mockupFiles = (artFile?.mockup_files || artFile?.files || []);
  const firstMockup = mockupFiles.find(f => {
    const u = typeof f === 'string' ? f : (f?.url || '');
    return /\.(png|jpe?g|gif|webp|svg)$/i.test(u) || (u.includes('cloudinary.com') && u.includes('/image/upload/'));
  });
  const mockupUrl = firstMockup ? (typeof firstMockup === 'string' ? firstMockup : firstMockup.url) : '';

  const sizeBreakdown = Array.isArray(so?.items) ? so.items.reduce((acc, it) => {
    const sizes = it?.sizes || {};
    Object.entries(sizes).forEach(([sz, qty]) => { acc[sz] = (acc[sz] || 0) + (Number(qty) || 0); });
    return acc;
  }, {}) : {};
  const totalPieces = Object.values(sizeBreakdown).reduce((a, n) => a + n, 0);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', padding: 32, fontFamily: 'Segoe UI,Helvetica,Arial,sans-serif' }}>
      {/* Hidden scanner input — always focused */}
      <form onSubmit={(e) => { e.preventDefault(); const v = inputRef.current?.value || ''; if (inputRef.current) inputRef.current.value = ''; lookup(v); }}>
        <input ref={inputRef} style={{ position: 'absolute', left: -9999, top: -9999, opacity: 0 }} autoFocus />
      </form>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 800 }}>🏷️ Production Scan</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: '#94a3b8' }}>
            {status === 'idle' && 'Scan a job ticket to begin'}
            {status === 'loading' && 'Looking up…'}
            {status === 'notfound' && `No job found for "${lastScan}"`}
            {status === 'error' && `Error: ${errMsg}`}
          </span>
          {onBack && <button onClick={onBack} style={{ background: '#1e293b', color: '#f8fafc', border: '1px solid #334155', padding: '10px 18px', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>← Back</button>}
        </div>
      </div>

      {status === 'idle' && (
        <div style={{ textAlign: 'center', padding: '120px 40px', border: '2px dashed #334155', borderRadius: 16 }}>
          <div style={{ fontSize: 96 }}>📷</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 16 }}>Ready to scan</div>
          <div style={{ fontSize: 16, color: '#94a3b8', marginTop: 8 }}>Scan the barcode on a printed job ticket</div>
        </div>
      )}

      {status === 'notfound' && (
        <div style={{ textAlign: 'center', padding: '120px 40px', border: '2px dashed #7f1d1d', borderRadius: 16, background: '#1e1214' }}>
          <div style={{ fontSize: 96 }}>⚠️</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 16, color: '#fca5a5' }}>No job found</div>
          <div style={{ fontSize: 16, color: '#94a3b8', marginTop: 8 }}>Barcode: <code style={{ color: '#f59e0b' }}>{lastScan}</code></div>
          <div style={{ fontSize: 14, color: '#64748b', marginTop: 16 }}>Check that the ticket was printed from the portal, or ask the artist to re-upload.</div>
        </div>
      )}

      {status === 'found' && queueRow && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
          {/* LEFT: job details */}
          <div style={{ background: '#1e293b', borderRadius: 16, padding: 28 }}>
            <div style={{ fontSize: 14, color: '#94a3b8', fontWeight: 600, letterSpacing: 1 }}>{customer?.name || customer?.alpha_tag || '—'}</div>
            <div style={{ fontSize: 42, fontWeight: 800, marginTop: 4 }}>{queueRow.so_id}</div>
            {so?.memo && <div style={{ fontSize: 20, color: '#cbd5e1', marginTop: 8 }}>{so.memo}</div>}
            <div style={{ display: 'flex', gap: 16, marginTop: 16, fontSize: 14 }}>
              {so?.expected_date && <div><span style={{ color: '#94a3b8' }}>Due:</span> <strong>{so.expected_date}</strong></div>}
              {so?.status && <div><span style={{ color: '#94a3b8' }}>Status:</span> <strong>{so.status.replace(/_/g, ' ')}</strong></div>}
            </div>

            <hr style={{ border: 0, borderTop: '1px solid #334155', margin: '24px 0' }} />

            <div style={{ fontSize: 14, color: '#94a3b8', fontWeight: 600, letterSpacing: 1 }}>ART</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{queueRow.art_name || artFile?.name || 'Untitled'}</div>
            <div style={{ fontSize: 16, color: '#cbd5e1', marginTop: 6 }}>
              {queueRow.deco_type === 'embroidery' ? '🧵 Embroidery' : '🎨 Screen Print'}
              {artFile?.art_size ? '  ·  ' + artFile.art_size : ''}
              {queueRow.file_ext ? '  ·  .' + queueRow.file_ext : ''}
            </div>

            {colors.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600, letterSpacing: 1, marginBottom: 6 }}>
                  {queueRow.deco_type === 'embroidery' ? 'THREAD COLORS' : 'INK COLORS'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {colors.map((c, i) => (
                    <span key={i} style={{ background: '#0f172a', border: '1px solid #334155', padding: '6px 12px', borderRadius: 8, fontSize: 14, fontWeight: 600 }}>{c}</span>
                  ))}
                </div>
              </div>
            )}

            {totalPieces > 0 && (
              <div style={{ marginTop: 20, padding: 16, background: '#0f172a', borderRadius: 8 }}>
                <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600, letterSpacing: 1, marginBottom: 6 }}>PIECES</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{totalPieces} total</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {Object.entries(sizeBreakdown).map(([sz, n]) => (
                    <span key={sz} style={{ background: '#1e293b', padding: '4px 10px', borderRadius: 6, fontSize: 13 }}>
                      <strong>{sz}</strong>: {n}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {so?.production_notes && (
              <div style={{ marginTop: 20, padding: 16, background: '#422006', borderRadius: 8, border: '1px solid #713f12' }}>
                <div style={{ fontSize: 13, color: '#fcd34d', fontWeight: 600, letterSpacing: 1, marginBottom: 6 }}>PRODUCTION NOTES</div>
                <div style={{ fontSize: 15, whiteSpace: 'pre-wrap' }}>{so.production_notes}</div>
              </div>
            )}

            <div style={{ marginTop: 28, display: 'flex', gap: 12 }}>
              <button
                onClick={markStarted}
                disabled={so?.status === 'in_production'}
                style={{
                  flex: 1, padding: '18px 24px', fontSize: 20, fontWeight: 700,
                  background: so?.status === 'in_production' ? '#334155' : '#16a34a',
                  color: '#fff', border: 'none', borderRadius: 12, cursor: so?.status === 'in_production' ? 'default' : 'pointer',
                }}
              >
                {so?.status === 'in_production' ? '✓ Already Started' : '▶ Mark as Started'}
              </button>
            </div>
          </div>

          {/* RIGHT: mockup image */}
          <div style={{ background: '#1e293b', borderRadius: 16, padding: 28, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 14, color: '#94a3b8', fontWeight: 600, letterSpacing: 1, marginBottom: 12 }}>MOCKUP</div>
            {mockupUrl ? (
              <img src={mockupUrl} alt="" style={{ width: '100%', background: '#fff', borderRadius: 8, objectFit: 'contain', maxHeight: 480 }} />
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed #334155', borderRadius: 8, minHeight: 320, color: '#64748b' }}>
                No mockup on file
              </div>
            )}
            <div style={{ marginTop: 16, fontSize: 12, color: '#64748b' }}>
              Scanned: <code style={{ color: '#94a3b8' }}>{queueRow.barcode_value}</code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProductionScanView;
