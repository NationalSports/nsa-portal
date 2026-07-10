import React, { useMemo, useState } from 'react';
import DecoOverlay from '../lib/decoOverlay';
import {
  zonesForGarment, clampPlacement, buildDecoSpec, specToOverlayProps, validateSpec,
  DECO_METHODS, DEFAULT_STITCHES, DTF_SIZES, MAX_SP_COLORS,
} from './decoSpec';

// Stage 4 garment → logo placement picker. Pure UI shell over the decoSpec
// engine (src/teamshop/decoSpec.js) and the shared DecoOverlay renderer
// (src/lib/decoOverlay.js) — this component never computes a placement or
// pricing field itself; every nudge/resize routes through clampPlacement and
// the confirm step routes through buildDecoSpec + validateSpec.
//
// props: { product, logo, onDone(decoSpec), onBack }

const METHOD_LABELS = { embroidery: 'Embroidery', screen_print: 'Screen Print', dtf: 'DTF Print' };
const NUDGE_STEP = 1; // percent points per arrow-button press
const SCALE_STEP = 0.05; // × zone default width per size button press

function ZoneChip({ zone, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? '#0f172a' : '#cbd5e1'}`,
        background: active ? '#0f172a' : '#fff',
        color: active ? '#fff' : '#0f172a',
        borderRadius: 999,
        padding: '6px 14px',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {zone.label} <span style={{ opacity: 0.7, fontWeight: 400 }}>({zone.side})</span>
    </button>
  );
}

// Outline box for a zone, used both as the "pick a spot" affordance on the
// placeholder (no garment photo) and as a light guide under the live overlay.
function ZoneOutline({ zone, active }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${zone.x}%`,
        top: `${zone.y}%`,
        width: `${zone.w}%`,
        transform: 'translate(-50%,-50%)',
        border: `1px dashed ${active ? '#0f172a' : '#94a3b8'}`,
        borderRadius: 4,
        padding: '10px 4px',
        textAlign: 'center',
        fontSize: 10,
        color: active ? '#0f172a' : '#94a3b8',
        pointerEvents: 'none',
      }}
    >
      {zone.label}
    </div>
  );
}

export default function PlacementPicker({ product, logo, onDone, onBack }) {
  const zones = useMemo(() => zonesForGarment(product), [product]);
  const [zoneId, setZoneId] = useState(() => (zones[0] && zones[0].id) || null);
  const zone = useMemo(() => zones.find((z) => z.id === zoneId) || zones[0] || null, [zones, zoneId]);

  const [place, setPlace] = useState(() => (zone ? { x: zone.x, y: zone.y, w: zone.w } : { x: 0, y: 0, w: 0 }));
  const [side, setSide] = useState(() => (zone ? zone.side : 'front'));
  const [method, setMethod] = useState(DECO_METHODS[0]);
  const [colors, setColors] = useState(1);
  const [dtfSize, setDtfSize] = useState(0);

  const selectZone = (z) => {
    setZoneId(z.id);
    setSide(z.side);
    setPlace({ x: z.x, y: z.y, w: z.w }); // reset to the zone default on selection
  };

  const nudge = (dx, dy) => {
    if (!zone) return;
    setPlace((p) => clampPlacement(zone, { ...p, x: p.x + dx, y: p.y + dy }));
  };
  const resize = (dw) => {
    if (!zone) return;
    setPlace((p) => clampPlacement(zone, { ...p, w: p.w + dw }));
  };

  const options = useMemo(() => {
    if (method === 'screen_print') return { colors };
    if (method === 'embroidery') return { stitches: DEFAULT_STITCHES };
    if (method === 'dtf') return { dtf_size: dtfSize };
    return {};
  }, [method, colors, dtfSize]);

  const { spec, error } = useMemo(() => {
    if (!zone || !logo) return { spec: null, error: 'Pick a placement zone.' };
    try {
      const built = buildDecoSpec({ zone, placement: place, logo, method, options, side });
      const check = validateSpec(built);
      if (!check.ok) return { spec: null, error: check.reason };
      return { spec: built, error: null };
    } catch (e) {
      return { spec: null, error: e.message || 'Invalid placement' };
    }
  }, [zone, place, logo, method, options, side]);

  const previewSpec = spec || (zone && logo ? { art_url: logo.url, side, x: place.x, y: place.y, w: place.w, placement: zone.id } : null);
  const overlayProps = previewSpec ? specToOverlayProps(previewSpec) : null;

  const imgUrl = side === 'back' ? (product && product.image_back_url) : (product && (product.image_front_url || product.image_url));
  const hasBack = !!(product && product.image_back_url);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <button
        type="button"
        onClick={onBack}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: '#64748b', marginBottom: 12, fontFamily: 'inherit' }}
      >
        ← Back
      </button>

      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>
        {(product && (product.name || product.sku)) || 'Placement'}
      </h1>
      <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px' }}>
        Placing {(logo && logo.name) || 'your logo'} on this garment.
      </p>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        {/* Garment preview */}
        <div style={{ flex: '1 1 320px', maxWidth: 420 }}>
          {hasBack && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {['front', 'back'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  style={{
                    border: `1px solid ${side === s ? '#0f172a' : '#cbd5e1'}`,
                    background: side === s ? '#0f172a' : '#fff',
                    color: side === s ? '#fff' : '#0f172a',
                    borderRadius: 8,
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textTransform: 'capitalize',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div style={{ position: 'relative', aspectRatio: '1 / 1', background: '#f1f5f9', borderRadius: 10, overflow: 'hidden' }}>
            {imgUrl ? (
              <img src={imgUrl} alt={(product && product.name) || ''} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <>
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#94a3b8' }}>
                  No photo
                </span>
                {zones.filter((z) => z.side === side).map((z) => (
                  <ZoneOutline key={z.id} zone={z} active={zone && z.id === zone.id} />
                ))}
              </>
            )}
            {overlayProps && overlayProps.side === side && <DecoOverlay {...overlayProps} />}
          </div>

          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
            Preview is approximate — our art team finalizes placement.
          </p>
        </div>

        {/* Controls */}
        <div style={{ flex: '1 1 320px', minWidth: 280 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b' }}>
            Zone
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {zones.map((z) => (
              <ZoneChip key={z.id} zone={z} active={zone && z.id === zone.id} onClick={() => selectZone(z)} />
            ))}
            {!zones.length && <span style={{ fontSize: 13, color: '#94a3b8' }}>No placement zones for this product.</span>}
          </div>

          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b' }}>
            Nudge &amp; size
          </h2>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 32px)', gridTemplateRows: 'repeat(3, 32px)', gap: 2 }}>
              <span />
              <button type="button" aria-label="Move up" onClick={() => nudge(0, -NUDGE_STEP)} style={btnStyle} disabled={!zone}>↑</button>
              <span />
              <button type="button" aria-label="Move left" onClick={() => nudge(-NUDGE_STEP, 0)} style={btnStyle} disabled={!zone}>←</button>
              <span />
              <button type="button" aria-label="Move right" onClick={() => nudge(NUDGE_STEP, 0)} style={btnStyle} disabled={!zone}>→</button>
              <span />
              <button type="button" aria-label="Move down" onClick={() => nudge(0, NUDGE_STEP)} style={btnStyle} disabled={!zone}>↓</button>
              <span />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" aria-label="Smaller" onClick={() => resize(-SCALE_STEP * (zone ? zone.w : 1))} style={btnStyle} disabled={!zone}>−</button>
              <span style={{ fontSize: 13, color: '#64748b' }}>Size</span>
              <button type="button" aria-label="Larger" onClick={() => resize(SCALE_STEP * (zone ? zone.w : 1))} style={btnStyle} disabled={!zone}>+</button>
            </div>
          </div>

          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b' }}>
            Decoration method
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {DECO_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                style={{
                  border: `1px solid ${method === m ? '#0f172a' : '#cbd5e1'}`,
                  background: method === m ? '#0f172a' : '#fff',
                  color: method === m ? '#fff' : '#0f172a',
                  borderRadius: 8,
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {METHOD_LABELS[m] || m}
              </button>
            ))}
          </div>

          {method === 'embroidery' && (
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
              Standard stitch count ({DEFAULT_STITCHES.toLocaleString()} stitches) — our digitizer adjusts as needed.
            </p>
          )}

          {method === 'screen_print' && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 8px' }}>Number of colors</p>
              <div style={{ display: 'flex', gap: 6 }}>
                {Array.from({ length: MAX_SP_COLORS }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setColors(n)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      border: `1px solid ${colors === n ? '#0f172a' : '#cbd5e1'}`,
                      background: colors === n ? '#0f172a' : '#fff',
                      color: colors === n ? '#fff' : '#0f172a',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {method === 'dtf' && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 8px' }}>Print size</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {DTF_SIZES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setDtfSize(s.value)}
                    style={{
                      border: `1px solid ${dtfSize === s.value ? '#0f172a' : '#cbd5e1'}`,
                      background: dtfSize === s.value ? '#0f172a' : '#fff',
                      color: dtfSize === s.value ? '#fff' : '#0f172a',
                      borderRadius: 8,
                      padding: '6px 14px',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={!spec}
            onClick={() => spec && onDone && onDone(spec)}
            style={{
              background: spec ? '#0f172a' : '#e2e8f0',
              color: spec ? '#fff' : '#94a3b8',
              border: 'none',
              borderRadius: 8,
              padding: '12px 24px',
              fontSize: 15,
              fontWeight: 700,
              cursor: spec ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
            }}
          >
            Confirm placement
          </button>
          {!spec && error && (
            <p style={{ fontSize: 13, color: '#dc2626', marginTop: 8 }}>{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  width: 32,
  height: 32,
  border: '1px solid #cbd5e1',
  background: '#fff',
  borderRadius: 6,
  fontSize: 14,
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: '#0f172a',
};
