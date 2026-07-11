import React, { useEffect, useRef, useState } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import useCoachSession from './useCoachSession';
import { clear as clearCart } from './cart';

// Team Shop checkout — Stage 6. The client NEVER computes or sends a price:
// it echoes the quote lines + quote_hash CartPage received, the server
// (netlify/functions/teamshop-checkout.js) re-prices everything and returns
// the only totals ever shown. Payment mirrors the storefront's flow
// (src/storefront/Storefront.js): place_order → Stripe PaymentElement
// confirm → webstore-checkout `finalize` (shared with the stripe-webhook
// fallback via the atomic confirmation_sent claim).

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Stripe publishable key fetched at runtime — same pattern as Storefront.js's
// _getStripePromise (not exported there, and importing it would pull the whole
// storefront chunk into the teamshop chunk; this 10-line loader is the lighter
// duplication).
let stripePromiseCache = null;
async function getStripePromise() {
  if (stripePromiseCache) return stripePromiseCache;
  try {
    const r = await fetch('/.netlify/functions/stripe-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'config' }) });
    const d = await r.json();
    if (d.publishableKey) stripePromiseCache = loadStripe(d.publishableKey);
  } catch (_) { /* card form shows an error state below */ }
  return stripePromiseCache;
}

const inp = { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' };
const label = { fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 4 };
const Field = ({ l, children }) => (
  <div style={{ marginBottom: 12, flex: 1, minWidth: 140 }}>
    <span style={label}>{l}</span>
    {children}
  </div>
);

export default function CheckoutPage({ customer, quote: initialQuote, onBack }) {
  const { accessToken } = useCoachSession();
  const customerId = customer && customer.id;

  // The server-quoted lines + hash being purchased. Replaced wholesale when
  // the server bounces with a fresh quote (409 totals_changed).
  const [quote, setQuote] = useState(initialQuote || null);
  const [totals, setTotals] = useState(null); // server totals incl. shipping/tax
  const [priceNotice, setPriceNotice] = useState(false);

  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [ship, setShip] = useState({ name: '', street1: '', street2: '', city: '', state: '', zip: '' });

  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [pendingOrder, setPendingOrder] = useState(null);
  const [doneOrder, setDoneOrder] = useState(null); // success screen
  const [stripePromise, setStripePromise] = useState(null);
  useEffect(() => { getStripePromise().then((p) => setStripePromise(p || null)); }, []);

  // School-PO option (rep-gated per program, 00196/00197). The flag is fetched
  // fresh from teamshop-context — never trusted from the possibly-stale
  // localStorage customer object — and is COSMETIC only: place_order_po
  // re-verifies eligibility server-side on every attempt. Default hidden
  // (flag absent, fetch failure, pre-migration server) — the card flow is
  // always available.
  const [poAllowed, setPoAllowed] = useState(false);
  const [payMethod, setPayMethod] = useState('card'); // 'card' | 'po'
  const [poNumber, setPoNumber] = useState('');
  const [poFile, setPoFile] = useState(null);
  useEffect(() => {
    if (!accessToken || !customerId) return undefined;
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/teamshop-context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: '{}',
        });
        const json = await res.json().catch(() => ({}));
        if (!alive || !res.ok) return;
        const mine = (Array.isArray(json.customers) ? json.customers : []).find((c) => String(c.id) === String(customerId));
        if (mine && mine.teamshop_po_allowed === true) setPoAllowed(true);
      } catch (_) { /* default hidden */ }
    })();
    return () => { alive = false; };
  }, [accessToken, customerId]);

  // Inputs freeze once the PaymentIntent exists — the charge amount is fixed
  // server-side, so nothing that changes the price may move (same rule as the
  // storefront's `locked`).
  const locked = !!clientSecret;

  const call = async (payload) => {
    const res = await fetch('/.netlify/functions/teamshop-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ...json };
  };

  // A totals_changed 409 delivers the fresh server quote — adopt it, show the
  // notice, and let the coach re-confirm at the new numbers.
  const adoptFresh = (r) => {
    if (r && r.quote) { setQuote(r.quote); setPriceNotice(true); }
  };

  // Server totals (shipping + tax) — re-quoted whenever the address is complete
  // enough to source tax, debounced like the storefront's tax preview.
  useEffect(() => {
    if (!quote || !accessToken || locked) return undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/.netlify/functions/teamshop-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            action: 'quote_totals', customer_id: customerId,
            lines: quote.lines, quote_hash: quote.quote_hash,
            ship: ship.street1 && ship.city && ship.state && ship.zip ? ship : null,
          }),
        });
        const r = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 409 && r.code === 'totals_changed' && r.quote) { setQuote(r.quote); setPriceNotice(true); return; }
        if (r.totals) { setTotals(r.totals); setErr(''); }
        else if (r.error) setErr(r.error);
      } catch (_) { /* transient network error — next change re-quotes */ }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [quote, ship, customerId, accessToken, locked]);

  // One client_ref per distinct checkout payload (idempotent place_order —
  // a double-click or retry returns the SAME order). Mirrors Storefront's
  // orderRefFor: any change to the quote or coach details mints a fresh ref.
  const refState = useRef({ key: '', ref: '' });
  const orderRef = () => {
    // payMethod is part of the key: a card attempt and a PO attempt are
    // different orders — replaying a pending card order into the PO path
    // (or vice versa) must never happen.
    const key = JSON.stringify([customerId, quote && quote.quote_hash, contact.email, ship.street1, ship.city, ship.state, ship.zip, payMethod]);
    if (refState.current.key !== key) {
      const uuid = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : 'ref' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      refState.current = { key, ref: uuid };
    }
    return refState.current.ref;
  };

  const validInfo = contact.name.trim() && /.+@.+\..+/.test(contact.email)
    && ship.street1 && ship.city && ship.state && ship.zip;

  const startPayment = async () => {
    setErr(''); setPriceNotice(false);
    if (!validInfo) { setErr('Please complete your contact info and shipping address.'); return; }
    setBusy(true);
    const r = await call({
      action: 'place_order', customer_id: customerId,
      lines: quote.lines, quote_hash: quote.quote_hash,
      contact, ship: { ...ship, name: ship.name || contact.name },
      client_ref: orderRef(),
    });
    setBusy(false);
    if (r.status === 409 && r.code === 'totals_changed') { adoptFresh(r); return; }
    if (r.error) { setErr(r.error); return; }
    if (r.alreadyPaid) { await finalizeOrder(r.order, r.intentId); return; } // replay of an already-settled attempt
    if (!r.clientSecret) { setErr('Could not start payment.'); return; }
    if (r.totals) setTotals(r.totals);
    setPendingOrder(r.order);
    setClientSecret(r.clientSecret);
  };

  // School-PO submit: NO Stripe, NO client money — the server re-prices
  // through the same quote-hash chain as place_order, stores the PDF in the
  // private po-docs bucket, and the order awaits manual staff verification.
  const submitPo = async () => {
    setErr(''); setPriceNotice(false);
    if (!validInfo) { setErr('Please complete your contact info and shipping address.'); return; }
    if (!poNumber.trim()) { setErr('Please enter the school PO number.'); return; }
    if (!poFile) { setErr('Please attach a PDF of the purchase order.'); return; }
    if (poFile.size > 10 * 1024 * 1024) { setErr('The PO PDF is too large — 10 MB max.'); return; }
    setBusy(true);
    let b64;
    try {
      b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || '').replace(/^data:[^;]*;base64,/, ''));
        fr.onerror = () => reject(new Error('read failed'));
        fr.readAsDataURL(poFile);
      });
    } catch (_) {
      setBusy(false);
      setErr('Could not read the PO file — please re-attach it.');
      return;
    }
    const r = await call({
      action: 'place_order_po', customer_id: customerId,
      lines: quote.lines, quote_hash: quote.quote_hash,
      contact, ship: { ...ship, name: ship.name || contact.name },
      client_ref: orderRef(),
      po_number: poNumber.trim(),
      po_pdf_base64: b64,
    });
    setBusy(false);
    if (r.status === 409 && r.code === 'totals_changed') { adoptFresh(r); return; }
    if (r.error) { setErr(r.error); return; }
    if (!r.order) { setErr('Could not place the order.'); return; }
    refState.current = { key: '', ref: '' };
    clearCart(customerId);
    setDoneOrder({ ...r.order, __poPending: true });
  };

  // After Stripe confirms: webstore-checkout's finalize verifies the intent
  // against the order and flips it to paid; the stripe-webhook fallback shares
  // the same atomic confirmation claim, so this is safe to lose.
  const finalizeOrder = async (order, paymentIntentId) => {
    try {
      await fetch('/.netlify/functions/webstore-checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finalize', orderId: order.id, stripePiId: paymentIntentId || order.stripe_pi_id }),
      });
    } catch (_) { /* webhook fallback finalizes */ }
    // Stage 7: kick off the order → production conversion (idempotent RPC
    // behind convert_order). Best-effort on purpose — the order is already
    // paid, and the stripe-webhook path (or a staff batch) converts it if
    // this call is lost, so a failure here is never shown to the coach.
    try {
      await fetch('/.netlify/functions/teamshop-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: 'convert_order', order_id: order.id }),
      });
    } catch (_) { /* webhook / staff queue converts */ }
    refState.current = { key: '', ref: '' };
    clearCart(customerId);
    setDoneOrder(order);
  };

  if (!quote || !Array.isArray(quote.lines) || !quote.lines.length) {
    return (
      <div style={{ padding: '48px 32px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>Nothing to check out</h1>
        <button onClick={onBack} style={btnDark}>Back to cart</button>
      </div>
    );
  }

  if (doneOrder) {
    const num = doneOrder.order_number || String(doneOrder.id || '').slice(0, 8);
    if (doneOrder.__poPending) {
      return (
        <div style={{ padding: '48px 32px', textAlign: 'center', maxWidth: 560, margin: '0 auto' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>Order received — PO under review</h1>
          <p style={{ fontSize: 15, color: '#0f172a', margin: '0 0 6px' }}>Your order number is <b>#{num}</b>.</p>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 6px' }}>
            No payment was collected. Our team verifies school purchase orders by hand — production starts as soon as PO #{doneOrder.po_number || poNumber} is approved.
          </p>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>
            If we can’t verify the PO, we’ll email {doneOrder.buyer_email} with the reason and the order will be cancelled.
          </p>
          {doneOrder.status_token && (
            <a href={`/shop/order/${doneOrder.status_token}`} style={{ ...btnDark, display: 'inline-block', textDecoration: 'none' }}>
              Track your order
            </a>
          )}
        </div>
      );
    }
    return (
      <div style={{ padding: '48px 32px', textAlign: 'center', maxWidth: 560, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>Order placed — thank you!</h1>
        <p style={{ fontSize: 15, color: '#0f172a', margin: '0 0 6px' }}>Your order number is <b>#{num}</b>.</p>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>A confirmation email is on its way to {doneOrder.buyer_email}.</p>
        {doneOrder.status_token && (
          <a href={`/shop/order/${doneOrder.status_token}`} style={{ ...btnDark, display: 'inline-block', textDecoration: 'none' }}>
            Track your order
          </a>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 640, margin: '0 auto', width: '100%' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: '#64748b', fontFamily: 'inherit', marginBottom: 12 }}>← Back to cart</button>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 16px' }}>Checkout</h1>

      {err && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{err}</div>}
      {priceNotice && <div style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>Prices changed while you were shopping, so we refreshed your quote. Please review the new total below and place your order again.</div>}

      {/* Order summary — server-quoted lines, rendered as-is */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 18 }}>
        {quote.lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
            <span>{l.name || l.sku}{l.size ? ` · ${l.size}` : ''} × {l.qty}</span>
            <span style={{ fontWeight: 700 }}>{money(l.line_total)}</span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid #eef1f5', marginTop: 8, paddingTop: 8, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{money(totals ? totals.subtotal : quote.subtotal)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}><span>Shipping</span><span>{totals ? money(totals.shipping) : '—'}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}><span>Sales tax{totals && totals.tax_state ? ` (${totals.tax_state})` : ''}</span><span>{totals ? money(totals.tax) : 'Calculated at address'}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 17, fontWeight: 800, marginTop: 6 }}><span>Total</span><span>{totals ? money(totals.total) : '—'}</span></div>
        </div>
      </div>

      <Field l="Your name"><input style={inp} value={contact.name} disabled={locked} onChange={(e) => setContact({ ...contact, name: e.target.value })} /></Field>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Field l="Email"><input style={inp} value={contact.email} disabled={locked} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></Field>
        <Field l="Phone (optional)"><input style={inp} value={contact.phone} disabled={locked} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></Field>
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#64748b', margin: '8px 0 8px' }}>Ship to</div>
      <Field l="Street"><input style={inp} value={ship.street1} disabled={locked} onChange={(e) => setShip({ ...ship, street1: e.target.value })} /></Field>
      <Field l="Apt / suite (optional)"><input style={inp} value={ship.street2} disabled={locked} onChange={(e) => setShip({ ...ship, street2: e.target.value })} /></Field>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Field l="City"><input style={inp} value={ship.city} disabled={locked} onChange={(e) => setShip({ ...ship, city: e.target.value })} /></Field>
        <Field l="State"><input style={inp} value={ship.state} disabled={locked} onChange={(e) => setShip({ ...ship, state: e.target.value })} /></Field>
        <Field l="ZIP"><input style={inp} value={ship.zip} disabled={locked} onChange={(e) => setShip({ ...ship, zip: e.target.value })} /></Field>
      </div>

      {/* Payment method — the School PO option appears ONLY for rep-approved
          programs (poAllowed); everyone else sees the card flow unchanged. */}
      {poAllowed && !clientSecret && (
        <div style={{ margin: '12px 0 4px' }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#64748b', marginBottom: 8 }}>Payment</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name="nts-pay-method" checked={payMethod === 'card'} onChange={() => setPayMethod('card')} />
              Pay by card
            </label>
            <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name="nts-pay-method" checked={payMethod === 'po'} onChange={() => setPayMethod('po')} />
              School purchase order
            </label>
          </div>
        </div>
      )}

      {poAllowed && payMethod === 'po' && !clientSecret ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#475569', marginBottom: 12 }}>
            Attach the school’s purchase order as a PDF. Our team verifies every PO by hand — production starts after approval, and no card is charged.
          </div>
          <Field l="School PO number">
            <input style={inp} value={poNumber} maxLength={64} onChange={(e) => setPoNumber(e.target.value)} aria-label="po-number" />
          </Field>
          <Field l="PO document (PDF, 10 MB max)">
            <input type="file" accept="application/pdf,.pdf" aria-label="po-pdf" style={{ fontSize: 13, fontFamily: 'inherit' }}
              onChange={(e) => setPoFile((e.target.files && e.target.files[0]) || null)} />
          </Field>
          <button
            onClick={submitPo}
            disabled={busy || !validInfo || !totals || !poNumber.trim() || !poFile}
            style={{ ...btnDark, width: '100%', marginTop: 8, opacity: busy || !validInfo || !totals || !poNumber.trim() || !poFile ? 0.5 : 1 }}
          >
            {busy ? 'Placing order…' : 'Place order with PO'}
          </button>
        </div>
      ) : clientSecret && stripePromise ? (
        <>
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
            <CardForm onPaid={(piId) => finalizeOrder(pendingOrder, piId)} />
          </Elements>
          {/* Escape hatch: editing re-runs place_order; the same client_ref
              resumes the SAME order + PaymentIntent, never a duplicate. */}
          <button onClick={() => { setClientSecret(null); setPendingOrder(null); }} style={{ marginTop: 12, background: 'none', border: 'none', color: '#64748b', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>← Edit order details</button>
        </>
      ) : (
        <button
          onClick={startPayment}
          disabled={busy || !validInfo || !totals}
          style={{ ...btnDark, width: '100%', marginTop: 8, opacity: busy || !validInfo || !totals ? 0.5 : 1 }}
        >
          {busy ? 'Starting…' : 'Continue to payment'}
        </button>
      )}
      {!stripePromise && clientSecret && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 10 }}>Card payment isn’t available right now — please try again shortly.</div>}
    </div>
  );
}

function CardForm({ onPaid }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setErr('');
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    if (error) { setErr(error.message || 'Payment failed.'); setBusy(false); return; }
    if (paymentIntent && paymentIntent.status === 'succeeded') { await onPaid(paymentIntent.id); }
    else { setErr('Payment not completed.'); setBusy(false); }
  };
  return (
    <div style={{ marginTop: 14 }}>
      <PaymentElement />
      {err && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{err}</div>}
      <button onClick={pay} disabled={busy} style={{ ...btnDark, width: '100%', marginTop: 14, opacity: busy ? 0.5 : 1 }}>{busy ? 'Processing…' : 'Pay now'}</button>
    </div>
  );
}

const btnDark = { background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 24px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
