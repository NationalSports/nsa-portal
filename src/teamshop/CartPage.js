import React, { useEffect, useRef, useState } from 'react';
import useCoachSession from './useCoachSession';
import { useCart } from './cart';
import { placementById } from '../lib/artPlacements';
import {
  NAVY, RED, OFF_WHITE, BORDER, BORDER_DARK, TEXT, TEXT_MUTED, TEXT_FAINT, GREEN, displayType,
} from './theme';

// Team Shop cart — Stage 5, restyled per the approved "Cart" Claude Design
// mockup (line-item cards + sticky order summary). This is a RESTYLE ONLY:
// every field/behavior below is unchanged from the prior plain build —
// per-line decoration pricing, server-computed delivery estimates, qty
// edit, remove, "also add without decoration", and totals sourced strictly
// from the server quote (this component still never computes a price
// itself). The mockup's promo-code field and gift options are omitted —
// teamshop has no coupon path and no gift flow to back them. The mockup's
// per-summary-row "Decoration setup: Included" / tax line are also omitted:
// our quote has no separate setup fee to report "included" and computes no
// tax at quote time (tax/shipping are resolved at order placement, same as
// before) — inventing either would be a fabricated money claim.
//
// netlify/functions/quickorder-quote.js is asked for a live, debounced
// quote on every change.

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

const chipStyle = {
  display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: NAVY,
  background: '#F1F4F9', border: `1px solid ${BORDER}`, borderRadius: 999, padding: '5px 11px',
};

const qtyBtnStyle = {
  width: 26, height: 26, border: `1px solid ${BORDER_DARK}`, background: '#fff', borderRadius: 6,
  fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', color: NAVY, lineHeight: 1,
};

const centerPanelStyle = { padding: '48px 32px', textAlign: 'center' };
const centerCtaStyle = {
  background: NAVY, color: '#fff', border: 'none', borderRadius: 9, padding: '13px 26px',
  fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

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
      <div style={centerPanelStyle}>
        <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke={BORDER_DARK} strokeWidth="1.4" style={{ margin: '0 auto 16px' }}>
          <path d="M6 8h12l-1 12H7z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </svg>
        <h1 style={displayType(22, { color: NAVY, margin: '0 0 8px' })}>Your bag is empty</h1>
        <p style={{ fontSize: 14, color: TEXT_MUTED, margin: '0 0 20px' }}>Add a garment from the catalog to get started.</p>
        <button onClick={onKeepShopping} style={centerCtaStyle}>Browse gear</button>
      </div>
    );
  }

  if (quoteState === 'signin') {
    return (
      <div style={centerPanelStyle}>
        <h1 style={displayType(22, { color: NAVY, margin: '0 0 8px' })}>Please sign in again</h1>
        <p style={{ fontSize: 14, color: TEXT_MUTED, margin: '0 0 20px' }}>Your session expired — sign in again to see live pricing for your cart.</p>
        <button onClick={signOut} style={centerCtaStyle}>Sign in</button>
      </div>
    );
  }

  const quoteByIndex = (quote && Array.isArray(quote.lines)) ? quote.lines : [];
  const totalPieces = lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
  const lineCount = lines.length;
  const readyToCheckout = quoteState === 'ready' && !!quote;

  return (
    <div style={{ width: '100%', overflowX: 'hidden', background: '#fff' }}>
      <section style={{ maxWidth: 1180, margin: '0 auto', padding: 'clamp(28px, 3.5vw, 44px) 24px clamp(56px, 7vw, 88px)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
          <h1 style={displayType('clamp(2rem, 3.6vw, 2.7rem)', { color: NAVY, margin: 0, lineHeight: 1 })}>Your bag</h1>
          <span style={{ fontSize: 14, color: TEXT_MUTED }}>
            <strong style={{ color: NAVY, fontWeight: 600 }}>{totalPieces}</strong> pieces across{' '}
            <strong style={{ color: NAVY, fontWeight: 600 }}>{lineCount}</strong> {lineCount === 1 ? 'design' : 'designs'}
          </span>
        </div>
        <div style={{ height: 1, background: BORDER, margin: '20px 0 28px' }} />

        <div className="nts-cart-layout">
          {/* LINE ITEMS */}
          <div>
            {lines.map((l, i) => {
              const q = quoteByIndex[i];
              return (
                <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 20, padding: '22px 0', borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ aspectRatio: '4/5', borderRadius: 12, border: `1px solid ${BORDER}`, overflow: 'hidden', background: OFF_WHITE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {l.image_url ? (
                      <img src={l.image_url} alt={l.product_name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 10, color: TEXT_FAINT }}>No photo</span>
                    )}
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
                      <div>
                        <h3 style={displayType(20, { color: NAVY, margin: 0, lineHeight: 1.1 })}>{l.product_name || l.sku || 'Garment'}</h3>
                        {l.sku && <p style={{ fontSize: 12, color: TEXT_FAINT, margin: '3px 0 0' }}>{l.sku}</p>}
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {q ? (
                          <>
                            <div style={{ fontSize: 19, fontWeight: 600, color: NAVY }}>{money(q.line_total)}</div>
                            <div style={{ fontSize: 12, color: TEXT_FAINT }}>{money(q.unit_sell)} ea</div>
                          </>
                        ) : (
                          <div style={{ fontSize: 13, color: TEXT_FAINT }}>{quoteState === 'loading' ? 'Pricing…' : '—'}</div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0 12px' }}>
                      {decoChips(l.decorations).map((c) => (
                        <span key={c.key} style={chipStyle}>{c.label}</span>
                      ))}
                    </div>

                    {/* Server-resolved delivery estimate (00203) — rendered
                        verbatim, hidden when the server sent none. */}
                    {q && q.timeline && q.timeline.label && (
                      <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 12 }}>Est. ship {q.timeline.label}</div>
                    )}

                    <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 11, color: TEXT_FAINT, textTransform: 'uppercase', letterSpacing: 0.4 }}>Size</span>
                        {/* TODO(stage-5-followup): swap for a dropdown of the product's
                            available_sizes once size options travel with the cart line —
                            free-text for now so a coach isn't blocked on it. */}
                        <input
                          value={l.size || ''}
                          onChange={(e) => setSize(l.id, e.target.value)}
                          placeholder="e.g. YM, AL"
                          style={{ width: 90, padding: '8px 10px', border: `1px solid ${BORDER_DARK}`, borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}
                        />
                      </label>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 11, color: TEXT_FAINT, textTransform: 'uppercase', letterSpacing: 0.4 }}>Qty</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button type="button" aria-label={`Decrease quantity for ${l.product_name || 'line'}`} onClick={() => updateQty(l.id, l.qty - 1)} style={qtyBtnStyle}>−</button>
                          <span style={{ width: 24, textAlign: 'center', fontSize: 14, fontWeight: 600, color: NAVY }}>{l.qty}</span>
                          <button type="button" aria-label={`Increase quantity for ${l.product_name || 'line'}`} onClick={() => updateQty(l.id, l.qty + 1)} style={qtyBtnStyle}>+</button>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                      {l.decorations && l.decorations.length > 0 && (
                        <button
                          type="button"
                          onClick={() => duplicateBlank(l)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: NAVY, fontFamily: 'inherit' }}
                        >
                          Also add without decoration
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeLine(l.id)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: TEXT_FAINT, fontFamily: 'inherit' }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 22 }}>
              <button
                type="button"
                onClick={onKeepShopping}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 14, fontWeight: 600, color: NAVY, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 5l-7 7 7 7" /></svg>
                Keep shopping
              </button>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: 600, color: GREEN, background: '#EAF3EE', border: '1px solid #D4E7DC', borderRadius: 999, padding: '8px 15px' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                Free decoration setup* · Saved logos · Fast turnaround, days not weeks*
              </div>
            </div>
          </div>

          {/* SUMMARY */}
          <aside className="nts-cart-summary" style={{ border: `1px solid ${BORDER}`, borderRadius: 16, padding: 26, background: OFF_WHITE }}>
            <h2 style={displayType(19, { letterSpacing: '0.06em', color: NAVY, margin: '0 0 18px' })}>Order summary</h2>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}>
              <span style={{ color: TEXT_MUTED }}>Subtotal · {totalPieces} pcs</span>
              <span style={{ fontWeight: 600, color: TEXT }}>{quote ? money(quote.subtotal) : 'Calculating…'}</span>
            </div>
            {quote && quote.timeline && quote.timeline.label && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: TEXT_MUTED }}>Estimated ship</span>
                <span style={{ fontWeight: 600, color: TEXT }}>{quote.timeline.label}</span>
              </div>
            )}

            <div style={{ height: 1, background: BORDER_DARK, margin: '18px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={displayType(16, { letterSpacing: '0.04em', color: NAVY })}>Estimated total</span>
              <span style={displayType(28, { color: NAVY, fontWeight: 700 })}>{quote ? money(quote.subtotal) : 'Calculating…'}</span>
            </div>
            <p style={{ fontSize: 11.5, color: TEXT_FAINT, margin: '0 0 18px' }}>Tax and shipping are calculated at checkout.</p>

            <div style={{ fontSize: 12, color: TEXT_FAINT, marginBottom: 14 }}>
              Quote updates automatically{stale ? ' — refreshing…' : ''}
            </div>

            {quoteState === 'error' && (
              <p style={{ color: RED, fontSize: 13, margin: '0 0 14px' }}>{quoteError}</p>
            )}

            <button
              type="button"
              disabled={!readyToCheckout}
              onClick={() => { if (quote && onCheckout) onCheckout(quote); }}
              style={readyToCheckout
                ? { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: RED, color: '#fff', fontWeight: 600, fontSize: 16, letterSpacing: '0.02em', padding: 16, border: 'none', borderRadius: 9, cursor: 'pointer', textTransform: 'uppercase', fontFamily: 'inherit' }
                : { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: BORDER, color: TEXT_FAINT, fontWeight: 600, fontSize: 16, letterSpacing: '0.02em', padding: 16, border: 'none', borderRadius: 9, cursor: 'not-allowed', textTransform: 'uppercase', fontFamily: 'inherit' }}
            >
              Checkout
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7" /></svg>
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 20 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 12.5, fontWeight: 500, color: TEXT_MUTED }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="1.8"><path d="M12 3l7 3v6c0 5-3 7-7 9-4-2-7-4-7-9V6z" /></svg>
                Free proof approval before we decorate*
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 12.5, fontWeight: 500, color: TEXT_MUTED }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="1.8"><path d="M20 12V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6" /><path d="M16 19l2 2 4-4" /></svg>
                Schools &amp; teams can pay by PO*
              </span>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
