import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  NAVY, RED, BORDER, BORDER_DARK, TEXT, TEXT_MUTED, TEXT_FAINT, GREEN, OFF_WHITE, displayType,
} from './theme';
import DecoOverlay from '../lib/decoOverlay';
import {
  zonesForGarment, clampPlacement, buildDecoSpec, specToOverlayProps, validateSpec,
  SCALE_MIN, SCALE_MAX, DEFAULT_STITCHES,
} from './decoSpec';
import LogoPicker from './LogoPicker';
import { categoryForProduct } from './categories';
import useCoachSession from './useCoachSession';

// Product detail page — REPLACES the earlier simple ProductPage.js with the
// approved two-column "Product Builder" Claude Design mockup (see
// /product-builder-spec.md): a sticky live garment preview (left) and a
// config panel (right) that now does logo pick / size&place / optional
// text-under-logo / color / method / a size-run qty grid, all inline, in
// place of the old "Customize with your logo" hand-off to a separate screen.
//
// props: { product, customer, onBack, onCustomize, onAddBlank, onAddToOrder }
//   - customer: signed-in coach's team (nullable — anonymous browsing).
//   - onCustomize(product): anonymous-only gate. The anonymous top-level
//     catalog has no cart to add to, so any "sign-in-required" action here
//     (picking/uploading a logo, Add to order) calls this — same handoff to
//     StartWithLogo the rest of the app already uses for every
//     "Start with your logo" CTA (see TeamShopApp.js's previewCustomize).
//   - onAddBlank(product): unchanged from the prior stage — signed-in catalog
//     context only, adds the garment to cart with no decoration.
//   - onAddToOrder(lines): signed-in only. Called with an array of cart-line
//     objects (see buildLines below) once "Add to order" produces a
//     validateSpec-passing decoSpec and at least one sized quantity; the
//     caller (TeamShopApp) adds each line via cart.js's addLine and
//     navigates to the cart view.
//
// This component NEVER computes a price — every number on screen comes back
// from a server call. This is a RETAIL-FORWARD storefront, so real prices
// show to everyone, signed in or not:
//   - signed in with a team chosen -> netlify/functions/quickorder-quote.js
//     (coach bearer token + customer_id), the SAME authed call CartPage.js
//     makes, so a coach sees their real team/tier pricing live here, not
//     just at checkout ("Your team pricing" tag).
//   - anonymous, or signed in with no team chosen yet ->
//     netlify/functions/teamshop-public-price.js, a new public (no-auth)
//     endpoint that reuses quickorder-quote.js's exported unitSell/cleanDeco
//     helpers for a standard-retail estimate (no duplicated pricing math).
// Both are fetched with the same 500ms debounce CartPage.js uses, on every
// pricing-relevant change (product, method/placement/logo via `spec`, and
// each size-run quantity). A fetch failure shows a neutral "Pricing
// unavailable" message — never a fabricated number.
//
// decoSpec.js remains the single source of truth for placement geometry: the
// logo-size slider only ever feeds a %-of-zone-width into clampPlacement, it
// never writes x/y/w itself. The mockup's slider range (55-175%) is widened
// past decoSpec's actual clamp bounds (SCALE_MIN/SCALE_MAX = 0.6x-1.4x); per
// the wiring rule "do NOT invent your own geometry", the slider here is
// capped to the REAL bounds (60%-140%) instead of showing a range that would
// silently get re-clamped underneath the coach.

const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const ROSTER_KEY = 'nts_roster'; // same key Catalog.js's roster sidebar widget uses
const MIN_PIECES = 12; // design minimum per the approved spec
const DEBOUNCE_MS = 500; // matches CartPage.js's quote debounce exactly
const SIZE_MIN_PCT = Math.round(SCALE_MIN * 100); // 60
const SIZE_MAX_PCT = Math.round(SCALE_MAX * 100); // 140
const TEXT_MIN_PCT = 70;
const TEXT_MAX_PCT = 170;

// Real, priced methods only — the exact 3 PlacementPicker.js already offers.
// TODO(method-mapping): the approved mockup's 3rd tile was "Heat Press
// (Names/#s)". decoPricing.js/decoSpec.js model exactly 3 priced methods —
// screen_print, embroidery, dtf — there is no "heat press" method to wire up.
// This renders the real 3rd method (Screen Print) instead of inventing an
// unpriced option; label/notes reflect what actually prices, not the mockup's copy.
const METHODS = [
  { key: 'embroidery', label: 'Embroidery', note: 'Textured stitching' },
  { key: 'dtf', label: 'DTF Print', note: 'Full-color, no color limit' },
  { key: 'screen_print', label: 'Screen Print', note: 'Names & numbers' },
];
const METHOD_PILL_LABEL = { embroidery: 'Embroidered', dtf: 'DTF Print', screen_print: 'Screen Print' };

// Cosmetic-only garment-color backgrounds for the live preview card. Real
// product color data is a single `color` string (see the TODO(colors) note
// below) — this is just a small, best-effort name→swatch map for the preview
// background, not a real colorway system.
const COLOR_BG = {
  navy: '#192853', black: '#1b1e24', white: '#f5f6f8', red: '#962c32', 'team red': '#962c32',
  gray: '#8790a5', grey: '#8790a5', charcoal: '#36393f', royal: '#1e40af', maroon: '#5b1a24',
  green: '#2f6b45', 'forest green': '#1f4d34', graphite: '#2A2F3E', steel: '#5A6075',
};
const LIGHT_BG = new Set(['white', '#f5f6f8']);
const bgForColor = (name) => COLOR_BG[String(name || '').trim().toLowerCase()] || '#DFE3EA';
const inkForColor = (name) => (LIGHT_BG.has(String(name || '').trim().toLowerCase()) ? NAVY : '#fff');

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

function loadRoster() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(ROSTER_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function StepLabel({ children }) {
  return <span style={displayType(14, { letterSpacing: '0.08em', color: NAVY, display: 'block', marginBottom: 12 })}>{children}</span>;
}

export default function ProductPage({ product, customer, onBack, onCustomize, onAddBlank, onAddToOrder }) {
  const { accessToken } = useCoachSession();
  const customerId = customer && customer.id;
  const signedIn = !!(customerId && accessToken);

  const brand = (product && product.brand) || '';
  const name = (product && (product.name || product.sku)) || '';
  const sku = product && product.sku;
  const colorName = product && product.color;
  // TODO(product-colorways): colorways.js/Catalog.js/CatalogCard.js now group
  // same-style rows into style cards with a colorway picker. Doing the same
  // here (accept an optional `siblings` prop, render the pill row, swap the
  // shown product client-side) was assessed and skipped for THIS pass: nearly
  // every derived value below (sizes, zones, sku, colorName, the quote fetch's
  // dependency array, the cart line built in handleAddToOrder) is keyed off
  // `product`, so "switch the shown product" is a real refactor of this
  // file's data flow, not a small additive change — and this file has
  // existing coverage (productPage.test.js) that assumes a single product
  // prop. Left as a real follow-up rather than a half-wired feature.
  // Breadcrumb: the launch-category label (categories.js) this product
  // belongs to, so the crumb reads like the catalog's own category chips —
  // falls back to 'All Products' for anything outside the launch set.
  const launchCategory = categoryForProduct(product);
  const category = launchCategory ? launchCategory.label : 'All Products';
  const sizes = useMemo(() => (
    (product && Array.isArray(product.available_sizes) && product.available_sizes.length)
      ? product.available_sizes
      : DEFAULT_SIZES
  ), [product]);

  const zones = useMemo(() => zonesForGarment(product), [product]);
  const [zoneId, setZoneId] = useState(() => (zones[0] && zones[0].id) || null);
  const zone = useMemo(() => zones.find((z) => z.id === zoneId) || zones[0] || null, [zones, zoneId]);
  const [view, setView] = useState(() => (zone ? zone.side : 'front'));

  const [logo, setLogo] = useState(null);
  const [logoScalePct, setLogoScalePct] = useState(100);
  const [method, setMethod] = useState('embroidery');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [textScalePct, setTextScalePct] = useState(100);
  const [qtyBySize, setQtyBySize] = useState(() => Object.fromEntries(sizes.map((s) => [s, 0])));
  const [rosterHint, setRosterHint] = useState('');
  const [addError, setAddError] = useState('');

  // A newly-previewed product resets zone/view/quantities so stale state from
  // the last garment never leaks in.
  useEffect(() => {
    setZoneId((zones[0] && zones[0].id) || null);
    setQtyBySize(Object.fromEntries(sizes.map((s) => [s, 0])));
    setLogo(null);
    setLine1('');
    setLine2('');
  }, [product, zones, sizes]);

  useEffect(() => { if (zone) setView(zone.side); }, [zone]);

  const selectZone = (z) => { setZoneId(z.id); setView(z.side); };

  // The ONLY place x/y/w are derived — always through clampPlacement, at the
  // zone's default x/y, with w = zone default width scaled by the slider %.
  const placement = useMemo(() => {
    if (!zone) return null;
    return clampPlacement(zone, { x: zone.x, y: zone.y, w: zone.w * (logoScalePct / 100) });
  }, [zone, logoScalePct]);

  const options = useMemo(() => {
    if (method === 'embroidery') return { stitches: DEFAULT_STITCHES };
    if (method === 'dtf') return { dtf_size: 0 };
    if (method === 'screen_print') return { colors: 1 };
    return {};
  }, [method]);

  const spec = useMemo(() => {
    if (!zone || !logo || !placement) return null;
    try {
      const built = buildDecoSpec({ zone, placement, logo, method, options, side: zone.side });
      const check = validateSpec(built);
      if (!check.ok) return null;
      // TEXT-UNDER-LOGO: a new feature the pricing/production backend does
      // not model at all. Carried ONLY as optional metadata on the spec —
      // never folded into pricing, never assumed to reach production.
      // TODO(text-personalization): quickorder-quote.js's cleanDeco() only
      // reads type/colors|stitches|dtf_size|underbase, so this field is
      // inert there; a real personalization pipeline needs its own field
      // and its own priced line before this reaches an order.
      if (line1.trim() || line2.trim()) {
        return { ...built, text: { line1: line1.slice(0, 24), line2: line2.slice(0, 24), scale: textScalePct } };
      }
      return built;
    } catch {
      return null;
    }
  }, [zone, logo, placement, method, options, line1, line2, textScalePct]);

  const overlayProps = spec ? specToOverlayProps(spec, colorName) : null;
  const showDecoChrome = !!(spec && spec.side === view);

  // ---- Size run ----
  const sizeRows = useMemo(
    () => sizes.filter((s) => (qtyBySize[s] || 0) > 0).map((s) => ({ size: s, qty: qtyBySize[s] })),
    [sizes, qtyBySize],
  );
  const totalPieces = sizeRows.reduce((sum, r) => sum + r.qty, 0);
  const bumpQty = (s, delta) => setQtyBySize((prev) => ({ ...prev, [s]: Math.max(0, (prev[s] || 0) + delta) }));

  const loadMyRoster = () => {
    const roster = loadRoster();
    const rosterKeys = Object.keys(roster).filter((k) => Number(roster[k]) > 0);
    if (!rosterKeys.length) { setRosterHint('No roster saved yet — set sizes in the catalog sidebar first.'); return; }
    let applied = 0;
    setQtyBySize((prev) => {
      const next = { ...prev };
      sizes.forEach((s) => {
        if (roster[s] != null && Number(roster[s]) > 0) { next[s] = Math.floor(Number(roster[s])); applied += 1; }
      });
      return next;
    });
    // TODO(roster-prefill): roster sizes that don't exist on this product's
    // size list are silently skipped — nothing to prefill them into.
    setRosterHint(applied < rosterKeys.length ? "Some roster sizes don't apply to this product and were skipped." : '');
  };

  // ---- Server-priced quote: always real, never client-computed ----
  // Signed in with a team chosen -> the AUTHED quickorder-quote.js (coach
  // bearer token), same call CartPage.js makes, so the coach sees their
  // real team/tier pricing live on the builder, not just at checkout.
  // Anonymous (or signed in with no team chosen yet) -> the public, no-auth
  // teamshop-public-price.js standard-retail estimate. Same debounce
  // (CartPage.js's exact 500ms pattern), same display either way — only the
  // endpoint + a "Your team pricing" tag differ.
  const [quoteState, setQuoteState] = useState('idle'); // idle|loading|ready|error
  const [priceLines, setPriceLines] = useState(null); // normalized: [{unit_garment,unit_deco,unit_total,line_total}]
  const [subtotal, setSubtotal] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const timerRef = useRef(null);
  const reqIdRef = useRef(0);

  // Always quote at least a representative 1-pc line (so a per-pc price can
  // show before any size quantity is picked); once sizes are entered, quote
  // those exact rows so the size-run total is the real, qty-tiered subtotal.
  const quoteRows = sizeRows.length ? sizeRows : [{ size: null, qty: 1 }];

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const productId = product && product.id;
    if (!productId) { setPriceLines(null); setSubtotal(null); setQuoteState('idle'); return undefined; }
    timerRef.current = setTimeout(async () => {
      const myReq = ++reqIdRef.current;
      setQuoteState('loading');
      setQuoteError('');
      const decorations = spec ? [spec] : [];
      const useAuthed = signedIn;
      const url = useAuthed ? '/.netlify/functions/quickorder-quote' : '/.netlify/functions/teamshop-public-price';
      const bodyLines = quoteRows.map((r) => ({ product_id: productId, sku, size: r.size, qty: r.qty, color: colorName, decorations }));
      const body = useAuthed ? { customer_id: customerId, lines: bodyLines } : { lines: bodyLines };
      const headers = { 'Content-Type': 'application/json' };
      if (useAuthed) headers.Authorization = `Bearer ${accessToken}`;
      try {
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        const json = await res.json().catch(() => ({}));
        if (reqIdRef.current !== myReq) return;
        if (!res.ok || (useAuthed ? !json.ok : !json.ok)) { setQuoteError((json && json.error) || 'Could not get a price'); setQuoteState('error'); return; }
        if (useAuthed) {
          // quickorder-quote.js's line shape: unit_sell (garment) + decorations[].unit_sell.
          const lines = (json.quote.lines || []).map((l) => {
            const unitDeco = (l.decorations || []).reduce((s, d) => s + (Number(d.unit_sell) || 0), 0);
            return { unit_garment: l.unit_sell, unit_deco: Math.round(unitDeco * 100) / 100, unit_total: Math.round((l.unit_sell + unitDeco) * 100) / 100, line_total: l.line_total };
          });
          setPriceLines(lines);
          setSubtotal(json.quote.subtotal);
        } else {
          setPriceLines(json.lines || []);
          setSubtotal(json.subtotal);
        }
        setQuoteState('ready');
      } catch {
        if (reqIdRef.current !== myReq) return;
        setQuoteError('Network error — try again');
        setQuoteState('error');
      }
    }, DEBOUNCE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [signedIn, customerId, accessToken, product, sku, colorName, spec, quoteRows]);

  const headerLine = priceLines && priceLines[0];

  // ---- Add to order ----
  const handleAddToOrder = () => {
    setAddError('');
    if (!signedIn) { if (onCustomize) onCustomize(product); return; }
    if (!spec) { setAddError('Add a logo and placement first.'); return; }
    if (!sizeRows.length) { setAddError('Add at least one size and quantity.'); return; }
    const lines = sizeRows.map((r) => ({
      product_id: product && product.id,
      product_name: name,
      image_url: (product && (product.image_front_url || product.image_url)) || '',
      sku,
      size: r.size,
      qty: r.qty,
      color: colorName || null,
      decorations: [spec],
    }));
    if (onAddToOrder) onAddToOrder(lines);
  };

  const saveDesign = () => { /* TODO(account-save-design): no save-design endpoint exists yet. */ };

  const frontImg = product && (product.image_front_url || product.image_url);
  const backImg = product && product.image_back_url;
  const hasBackZone = zones.some((z) => z.side === 'back');
  const showToggle = !!backImg || hasBackZone;
  const activeImg = view === 'back' ? backImg : frontImg;
  const bg = bgForColor(colorName);
  const ink = inkForColor(colorName);

  return (
    <div className="nts-root" style={{ width: '100%' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 24px 0', fontSize: 13, color: TEXT_MUTED }}>
        <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: TEXT_MUTED, fontSize: 13, fontFamily: 'inherit' }}>
          ← Back to catalog
        </button>
        <span style={{ margin: '0 8px', color: BORDER_DARK }}>/</span>
        <span>Home</span>
        <span style={{ margin: '0 8px', color: BORDER_DARK }}>/</span>
        <span>{category}</span>
        <span style={{ margin: '0 8px', color: BORDER_DARK }}>/</span>
        <span style={{ color: NAVY, fontWeight: 600 }}>{name}</span>
      </div>

      <section style={{ maxWidth: 1280, margin: '0 auto', padding: 'clamp(24px,3vw,40px) 24px clamp(48px,6vw,80px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'clamp(32px,4vw,56px)', alignItems: 'start' }}>

        {/* ================= LEFT: live preview ================= */}
        <div style={{ position: 'sticky', top: 150 }}>
          <div style={{ position: 'relative', aspectRatio: '4 / 5', border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', background: activeImg ? '#F7F8FB' : bg }}>
            {showToggle && (
              <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 3, display: 'flex', gap: 6, background: 'rgba(255,255,255,0.9)', border: `1px solid ${BORDER}`, borderRadius: 999, padding: 4 }}>
                {['front', 'back'].map((s) => (
                  <button key={s} type="button" onClick={() => setView(s)} style={{ fontFamily: 'inherit', fontWeight: 600, fontSize: 13, padding: '6px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', background: view === s ? NAVY : 'transparent', color: view === s ? '#fff' : TEXT_MUTED, textTransform: 'capitalize' }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 3, background: 'rgba(255,255,255,0.92)', border: `1px solid ${BORDER}`, borderRadius: 999, padding: '5px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: NAVY }}>
              {METHOD_PILL_LABEL[method] || method}
            </div>

            {activeImg ? (
              <img src={activeImg} alt={name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: ink, opacity: 0.75 }}>
                <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M8 4l4 2 4-2 4 3-2 4-2-1v10H8V10L6 11 4 7z" /></svg>
                <span style={displayType(12, { letterSpacing: '0.16em', color: ink })}>{view === 'front' ? 'Garment Photo — Front' : 'Garment Photo — Back'}</span>
              </span>
            )}

            {overlayProps && overlayProps.side === view && <DecoOverlay {...overlayProps} />}

            {showDecoChrome && (
              <>
                {/* Dashed selection box + corner handles — cosmetic only, positioned from the same spec x/y/w decoOverlay just rendered. */}
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute', left: `${spec.x}%`, top: `${spec.y}%`, width: `${spec.w}%`, aspectRatio: '1 / 1',
                    transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 2,
                    border: `1.5px dashed ${spec.type === 'embroidery' ? 'rgba(25,40,83,0.55)' : 'rgba(150,44,50,0.55)'}`,
                    borderRadius: spec.type === 'embroidery' ? '50%' : 4,
                    boxShadow: spec.type === 'embroidery' ? 'inset 0 0 0 4px rgba(25,40,83,0.06)' : '0 3px 10px rgba(0,0,0,0.18)',
                  }}
                >
                  {['-6px -6px 0 0', '-6px auto 0 -6px', 'auto -6px -6px 0', 'auto auto -6px -6px'].map((_, i) => (
                    <span key={i} style={{
                      position: 'absolute', width: 8, height: 8, background: '#fff', border: `1.5px solid ${NAVY}`, borderRadius: 2,
                      top: i < 2 ? -5 : 'auto', bottom: i >= 2 ? -5 : 'auto', left: i % 2 === 0 ? -5 : 'auto', right: i % 2 === 1 ? -5 : 'auto',
                    }}
                    />
                  ))}
                </div>

                {spec.text && (spec.text.line1 || spec.text.line2) && (
                  <div
                    style={{
                      position: 'absolute', left: `${spec.x}%`, top: `calc(${spec.y}% + ${spec.w / 2}% + 6px)`,
                      transform: `translate(-50%,0) scale(${(spec.text.scale || 100) / 100})`, transformOrigin: 'top center',
                      textAlign: 'center', pointerEvents: 'none', zIndex: 2, maxWidth: '80%',
                    }}
                  >
                    {spec.text.line1 && <div style={displayType(15, { color: ink, lineHeight: 1.1 })}>{spec.text.line1}</div>}
                    {spec.text.line2 && <div style={displayType(11, { color: ink, lineHeight: 1.1, opacity: 0.9 })}>{spec.text.line2}</div>}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Thumb row — placeholders per the approved spec (no real macro/fabric assets exist yet). */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 12 }}>
            {['Front', 'Back', 'Logo', 'Fabric'].map((label, i) => (
              <div key={label} style={{ aspectRatio: '1 / 1', borderRadius: 8, border: `1px solid ${BORDER}`, background: i === (view === 'back' ? 1 : 0) ? OFF_WHITE : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: TEXT_FAINT }}>
                {label}
              </div>
            ))}
          </div>

          <p style={{ margin: '12px 0 0', fontSize: 12, color: TEXT_MUTED, display: 'flex', alignItems: 'center', gap: 7 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></svg>
            Live mockup for layout — final proof approved before production.*
          </p>
        </div>

        {/* ================= RIGHT: config panel ================= */}
        <div>
          <p style={displayType(13, { letterSpacing: '0.14em', color: TEXT_MUTED, margin: '0 0 6px' })}>{brand}</p>
          <h1 style={displayType('clamp(2rem,3.6vw,2.6rem)', { color: NAVY, margin: '0 0 10px', lineHeight: 1.04, letterSpacing: '0.01em' })}>{name}</h1>
          {sku && <p style={{ margin: '0 0 18px', fontSize: 13, color: TEXT_MUTED }}>SKU {sku}</p>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, flexWrap: 'wrap' }}>
            {/* Real, server-priced number — never computed here. quoteState
                'loading' keeps showing the last good price (or the neutral
                placeholder) with a subtle "Updating…" tag rather than
                flashing blank. */}
            {quoteState === 'ready' && headerLine ? (
              <span style={{ fontSize: 20, fontWeight: 600, color: TEXT }}>
                {money(headerLine.unit_garment)}
                {headerLine.unit_deco > 0 && <span style={{ color: TEXT_MUTED, fontWeight: 500 }}> + {money(headerLine.unit_deco)} decoration</span>}
                <span style={{ fontSize: 13, color: TEXT_MUTED, fontWeight: 500 }}> / pc</span>
              </span>
            ) : quoteState === 'error' ? (
              <span style={{ fontSize: 15, color: TEXT_MUTED }}>Pricing unavailable — we&apos;ll confirm your quote</span>
            ) : (
              <span style={{ fontSize: 15, color: TEXT_MUTED }}>Pricing…</span>
            )}
            {quoteState === 'loading' && <span style={{ fontSize: 12, color: TEXT_FAINT }}>Updating…</span>}
            {signedIn && quoteState === 'ready' && (
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: NAVY, background: OFF_WHITE, border: `1px solid ${BORDER}`, padding: '3px 9px', borderRadius: 999 }}>
                Your team pricing
              </span>
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: GREEN, background: '#EAF3EE', border: '1px solid #D4E7DC', padding: '5px 12px', borderRadius: 999 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: GREEN }} />
              Ready to decorate
            </span>
          </div>
          {!signedIn && (
            <p style={{ fontSize: 12, color: TEXT_FAINT, margin: '0 0 14px' }}>
              Standard retail estimate shown. {/* TODO(team-pricing-display): dropped — signed-in coaches now see live team pricing above, this note just explains the anonymous number. */}
              Sign in as a coach to see your team&apos;s pricing.
            </p>
          )}
          {signedIn && <div style={{ marginBottom: 14 }} />}

          {/* STEP 1 — logo */}
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18, marginBottom: 20 }}>
            <StepLabel>Step 1 — Add your logo</StepLabel>
            {logo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, background: OFF_WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 8 }}>
                {logo.url && <img src={logo.url} alt={logo.name || 'Logo'} style={{ width: 32, height: 32, objectFit: 'contain' }} />}
                <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{logo.name || 'Selected logo'}</span>
                <button type="button" onClick={() => setLogo(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: TEXT_MUTED, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Change</button>
              </div>
            )}
            {signedIn ? (
              <div style={{ margin: '0 -8px' }}>
                <LogoPicker customer={customer} onSelect={setLogo} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onCustomize && onCustomize(product)}
                style={{ width: '100%', border: `2px dashed ${BORDER_DARK}`, borderRadius: 10, padding: '18px 14px', background: 'none', color: TEXT_MUTED, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Sign in to pick a saved logo or upload a new one
              </button>
            )}
          </div>

          {/* STEP 2 — size & place */}
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18, marginBottom: 20 }}>
            <StepLabel>Step 2 — Size &amp; place it</StepLabel>
            <label style={{ fontSize: 13, color: TEXT_MUTED, display: 'block', marginBottom: 8 }}>
              Logo size — {logoScalePct}%
            </label>
            <input
              type="range" min={SIZE_MIN_PCT} max={SIZE_MAX_PCT} value={logoScalePct}
              onChange={(e) => setLogoScalePct(Number(e.target.value))}
              style={{ width: '100%', marginBottom: 16 }}
              aria-label="Logo size"
            />
            <p style={{ fontSize: 13, color: TEXT_MUTED, margin: '0 0 8px' }}>Placement</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {zones.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => selectZone(z)}
                  style={{
                    border: `1px solid ${zone && z.id === zone.id ? NAVY : BORDER_DARK}`,
                    background: zone && z.id === zone.id ? NAVY : '#fff',
                    color: zone && z.id === zone.id ? '#fff' : NAVY,
                    borderRadius: 999, padding: '7px 15px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {z.label}
                </button>
              ))}
              {!zones.length && <span style={{ fontSize: 13, color: TEXT_FAINT }}>No placement zones for this product.</span>}
            </div>
          </div>

          {/* STEP 3 — text under logo (optional) */}
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18, marginBottom: 20 }}>
            <StepLabel>Step 3 — Add text under logo (optional)</StepLabel>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <input
                value={line1} maxLength={24} placeholder="Line 1" aria-label="Text line 1"
                onChange={(e) => setLine1(e.target.value)}
                className="nts-input"
                style={{ flex: '1 1 140px', padding: '9px 12px', border: `1px solid ${BORDER_DARK}`, borderRadius: 8, fontSize: 14, fontFamily: 'inherit' }}
              />
              <input
                value={line2} maxLength={24} placeholder="Line 2" aria-label="Text line 2"
                onChange={(e) => setLine2(e.target.value)}
                className="nts-input"
                style={{ flex: '1 1 140px', padding: '9px 12px', border: `1px solid ${BORDER_DARK}`, borderRadius: 8, fontSize: 14, fontFamily: 'inherit' }}
              />
            </div>
            <label style={{ fontSize: 13, color: TEXT_MUTED, display: 'block', marginBottom: 8 }}>
              Text size — {textScalePct}%
            </label>
            <input
              type="range" min={TEXT_MIN_PCT} max={TEXT_MAX_PCT} value={textScalePct}
              onChange={(e) => setTextScalePct(Number(e.target.value))}
              style={{ width: '100%', marginBottom: 12 }}
              aria-label="Text size"
            />
            <button
              type="button"
              onClick={() => { setLine1(''); setLine2(''); }}
              style={{ background: 'none', border: `1px solid ${BORDER_DARK}`, borderRadius: 8, padding: '7px 14px', fontSize: 13, color: NAVY, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Clear text
            </button>
            <p style={{ fontSize: 12, color: TEXT_FAINT, margin: '10px 0 0' }}>
              Team name / text is quoted separately by our team.*
            </p>
          </div>

          {/* Garment color */}
          <div style={{ marginBottom: 26 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <span style={displayType(14, { letterSpacing: '0.08em', color: NAVY })}>Color</span>
              <span style={{ fontSize: 13, color: TEXT_MUTED }}>{colorName || 'Not specified'}</span>
            </div>
            {colorName ? (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span aria-label={colorName} style={{ width: 38, height: 38, borderRadius: 999, border: `2px solid ${NAVY}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
                  <span style={{ width: 24, height: 24, borderRadius: 999, background: bg, border: '1px solid rgba(15,26,56,0.15)' }} />
                </span>
              </div>
            ) : (
              // TODO(colors): products don't carry a structured colorway list
              // (only a single `color` string, plus an untyped `_colors` blob) —
              // the mockup's 5 fixed brand swatches would be fabricated data,
              // so this stays a single readout + placeholder until a real
              // colorway system exists.
              <div style={{ border: `1px dashed ${BORDER_DARK}`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: TEXT_FAINT }}>
                Color options coming soon
              </div>
            )}
          </div>

          {/* Decoration method */}
          <div style={{ marginBottom: 26 }}>
            <span style={displayType(14, { letterSpacing: '0.08em', color: NAVY, display: 'block', marginBottom: 12 })}>Decoration method</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {METHODS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMethod(m.key)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '13px 8px', borderRadius: 10,
                    background: method === m.key ? NAVY : '#fff', color: method === m.key ? '#fff' : NAVY,
                    border: `1.5px solid ${method === m.key ? NAVY : BORDER}`, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <span style={displayType(15, { letterSpacing: '0.04em' })}>{m.label}</span>
                  <span style={{ fontSize: 11, color: method === m.key ? 'rgba(255,255,255,0.75)' : TEXT_MUTED, marginTop: 2 }}>{m.note}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Size run */}
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: 22, background: OFF_WHITE, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <span style={displayType(15, { letterSpacing: '0.08em', color: NAVY })}>Size run</span>
              <button
                type="button"
                onClick={loadMyRoster}
                style={{ background: 'none', border: `1px solid ${BORDER_DARK}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: NAVY, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Load my roster list
              </button>
            </div>
            {rosterHint && <p style={{ fontSize: 12, color: TEXT_MUTED, margin: '0 0 10px' }}>{rosterHint}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 10, marginBottom: 16 }}>
              {sizes.map((s) => (
                <div key={s} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{s}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button type="button" aria-label={`Decrease ${s}`} onClick={() => bumpQty(s, -1)} style={stepperBtn}>−</button>
                    <span style={{ minWidth: 20, textAlign: 'center', fontSize: 13, fontWeight: 600 }}>{qtyBySize[s] || 0}</span>
                    <button type="button" aria-label={`Increase ${s}`} onClick={() => bumpQty(s, 1)} style={stepperBtn}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: `1px solid ${BORDER}`, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 13, color: TEXT_MUTED }}>
                {totalPieces} piece{totalPieces === 1 ? '' : 's'}
                {totalPieces > 0 && totalPieces < MIN_PIECES ? ` (design minimum is ${MIN_PIECES})` : ''}
              </span>
              <span style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>
                {quoteState === 'ready' && subtotal != null ? money(subtotal)
                  : quoteState === 'error' ? 'Pricing unavailable — we’ll confirm your quote'
                    : 'Pricing…'}
              </span>
            </div>
            {quoteState === 'error' && <p style={{ fontSize: 12, color: RED, marginTop: 8 }}>{quoteError}</p>}
          </div>

          {/* Actions */}
          {addError && <p style={{ fontSize: 13, color: RED, marginBottom: 10 }}>{addError}</p>}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="nts-cta-red"
              onClick={handleAddToOrder}
              style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: RED, color: '#fff', fontWeight: 600, fontSize: 17, letterSpacing: '0.02em', padding: '17px 28px', border: 'none', borderRadius: 8, cursor: 'pointer', textTransform: 'uppercase', fontFamily: 'inherit' }}
            >
              Add to order
            </button>
            <button
              type="button"
              onClick={saveDesign}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, background: 'transparent', color: NAVY, fontWeight: 600, fontSize: 16, padding: '17px 26px', border: `1px solid ${BORDER_DARK}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Save design
            </button>
          </div>
          {onAddBlank && (
            <button
              type="button"
              onClick={() => onAddBlank(product)}
              style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 600, color: TEXT_MUTED, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Add blank (no decoration)
            </button>
          )}
          <p style={{ fontSize: 12, color: TEXT_FAINT, marginTop: 14 }}>
            Decorated in-house · Ships in 5–7 days* · Low minimums*
          </p>
        </div>
      </section>
    </div>
  );
}

const stepperBtn = {
  width: 22, height: 22, border: `1px solid ${BORDER_DARK}`, background: '#fff', borderRadius: 6,
  fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: NAVY, lineHeight: 1,
};
