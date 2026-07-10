import React, { useEffect, useRef, useState } from 'react';
import useCoachSession from './useCoachSession';
import { useCart } from './cart';
import { placementById } from '../lib/artPlacements';

// Team Shop cart — Stage 5. Renders whatever's in the localStorage cart
// (src/teamshop/cart.js) and asks netlify/functions/quickorder-quote.js for a
// live, debounced quote on every change. This component never computes a
// price itself — unit_sell/line_total/subtotal are exactly what the server
// returned, rendered as-is.
//
// Stage 6: the Checkout button hands the server quote (quote_hash +
// quote.lines, kept in state below) to CheckoutPage via onCheckout — the
// order-placement endpoint re-verifies that hash per the normalizeAndHash
// contract in quickorder-quote.js.

const METHOD_LABELS = { screen_print: 'Screen Print', embroidery: 'Embroidery', dtf: 'DTF Print' };
const DEBOUNCE_MS = 500;
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

function decoChips(decorations) {
  if (!Array.isArray(decorations) || !decorations.length) {
    return [{ key: 'blank', label: 'Blank — no decoration' }];
  }
  return decorations.map((d, i) => ({
    key: `${d.placement || 'zone'}-${i}`,
    label: `${placementById(d.placement).label} · ${METHOD_LABELS[d.type] || d.type}`,
  }));
}

export default function CartPage({ customer, onKeepShopping, onCheckout }) {
  const { accessToken, signOut } = useCoachSession();
  const customerId = customer && customer.id;
  const { lines, updateQty, setSize, removeLine, addLine } = useCart(customerId);

  const [quoteState, setQuoteState] = useState('idle'); // idle|loading|ready|error|signin
  const [quote, setQuote] = useState(null); // { lines, subtotal, quote_hash, hash_version, ... }
  const [quoteError, setQuoteError] = useState('');
  const timerRef = useRef(null);
  const reqIdRef = useRef(0);

  // Debounced (500ms) re-quote on any pricing-relevant change to the cart.
  // `lines` only changes identity when cart.js actually mutates storage (see
  // useCart), so depending on it directly re-quotes on real content changes,
  // not on every render.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!customerId || !accessToken || !lines.length) {
      setQuote(null);
      setQuoteState('idle');
      return undefined;
    }
    timerRef.current = setTimeout(async () => {
      const myReq = ++reqIdRef.current;
      setQuoteState('loading');
      setQuoteError('');
      try {
        const res = await fetch('/.netlify/functions/quickorder-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            customer_id: customerId,
            lines: lines.map((l) => ({
              product_id: l.product_id, sku: l.sku, size: l.size, qty: l.qty, color: l.color, decorations: l.decorations,
            })),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (reqIdRef.current !== myReq) return; // superseded by a newer request
        if (res.status === 401) { setQuoteState('signin'); return; }
        if (!res.ok || !json.ok) { setQuoteError((json && json.error) || 'Could not get a quote'); setQuoteState('error'); return; }
        setQuote(json.quote);
        setQuoteState('ready');
      } catch (e) {
        if (reqIdRef.current !== myReq) return;
        setQuoteError('Network error — try again');
        setQuoteState('error');
      }
    }, DEBOUNCE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [lines, customerId, accessToken]);

  const stale = quoteState === 'loading';

  const duplicateBlank = (l) => {
    addLine({
      product_id: l.product_id,
      product_name: l.product_name,
      image_url: l.image_url,
      sku: l.sku,
      size: l.size,
      qty: l.qty,
      color: l.color,
      decorations: [],
    });
  };

  if (!lines.length) {
    return (
      <div style={{ padding: '48px 32px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>Your cart is empty</h1>
        <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px' }}>Add a garment from the catalog to get started.</p>
        <button
          onClick={onKeepShopping}
          style={{ background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Keep shopping
        </button>
      </div>
    );
  }

  if (quoteState === 'signin') {
    return (
      <div style={{ padding: '48px 32px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>Please sign in again</h1>
        <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px' }}>Your session expired — sign in again to see live pricing for your cart.</p>
        <button
          onClick={signOut}
          style={{ background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Sign in
        </button>
      </div>
    );
  }

  const quoteByIndex = (quote && Array.isArray(quote.lines)) ? quote.lines : [];

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 16px' }}>Your Cart</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {lines.map((l, i) => {
          const q = quoteByIndex[i];
          return (
            <div key={l.id} style={{ display: 'flex', gap: 14, border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ width: 72, height: 72, flex: '0 0 auto', background: '#f1f5f9', borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {l.image_url ? (
                  <img src={l.image_url} alt={l.product_name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>No photo</span>
                )}
              </div>

              <div style={{ flex: '1 1 220px', minWidth: 180 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{l.product_name || l.sku || 'Garment'}</div>
                {l.sku && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{l.sku}</div>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {decoChips(l.decorations).map((c) => (
                    <span key={c.key} style={{ fontSize: 11, fontWeight: 600, color: '#3730a3', background: '#eef2ff', borderRadius: 999, padding: '3px 9px' }}>
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>Size</label>
                {/* TODO(stage-5-followup): swap for a dropdown of the product's
                    available_sizes once size options travel with the cart line —
                    free-text for now so a coach isn't blocked on it. */}
                <input
                  value={l.size || ''}
                  onChange={(e) => setSize(l.id, e.target.value)}
                  placeholder="e.g. YM, AL"
                  style={{ width: 90, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>Qty</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button type="button" aria-label={`Decrease quantity for ${l.product_name || 'line'}`} onClick={() => updateQty(l.id, l.qty - 1)} style={qtyBtnStyle}>−</button>
                  <span style={{ width: 28, textAlign: 'center', fontSize: 13, fontWeight: 600 }}>{l.qty}</span>
                  <button type="button" aria-label={`Increase quantity for ${l.product_name || 'line'}`} onClick={() => updateQty(l.id, l.qty + 1)} style={qtyBtnStyle}>+</button>
                </div>
              </div>

              <div style={{ minWidth: 100, textAlign: 'right' }}>
                {q ? (
                  <>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{money(q.unit_sell)} ea</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{money(q.line_total)}</div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>{quoteState === 'loading' ? 'Pricing…' : '—'}</div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                {l.decorations && l.decorations.length > 0 && (
                  <button
                    type="button"
                    onClick={() => duplicateBlank(l)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: '#0f172a', textDecoration: 'underline', fontFamily: 'inherit' }}
                  >
                    Also add without decoration
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeLine(l.id)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: '#dc2626', fontFamily: 'inherit' }}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {quoteState === 'error' && (
        <p style={{ color: '#dc2626', fontSize: 13, marginTop: 16 }}>{quoteError}</p>
      )}

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Quote updates automatically{stale ? ' — refreshing…' : ''}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>
            Subtotal: {quote ? money(quote.subtotal) : '—'}
          </div>
        </div>
        <button
          type="button"
          disabled={quoteState !== 'ready' || !quote}
          onClick={() => { if (quote && onCheckout) onCheckout(quote); }}
          style={quoteState === 'ready' && quote
            ? { background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 24px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
            : { background: '#e2e8f0', color: '#94a3b8', border: 'none', borderRadius: 8, padding: '12px 24px', fontSize: 15, fontWeight: 700, cursor: 'not-allowed', fontFamily: 'inherit' }}
        >
          Checkout
        </button>
      </div>
    </div>
  );
}

const qtyBtnStyle = {
  width: 26,
  height: 26,
  border: '1px solid #cbd5e1',
  background: '#fff',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: '#0f172a',
};
