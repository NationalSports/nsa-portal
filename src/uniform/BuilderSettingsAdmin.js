/* eslint-disable */
// Settings → Uniform Builder — staff-managed builder registries.
//
// Three tabs, each editing one uniform_settings row:
//   • Designs   — the per-sport "pick a starting design" gallery, with live
//                 rendered thumbnails so staff see exactly what coaches will
//   • Numbering — the lettering styles coaches pick from (font + outline)
//   • Colors    — the team-color palette offered across the whole wizard
//
// Coaches always have safe built-in defaults; nothing here can break the
// builder (payloads are sanitized again on load).

import React, { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_NUMBER_STYLES, DEFAULT_PALETTE, DEFAULT_PRESETS,
  loadBuilderSettings, saveBuilderSetting,
} from './builderSettings';
import { FONTS as FONT_LIBRARY, fontShorthand, ensureFontsReady } from './fonts';
import { renderToDataURL } from './renderCanvas';
import * as ds from './designSpec';

const SPORTS = [
  { key: 'football', label: 'Football' }, { key: 'basketball', label: 'Basketball' },
  { key: 'volleyball', label: 'Volleyball' }, { key: 'baseball', label: 'Baseball' },
  { key: 'track', label: 'Track & Field' }, { key: 'soccer', label: 'Soccer' },
];
const PATTERN_OPTIONS = ds.PATTERNS;

const zoneOf = (z) => ({ color: z.color, color2: z.color2, pattern: z.pattern || 'solid' });
function presetSpec(p) {
  const S = p.config.sections;
  return ds.normalizeSpec({
    garmentId: 'sahrul_jersey', fabric: 'sublimated',
    zones: { body: zoneOf(S.body), sleeveL: zoneOf(S.sleeves), sleeveR: zoneOf(S.sleeves), collar: zoneOf(S.collar) },
    text: { front: { number: { value: '10', font: 'anton', fill: p.config.numberColor, size: 0.9 } } },
  });
}

const card = { background: '#fff', border: '1px solid #e2e5ec', borderRadius: 8, padding: 16 };
const label = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: '#5A6075', display: 'block', marginBottom: 4 };
const input = { width: '100%', boxSizing: 'border-box', border: '1px solid #cdd2dd', borderRadius: 5, padding: '7px 9px', fontSize: 13 };

export default function BuilderSettingsAdmin() {
  const [tab, setTab] = useState('designs');
  const [presets, setPresets] = useState(null);
  const [styles, setStyles] = useState(null);
  const [palette, setPalette] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [thumbs, setThumbs] = useState({});
  const thumbTimer = useRef(null);

  useEffect(() => {
    loadBuilderSettings().then((s) => {
      setPresets(s.presets.map((p) => ({ ...p, config: { ...p.config, sections: { ...p.config.sections } } })));
      setStyles(s.numberStyles.map((x) => ({ ...x })));
      setPalette(s.palette.map((x) => ({ ...x })));
    });
  }, []);

  // Debounced live thumbnails for the Designs tab.
  useEffect(() => {
    if (!presets) return;
    if (thumbTimer.current) clearTimeout(thumbTimer.current);
    thumbTimer.current = setTimeout(async () => {
      try { await ensureFontsReady(); } catch (_e) {}
      for (const p of presets) {
        try {
          const url = await renderToDataURL(presetSpec(p), { view: 'front', width: 220 });
          setThumbs((t) => ({ ...t, [p.id]: url }));
        } catch (_e) { /* thumb optional */ }
      }
    }, 350);
    return () => { if (thumbTimer.current) clearTimeout(thumbTimer.current); };
  }, [presets]);

  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 2500); };
  const save = async (key, value, resetter) => {
    setBusy(key); setErr('');
    try {
      const clean = await saveBuilderSetting(key, value);
      resetter(clean.map((x) => (key === 'presets' ? { ...x, config: { ...x.config, sections: { ...x.config.sections } } } : { ...x })));
      flash('Saved — live for all coaches.');
    } catch (e) { setErr('Save failed — ' + (e.message || e)); }
    setBusy('');
  };

  const setPreset = (i, patch) => setPresets((ps) => ps.map((p, ix) => (ix === i ? { ...p, ...patch } : p)));
  const setPresetZone = (i, zoneKey, patch) => setPresets((ps) => ps.map((p, ix) => (ix === i ? {
    ...p, config: { ...p.config, sections: { ...p.config.sections, [zoneKey]: { ...p.config.sections[zoneKey], ...patch } } },
  } : p)));
  const setPresetNumber = (i, hex) => setPresets((ps) => ps.map((p, ix) => (ix === i ? { ...p, config: { ...p.config, numberColor: hex } } : p)));

  if (!presets || !styles || !palette) return <div style={{ padding: 30, color: '#5A6075' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 1060 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['designs', 'Designs'], ['numbering', 'Numbering'], ['colors', 'Colors']].map(([k, l]) => (
          <button key={k} className={'btn btn-sm ' + (tab === k ? 'btn-primary' : 'btn-secondary')} onClick={() => setTab(k)}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        {msg && <span style={{ color: '#0B6E4F', fontSize: 13, alignSelf: 'center' }}>{msg}</span>}
        {err && <span style={{ color: '#962C32', fontSize: 13, alignSelf: 'center' }}>{err}</span>}
      </div>

      {tab === 'designs' && (
        <div>
          <div style={{ fontSize: 13, color: '#5A6075', marginBottom: 14 }}>
            The "Pick a Starting Design" gallery coaches see. A design with no sports checked shows for <b>every</b> sport; check sports to scope it.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: 14 }}>
            {presets.map((p, i) => (
              <div key={p.id} style={{ ...card, display: 'flex', gap: 14 }}>
                <div style={{ width: 120, flexShrink: 0 }}>
                  {thumbs[p.id]
                    ? <img src={thumbs[p.id]} alt={p.name} style={{ width: '100%', border: '1px solid #eef0f5', borderRadius: 6, background: '#fff' }} />
                    : <div style={{ width: '100%', aspectRatio: '760/900', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#98a0b3', fontSize: 11, border: '1px dashed #d7dbe3', borderRadius: 6 }}>Preview…</div>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input style={{ ...input, fontWeight: 700, marginBottom: 8 }} value={p.name} maxLength={26} onChange={(e) => setPreset(i, { name: e.target.value })} />
                  {[['body', 'Body'], ['sleeves', 'Sleeves'], ['collar', 'Collar']].map(([zk, zl]) => {
                    const z = p.config.sections[zk];
                    return (
                      <div key={zk} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ width: 52, fontSize: 11, fontWeight: 700, color: '#5A6075', textTransform: 'uppercase' }}>{zl}</span>
                        <input type="color" value={z.color} onChange={(e) => setPresetZone(i, zk, { color: e.target.value.toUpperCase() })} style={{ width: 30, height: 26, border: 'none', background: 'none', padding: 0 }} title="Primary" />
                        <select value={z.pattern} onChange={(e) => setPresetZone(i, zk, { pattern: e.target.value })} style={{ ...input, width: 118, padding: '5px 6px', fontSize: 12 }}>
                          {PATTERN_OPTIONS.map((po) => <option key={po.id} value={po.id}>{po.label}</option>)}
                        </select>
                        {z.pattern !== 'solid' && <input type="color" value={z.color2 || '#FFFFFF'} onChange={(e) => setPresetZone(i, zk, { color2: e.target.value.toUpperCase() })} style={{ width: 30, height: 26, border: 'none', background: 'none', padding: 0 }} title="Secondary" />}
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span style={{ width: 52, fontSize: 11, fontWeight: 700, color: '#5A6075', textTransform: 'uppercase' }}>Number</span>
                    <input type="color" value={p.config.numberColor} onChange={(e) => setPresetNumber(i, e.target.value.toUpperCase())} style={{ width: 30, height: 26, border: 'none', background: 'none', padding: 0 }} />
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {SPORTS.map((sp) => {
                      const on = (p.sports || []).includes(sp.key);
                      return (
                        <button key={sp.key} onClick={() => setPreset(i, { sports: on ? p.sports.filter((x) => x !== sp.key) : [...(p.sports || []), sp.key] })}
                          style={{ fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 4, cursor: 'pointer', border: '1px solid ' + (on ? '#192853' : '#cdd2dd'), background: on ? '#192853' : '#fff', color: on ? '#fff' : '#3d4356' }}>
                          {sp.label}
                        </button>
                      );
                    })}
                  </div>
                  <button className="btn btn-xs btn-secondary" style={{ color: '#962C32' }} onClick={() => setPresets((ps) => ps.filter((_, ix) => ix !== i))}>Remove design</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setPresets((ps) => [...ps, {
              id: 'preset_' + Date.now().toString(36), name: 'New Design', sports: [],
              config: { numberColor: '#FFFFFF', sections: { body: { color: '#192853', color2: '#FFFFFF', pattern: 'solid' }, sleeves: { color: '#962C32', color2: '#FFFFFF', pattern: 'solid' }, collar: { color: '#962C32', color2: '#FFFFFF', pattern: 'solid' } } },
            }])}>+ Add design</button>
            <button className="btn btn-sm btn-secondary" onClick={() => setPresets(DEFAULT_PRESETS.map((p) => ({ ...p, config: { ...p.config, sections: { ...p.config.sections } } })))}>Restore defaults</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-sm btn-primary" disabled={busy === 'presets' || presets.length === 0} onClick={() => save('presets', presets, setPresets)}>{busy === 'presets' ? 'Saving…' : 'Save designs'}</button>
          </div>
        </div>
      )}

      {tab === 'numbering' && (
        <div>
          <div style={{ fontSize: 13, color: '#5A6075', marginBottom: 14 }}>
            Lettering styles coaches choose for names &amp; numbers. Each style is a font plus an optional outline-only treatment.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {styles.map((st, i) => {
              const fdef = FONT_LIBRARY.find((f) => f.id === st.font) || FONT_LIBRARY[0];
              return (
                <div key={st.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 74, height: 58, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#192853', borderRadius: 6, flexShrink: 0 }}>
                    <span style={{ font: fontShorthand(st.font, 34), color: st.hollow ? 'transparent' : '#fff', WebkitTextStroke: st.hollow ? '1.6px #fff' : undefined }}>23</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <input style={{ ...input, marginBottom: 6 }} value={st.label} maxLength={18} onChange={(e) => setStyles((xs) => xs.map((x, ix) => (ix === i ? { ...x, label: e.target.value } : x)))} />
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select value={st.font} onChange={(e) => setStyles((xs) => xs.map((x, ix) => (ix === i ? { ...x, font: e.target.value } : x)))} style={{ ...input, flex: 1, padding: '5px 6px', fontSize: 12 }}>
                        {FONT_LIBRARY.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                      </select>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#3d4356', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={!!st.hollow} onChange={(e) => setStyles((xs) => xs.map((x, ix) => (ix === i ? { ...x, hollow: e.target.checked } : x)))} /> Outline
                      </label>
                      <button className="btn btn-xs btn-secondary" style={{ color: '#962C32' }} onClick={() => setStyles((xs) => xs.filter((_, ix) => ix !== i))}>✕</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setStyles((xs) => [...xs, { id: 'style_' + Date.now().toString(36), label: 'New Style', font: FONT_LIBRARY[0].id, hollow: false }])}>+ Add style</button>
            <button className="btn btn-sm btn-secondary" onClick={() => setStyles(DEFAULT_NUMBER_STYLES.map((x) => ({ ...x })))}>Restore defaults</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-sm btn-primary" disabled={busy === 'numberStyles' || styles.length === 0} onClick={() => save('numberStyles', styles, setStyles)}>{busy === 'numberStyles' ? 'Saving…' : 'Save styles'}</button>
          </div>
        </div>
      )}

      {tab === 'colors' && (
        <div>
          <div style={{ fontSize: 13, color: '#5A6075', marginBottom: 14 }}>
            The team-color swatches offered throughout the builder (sections, numbers, trim). Order here is the order coaches see.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
            {palette.map((c, i) => (
              <div key={i} style={{ ...card, padding: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" value={c.hex} onChange={(e) => setPalette((ps) => ps.map((x, ix) => (ix === i ? { ...x, hex: e.target.value.toUpperCase() } : x)))} style={{ width: 34, height: 30, border: 'none', background: 'none', padding: 0, flexShrink: 0 }} />
                <input style={{ ...input, flex: 1 }} value={c.name} maxLength={18} onChange={(e) => setPalette((ps) => ps.map((x, ix) => (ix === i ? { ...x, name: e.target.value } : x)))} />
                <button className="btn btn-xs btn-secondary" style={{ color: '#962C32', flexShrink: 0 }} onClick={() => setPalette((ps) => ps.filter((_, ix) => ix !== i))}>✕</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setPalette((ps) => [...ps, { hex: '#192853', name: 'New Color' }])}>+ Add color</button>
            <button className="btn btn-sm btn-secondary" onClick={() => setPalette(DEFAULT_PALETTE.map((x) => ({ ...x })))}>Restore defaults</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-sm btn-primary" disabled={busy === 'palette' || palette.length < 2} onClick={() => save('palette', palette, setPalette)}>{busy === 'palette' ? 'Saving…' : 'Save colors'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
