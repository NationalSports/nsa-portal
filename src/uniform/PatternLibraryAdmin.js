/* eslint-disable */
// Settings → Uniform Patterns — admin-curated print-pattern library.
//
// Staff upload seamless pattern tiles here; every coach's uniform builder
// lists them alongside the built-in patterns (each jersey section can use
// one as its fill). Tiles are downscaled client-side to <=512px and stored
// inline in public.uniform_patterns (RLS: public read, staff-only writes).

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const MAX_TILE_PX = 512;

function downscaleToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
        const k = Math.min(1, MAX_TILE_PX / Math.max(iw, ih));
        const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Could not read image'));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export default function PatternLibraryAdmin() {
  const [rows, setRows] = useState(null); // null = loading
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [pendingImg, setPendingImg] = useState(null);
  const [pendingTint, setPendingTint] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    try {
      const { data, error } = await supabase.from('uniform_patterns')
        .select('id,name,image,active,tintable,created_at').order('created_at', { ascending: false });
      if (error) throw error;
      setRows(data || []); setErr('');
    } catch (e) { setRows([]); setErr('Could not load patterns — ' + (e.message || e)); }
  };
  useEffect(() => { load(); }, []);

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      setPendingImg(await downscaleToDataURL(file));
      if (!name) setName(file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '));
    } catch (ex) { setErr(String(ex.message || ex)); }
    if (fileRef.current) fileRef.current.value = '';
  };

  const add = async () => {
    if (!pendingImg || !name.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('uniform_patterns').insert({ name: name.trim(), image: pendingImg, active: true, tintable: pendingTint });
      if (error) throw error;
      setName(''); setPendingImg(null); setPendingTint(false);
      await load();
    } catch (e) { setErr('Save failed — ' + (e.message || e) + '. Are you signed in?'); }
    setBusy(false);
  };

  const toggle = async (r) => {
    try {
      const { error } = await supabase.from('uniform_patterns').update({ active: !r.active }).eq('id', r.id);
      if (error) throw error;
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)));
    } catch (e) { setErr('Update failed — ' + (e.message || e)); }
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete pattern "${r.name}"? Designs already using it keep their copy.`)) return;
    try {
      const { error } = await supabase.from('uniform_patterns').delete().eq('id', r.id);
      if (error) throw error;
      setRows((rs) => rs.filter((x) => x.id !== r.id));
    } catch (e) { setErr('Delete failed — ' + (e.message || e)); }
  };

  return (
    <div className="card">
      <div className="card-body" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px', color: '#1e293b' }}>Uniform Builder — Print Patterns</h3>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          Upload <strong>seamless</strong> pattern tiles (they repeat across the fabric). Active patterns appear
          in every coach's uniform builder as section fills, next to the built-in patterns. Uploads are
          downscaled to {MAX_TILE_PX}px.
        </div>
        {err && <div style={{ padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', fontSize: 13, marginBottom: 14 }}>{err}</div>}

        {/* uploader */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', padding: 14, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 20 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#334155' }}>
            Pattern name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Digital Wave" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14, minWidth: 220 }} />
          </label>
          <label className="btn btn-sm btn-secondary" style={{ cursor: 'pointer' }}>
            {pendingImg ? 'Change image' : 'Choose image…'}
            <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
          </label>
          {pendingImg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div title="Tiled preview" style={{ width: 96, height: 48, borderRadius: 6, border: '1px solid #cbd5e1', backgroundImage: `url(${pendingImg})`, backgroundSize: '32px 32px', backgroundRepeat: 'repeat' }} />
              <label title="Grayscale tile recolored with each team's colors: white = primary, black = secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
                <input type="checkbox" checked={pendingTint} onChange={(e) => setPendingTint(e.target.checked)} /> Tintable (grayscale)
              </label>
              <button className="btn btn-sm btn-primary" disabled={busy || !name.trim()} onClick={add}>{busy ? 'Saving…' : 'Add pattern'}</button>
              <button className="btn btn-sm btn-secondary" onClick={() => setPendingImg(null)}>Cancel</button>
            </div>
          )}
        </div>

        {/* library */}
        {rows === null ? (
          <div style={{ color: '#64748b', fontSize: 13 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 13 }}>No patterns yet — upload the first one above.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
            {rows.map((r) => (
              <div key={r.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', background: '#fff', opacity: r.active ? 1 : 0.55 }}>
                <div style={{ height: 84, backgroundImage: `url(${r.image})`, backgroundSize: '42px 42px', backgroundRepeat: 'repeat' }} />
                <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}{r.tintable && <span title="Recolors with team colors" style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#0B6E4F', border: '1px solid #0B6E4F', borderRadius: 3, padding: '1px 4px', verticalAlign: 'middle' }}>TINT</span>}</div>
                    <div style={{ fontSize: 11, color: r.active ? '#15803d' : '#64748b' }}>{r.active ? 'Live in builder' : 'Hidden'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="btn btn-xs btn-secondary" onClick={() => toggle(r)}>{r.active ? 'Hide' : 'Show'}</button>
                    <button className="btn btn-xs btn-secondary" style={{ color: '#b91c1c' }} onClick={() => remove(r)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
