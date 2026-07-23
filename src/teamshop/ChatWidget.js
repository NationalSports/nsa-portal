import React, { useEffect, useRef, useState } from 'react';
import useCoachSession from './useCoachSession';
import { fetchTeamShopOrders } from './teamshopOrdersApi';
import { statusChipLabel } from '../lib/teamshopOrderStatus';
import {
  NAVY, NAVY_DARK, RED, BORDER, TEXT, TEXT_MUTED, TEXT_FAINT, FONT_BODY, displayType,
} from './theme';

// Team Shop chat assistant widget — v2: Claude-powered free text with the
// v1 rule-based flow kept intact as the offline fallback. A floating
// launcher + panel mounted ONCE in TeamShopApp.js, outside the route
// switch, so it's available on every storefront view without blocking page
// interaction when closed (it renders only a small bottom-right button in
// that state).
//
// Free-text messages go to netlify/functions/teamshop-assistant.js (Claude
// Sonnet grounded in the shared FAQ facts + order tools). If that endpoint
// returns { fallback: true } (no ANTHROPIC_API_KEY configured) or errors,
// the v1 keyword router (routeIntent) answers instead — v1 is never
// deleted, it IS the offline mode. Quick-reply chips stay canned/instant
// (they're navigation, not questions). AI order card hints render through
// the SAME OrderCard component the v1 track intent uses.
//
// Signed-out "Track my order" additionally offers a family lookup (order
// number + checkout email, two inputs) that goes through the AI endpoint's
// lookup_order_for_family tool — the tokenless status_token tracker link
// comes back on the card.
//
// Coach "Track my order" (chip) still reuses fetchTeamShopOrders (the SAME
// helper AccountPage.js's "Recent orders" section calls), never a forked
// fetch. "Talk to a human" has no general coach-inquiry endpoint to post to
// (netlify/functions/teamshop-orders.js and teamshop-context.js are both
// read-only for a coach's own data; the only message-posting endpoint,
// webstore-checkout.js's postMessage, is keyed by a per-order status_token
// the widget doesn't have) — so it opens a mailto: composer instead, per
// the build spec's fallback instruction.
//
// props:
//   customer         — the shared order-flow customer (TeamShopApp's
//                       orderCustomer), or null if no team resolved yet.
//   onOpenAccount    — () => void. Opens the Account route, where CoachGate's
//                       real sign-in form lives — the widget never re-builds
//                       sign-in UI of its own.
//   onOpenDecoration — (method) => void. Opens DecorationPage with a method
//                       preselected, same nav TeamShopApp's header/footer use.

const SUPPORT_EMAIL = 'info@nationalsportsapparel.com';
const OPEN_KEY = 'nts_chat_open';

const STAGES = ['Received', 'Queued', 'In production', 'Decorated', 'Shipped'];
const STAGE_INDEX = { received: 0, queued: 1, 'in production': 2, decorated: 3, shipped: 4 };

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Payment/administrative states with no production timeline yet — chip +
// explainer instead of a progress bar (order.status, same vocabulary
// statusChipLabel reads).
const PAYMENT_STATE_EXPLAINERS = {
  pending_payment: "We're waiting on payment before this order starts production.",
  unpaid: 'Your purchase order is being reviewed by our team before we start production.',
  cancelled: 'This order was cancelled.',
  refunded: 'This order was refunded.',
};

// Keyword routing for free-text input — checked in this order (first match
// wins), per the build spec.
function routeIntent(text) {
  const t = String(text || '').toLowerCase();
  if (/order|track/.test(t)) return 'track';
  if (/siz|fit/.test(t)) return 'sizing';
  if (/decorat|embroider|print|logo/.test(t)) return 'decoration';
  if (/price|discount|team/.test(t)) return 'pricing';
  if (/human|rep|person/.test(t)) return 'human';
  return 'fallback';
}

let uid = 0;
const nextId = () => 'm' + (uid += 1);

// Ask the AI endpoint. Returns { text, cards } or null — null means "use the
// v1 rule-based flow" (endpoint missing/erroring, fallback:true, empty text).
// The server enforces the real caps; we mirror them client-side to keep
// payloads small (last 12 text turns).
const AI_MAX_TURNS = 12;
async function askAssistant({ messages, accessToken, customerId }) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch('/.netlify/functions/teamshop-assistant', {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages, customer_id: customerId || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.fallback || !json.ok || !String(json.text || '').trim()) return null;
    return { text: String(json.text), cards: Array.isArray(json.cards) ? json.cards : [] };
  } catch {
    return null;
  }
}

// ── Small presentational pieces ──────────────────────────────────────
function TypingDots() {
  return (
    <div className="nts-chat-bubble nts-chat-bubble-bot" style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '12px 14px' }} aria-label="Assistant is typing">
      {[0, 1, 2].map((i) => (
        <span key={i} className="nts-chat-dot" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </div>
  );
}

function QuickReplies({ chips, onPick }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '2px 0 4px' }}>
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          className="nts-chat-chip"
          onClick={() => onPick(c)}
          style={{
            fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: NAVY,
            background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 999,
            padding: '8px 14px', cursor: 'pointer',
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function CardShell({ children }) {
  return (
    <div className="nts-chat-bubble nts-chat-bubble-bot" style={{ padding: 14, maxWidth: 300 }}>
      {children}
    </div>
  );
}

function ProgressBar({ stageIndex }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 2, margin: '10px 0 4px' }}>
      {STAGES.map((label, i) => {
        const filled = i <= stageIndex;
        return (
          <div key={label} style={{ flex: 1, textAlign: 'center' }}>
            <div
              style={{
                height: 5, borderRadius: 3, marginBottom: 6,
                background: filled ? RED : BORDER,
              }}
            />
            <div style={{ fontSize: 9.5, color: filled ? NAVY : TEXT_FAINT, fontWeight: filled ? 700 : 500, lineHeight: 1.3 }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

function OrderCard({ order }) {
  const chipLabel = statusChipLabel(order);
  const paymentExplainer = PAYMENT_STATE_EXPLAINERS[order.status];
  const items = order.items || [];
  const first = items[0];
  const extra = items.length - 1;
  const stage = (order.production && order.production.stage) || null;
  const stageIndex = stage != null && STAGE_INDEX[stage] != null ? STAGE_INDEX[stage] : 0;

  return (
    <CardShell>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <span style={displayType(13, { color: NAVY, letterSpacing: '0.04em' })}>Order #{order.id}</span>
        <span
          style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 20, background: '#EEF2FF', color: NAVY, whiteSpace: 'nowrap' }}
        >
          {chipLabel}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: TEXT_MUTED, marginBottom: 6 }}>
        {first ? `${first.name || first.sku || 'Item'}${extra > 0 ? ` + ${extra} more` : ''}` : `${items.length} item${items.length === 1 ? '' : 's'}`}
        {order.total != null && ` · ${money(order.total)}`}
      </div>
      {paymentExplainer ? (
        <p style={{ fontSize: 12.5, color: TEXT_MUTED, margin: '4px 0 8px', lineHeight: 1.5 }}>{paymentExplainer}</p>
      ) : (
        <ProgressBar stageIndex={stageIndex} />
      )}
      {order.status_token && (
        <a
          href={`/shop/order/${order.status_token}`}
          style={{ display: 'inline-block', marginTop: 6, fontSize: 12.5, fontWeight: 700, color: RED }}
        >
          View order →
        </a>
      )}
    </CardShell>
  );
}

const SIZE_ROWS = [
  ['S', '34–36"'],
  ['M', '38–40"'],
  ['L', '42–44"'],
  ['XL', '46–48"'],
];

function SizingCard() {
  return (
    <CardShell>
      <p style={{ ...displayType(12, { color: NAVY, letterSpacing: '0.06em' }), margin: '0 0 8px' }}>Adult fit guide — chest</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <tbody>
          {SIZE_ROWS.map(([size, range]) => (
            <tr key={size} style={{ borderTop: `1px solid ${BORDER}` }}>
              <td style={{ padding: '5px 0', fontWeight: 700, color: NAVY }}>{size}</td>
              <td style={{ padding: '5px 0', color: TEXT_MUTED, textAlign: 'right' }}>{range}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 11.5, color: TEXT_FAINT, margin: '8px 0 0', lineHeight: 1.5 }}>Between sizes? Size up for a relaxed team fit.</p>
    </CardShell>
  );
}

// Exactly the three real method families (decoSpec.js METHOD_FAMILIES) —
// DTF is a Heat Applications sub-type, never its own top-level card here.
const DECORATION_OPTIONS = [
  { key: 'embroidery', label: 'Embroidery', desc: 'Premium, durable — polos, caps & outerwear.' },
  { key: 'heat', label: 'Heat Applications', desc: 'Full-color DTF transfers, vinyl names & numbers, silicone patches.' },
  // DecorationPage.js's content variants are embroidery|dtf|heat — it has no
  // 'screen_print' page yet, so this preselect falls back to its default
  // (embroidery) rather than inventing new page content. See build report.
  { key: 'screen_print', label: 'Screen Print', desc: 'Classic ink — 24-piece minimum.' },
];

function DecorationCard({ onOpenDecoration }) {
  return (
    <CardShell>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {DECORATION_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onOpenDecoration(opt.key)}
            style={{
              textAlign: 'left', background: '#F5F7FB', border: `1px solid ${BORDER}`, borderRadius: 10,
              padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY, marginBottom: 2 }}>{opt.label}</div>
            <div style={{ fontSize: 12, color: TEXT_MUTED, lineHeight: 1.4 }}>{opt.desc}</div>
          </button>
        ))}
      </div>
    </CardShell>
  );
}

function HumanCard({ onSent }) {
  const [text, setText] = useState('');
  const send = () => {
    const body = text.trim();
    if (!body) return;
    const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Team Shop question')}&body=${encodeURIComponent(body)}`;
    if (typeof window !== 'undefined') window.location.href = href;
    onSent();
  };
  return (
    <CardShell>
      <p style={{ fontSize: 12.5, color: TEXT_MUTED, margin: '0 0 8px', lineHeight: 1.5 }}>
        Leave a message and your rep will get back to you.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What can we help with?"
        rows={3}
        style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
      />
      <button
        type="button"
        onClick={send}
        disabled={!text.trim()}
        style={{
          marginTop: 8, background: RED, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px',
          fontSize: 13, fontWeight: 700, cursor: text.trim() ? 'pointer' : 'default', opacity: text.trim() ? 1 : 0.5, fontFamily: 'inherit',
        }}
      >
        Send
      </button>
      <p style={{ fontSize: 11, color: TEXT_FAINT, margin: '8px 0 0' }}>
        Opens your email app addressed to {SUPPORT_EMAIL} — we don't have a live chat inbox yet.
      </p>
    </CardShell>
  );
}

// Family order lookup — two inputs (order number + checkout email) that go
// through the AI endpoint's lookup_order_for_family tool. Rendered from the
// signed-out "Track my order" flow.
function LookupCard({ onSubmit }) {
  const [orderNumber, setOrderNumber] = useState('');
  const [email, setEmail] = useState('');
  const ready = orderNumber.trim() && email.trim();
  const inputStyle = {
    width: '100%', boxSizing: 'border-box', border: `1px solid ${BORDER}`, borderRadius: 8,
    padding: 8, fontSize: 13, fontFamily: 'inherit',
  };
  return (
    <CardShell>
      <p style={{ fontSize: 12.5, color: TEXT_MUTED, margin: '0 0 8px', lineHeight: 1.5 }}>
        Enter your order number and the email you used at checkout.
      </p>
      <input
        value={orderNumber}
        onChange={(e) => setOrderNumber(e.target.value)}
        placeholder="Order number"
        aria-label="Order number"
        inputMode="numeric"
        style={{ ...inputStyle, marginBottom: 8 }}
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email used at checkout"
        aria-label="Email used at checkout"
        type="email"
        style={inputStyle}
      />
      <button
        type="button"
        onClick={() => { if (ready) onSubmit(orderNumber.trim(), email.trim()); }}
        disabled={!ready}
        style={{
          marginTop: 8, background: RED, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px',
          fontSize: 13, fontWeight: 700, cursor: ready ? 'pointer' : 'default', opacity: ready ? 1 : 0.5, fontFamily: 'inherit',
        }}
      >
        Look up order
      </button>
    </CardShell>
  );
}

// ── Main widget ───────────────────────────────────────────────────────
export default function ChatWidget({ customer, onOpenAccount, onOpenDecoration }) {
  const [open, setOpen] = useState(() => {
    try { return window.sessionStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
  });
  const [messages, setMessages] = useState(null); // null = not greeted yet
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const { signedIn, accessToken } = useCoachSession();
  const listRef = useRef(null);
  const typingTimer = useRef(null);

  useEffect(() => {
    try { window.sessionStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* sessionStorage unavailable */ }
  }, [open]);

  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, typing]);

  const push = (msg) => setMessages((prev) => [...(prev || []), { id: nextId(), ...msg }]);

  const greet = () => {
    if (messages !== null) return;
    setMessages([
      { id: nextId(), from: 'bot', kind: 'text', text: "Hi, I'm the Team Shop Assistant. I can help with orders, sizing, decoration, and team pricing — what do you need?" },
      { id: nextId(), from: 'bot', kind: 'chips', chips: FALLBACK_CHIPS },
    ]);
  };

  const openPanel = () => { setOpen(true); greet(); };
  const closePanel = () => setOpen(false);

  // Bot response builders — one per intent, called after the typing delay.
  const respondTrack = async () => {
    if (!signedIn) {
      push({
        from: 'bot', kind: 'text',
        text: "Sign in and I can show you live status on your team's orders — or, if you ordered from a team store, I can look up a single order with its order number and the email you used at checkout.",
      });
      push({
        from: 'bot', kind: 'chips',
        chips: [
          { label: 'Look up with order # + email', action: 'family-lookup' },
          { label: 'Sign in', action: 'open-account' },
          { label: 'Email us', action: 'mailto' },
        ],
      });
      return;
    }
    if (!customer || !customer.id) {
      push({ from: 'bot', kind: 'text', text: "I need your team selected first — pick it on your Account page and I can pull up your order." });
      push({ from: 'bot', kind: 'chips', chips: [{ label: 'Go to Account', action: 'open-account' }] });
      return;
    }
    push({ from: 'bot', kind: 'text', text: 'Let me check your most recent order…' });
    try {
      const orders = await fetchTeamShopOrders(accessToken, customer.id);
      if (!orders.length) {
        push({ from: 'bot', kind: 'text', text: "You don't have any orders yet — once you place one, I can track it here." });
        return;
      }
      push({ from: 'bot', kind: 'order-card', order: orders[0] });
    } catch (e) {
      push({ from: 'bot', kind: 'text', text: "I couldn't load your order right now — try again in a moment." });
    }
  };

  const respondFor = (intentKey) => {
    if (intentKey === 'track') { respondTrack(); return; }
    if (intentKey === 'sizing') {
      push({ from: 'bot', kind: 'text', text: "Here's our adult fit guide:" });
      push({ from: 'bot', kind: 'sizing-card' });
      return;
    }
    if (intentKey === 'decoration') {
      push({ from: 'bot', kind: 'text', text: 'We decorate three ways:' });
      push({ from: 'bot', kind: 'decoration-card' });
      return;
    }
    if (intentKey === 'pricing') {
      push({ from: 'bot', kind: 'text', text: "Sign in and I'll show your program's real pricing, live — team pricing only shows once we know who you're ordering for." });
      push({ from: 'bot', kind: 'chips', chips: [{ label: 'Sign in', action: 'open-account' }] });
      return;
    }
    if (intentKey === 'human') {
      push({ from: 'bot', kind: 'human-card' });
      return;
    }
    push({ from: 'bot', kind: 'text', text: 'I can help with orders, sizing, decoration, and team pricing.' });
    push({ from: 'bot', kind: 'chips', chips: FALLBACK_CHIPS });
  };

  const sendIntent = (intentKey, userLabel) => {
    if (userLabel) push({ from: 'user', kind: 'text', text: userLabel });
    setTyping(true);
    typingTimer.current = setTimeout(() => {
      setTyping(false);
      respondFor(intentKey);
    }, 950);
  };

  const handleChip = (chip) => {
    if (chip.action === 'open-account') { push({ from: 'user', kind: 'text', text: chip.label }); if (onOpenAccount) onOpenAccount(); return; }
    if (chip.action === 'mailto') {
      push({ from: 'user', kind: 'text', text: chip.label });
      if (typeof window !== 'undefined') window.location.href = `mailto:${SUPPORT_EMAIL}`;
      return;
    }
    if (chip.action === 'family-lookup') {
      push({ from: 'user', kind: 'text', text: chip.label });
      push({ from: 'bot', kind: 'lookup-card' });
      return;
    }
    sendIntent(chip.intent, chip.label);
  };

  // Transcript for the AI endpoint: the plain text turns so far plus the new
  // user text (the `messages` state hasn't re-rendered yet when this runs).
  const transcriptWith = (text) => [
    ...(messages || [])
      .filter((m) => m.kind === 'text' && (m.from === 'user' || m.from === 'bot'))
      .map((m) => ({ role: m.from === 'user' ? 'user' : 'assistant', text: m.text })),
    { role: 'user', text },
  ].slice(-AI_MAX_TURNS);

  // Free text — AI first, v1 keyword routing as the fallback. The v1 path is
  // NEVER removed: it's what answers when the endpoint is unconfigured
  // (fallback:true), errors, or is unreachable.
  const sendFreeText = async (text) => {
    push({ from: 'user', kind: 'text', text });
    setTyping(true);
    const ai = await askAssistant({
      messages: transcriptWith(text),
      accessToken,
      customerId: customer && customer.id ? customer.id : null,
    });
    setTyping(false);
    if (ai) {
      push({ from: 'bot', kind: 'text', text: ai.text });
      ai.cards.forEach((c) => {
        if (c && c.type === 'order' && c.order) push({ from: 'bot', kind: 'order-card', order: c.order });
      });
      return;
    }
    respondFor(routeIntent(text)); // offline v1 behavior
  };

  const handleLookup = (orderNumber, email) => {
    // Goes through the AI endpoint; its lookup_order_for_family tool needs
    // both values, so hand them over in the message itself.
    sendFreeText(`Look up my order — order number ${orderNumber}, checkout email ${email}.`);
  };

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    sendFreeText(text);
  };

  if (!open) {
    return (
      <div className="nts-chat-dock" style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 200, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ ...displayType(12, { color: NAVY, letterSpacing: '0.02em', textTransform: 'none' }), background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 999, padding: '9px 16px', boxShadow: '0 8px 24px rgba(15,26,56,0.12)' }}>
          Need a hand? Ask away
        </span>
        <button
          type="button"
          aria-label="Open Team Shop Assistant chat"
          onClick={openPanel}
          className="nts-chat-launcher"
          style={{
            width: 56, height: 56, borderRadius: '50%', background: RED, border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(150,44,50,0.35)', flexShrink: 0,
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        </button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Team Shop Assistant"
      className="nts-chat-panel nts-chat-dock"
      style={{
        position: 'fixed', right: 20, bottom: 20, zIndex: 200,
        width: 404, maxWidth: 'calc(100% - 40px)', height: 648, maxHeight: 'calc(100% - 40px)',
        background: '#fff', borderRadius: 20, boxShadow: '0 24px 64px rgba(15,26,56,0.28)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: FONT_BODY,
      }}
    >
      {/* Header */}
      <div style={{ background: `linear-gradient(120deg, ${NAVY_DARK}, ${NAVY})`, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ position: 'relative', width: 38, height: 38, borderRadius: 10, background: 'rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={displayType(14, { color: '#fff' })}>TS</span>
          <span aria-hidden="true" style={{ position: 'absolute', bottom: -2, right: -2, width: 11, height: 11, borderRadius: '50%', background: '#2FBF6E', border: '2px solid ' + NAVY }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Team Shop Assistant</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>Coaches &amp; players</div>
        </div>
        <button type="button" aria-label="Minimize chat" onClick={closePanel} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', padding: 4, display: 'flex' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 12h14" /></svg>
        </button>
        <button type="button" aria-label="Close chat" onClick={closePanel} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', padding: 4, display: 'flex' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      {/* Message stream */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', background: '#F5F7FB', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ textAlign: 'center', fontSize: 11, color: TEXT_FAINT, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '2px 0 4px' }}>Today</div>
        {(messages || []).map((m) => (
          <MessageRow key={m.id} m={m} onChip={handleChip} onOpenDecoration={onOpenDecoration} onLookup={handleLookup} />
        ))}
        {typing && <TypingDots />}
      </div>

      {/* Composer */}
      <div style={{ borderTop: `1px solid ${BORDER}`, padding: '10px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            placeholder="Ask about orders, sizing, decoration…"
            aria-label="Message"
            className="nts-input"
            style={{ flex: 1, border: `1px solid ${BORDER}`, borderRadius: 999, padding: '10px 16px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none' }}
          />
          <button
            type="button"
            aria-label="Send message"
            onClick={handleSend}
            disabled={!draft.trim()}
            style={{
              width: 38, height: 38, borderRadius: '50%', background: RED, border: 'none', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: draft.trim() ? 'pointer' : 'default', opacity: draft.trim() ? 1 : 0.5,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </button>
        </div>
        <p style={{ textAlign: 'center', fontSize: 10.5, color: TEXT_FAINT, margin: '8px 0 0' }}>Powered by National Team Shop</p>
      </div>
    </div>
  );
}

const FALLBACK_CHIPS = [
  { label: 'Track my order', intent: 'track' },
  { label: 'Sizing help', intent: 'sizing' },
  { label: 'Decoration options', intent: 'decoration' },
  { label: 'Team pricing', intent: 'pricing' },
  { label: 'Talk to a human', intent: 'human' },
];

function MessageRow({ m, onChip, onOpenDecoration, onLookup }) {
  if (m.kind === 'chips') return <QuickReplies chips={m.chips} onPick={onChip} />;
  if (m.kind === 'order-card') return <OrderCard order={m.order} />;
  if (m.kind === 'sizing-card') return <SizingCard />;
  if (m.kind === 'decoration-card') return <DecorationCard onOpenDecoration={onOpenDecoration || (() => {})} />;
  if (m.kind === 'human-card') return <HumanCard onSent={() => {}} />;
  if (m.kind === 'lookup-card') return <LookupCard onSubmit={onLookup || (() => {})} />;
  const isUser = m.from === 'user';
  return (
    <div
      className={`nts-chat-bubble ${isUser ? 'nts-chat-bubble-user' : 'nts-chat-bubble-bot'}`}
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '78%',
        padding: '10px 14px',
        fontSize: 13.5,
        lineHeight: 1.5,
        color: isUser ? '#fff' : TEXT,
        background: isUser ? NAVY : '#fff',
        borderRadius: isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
        boxShadow: isUser ? 'none' : '0 2px 8px rgba(15,26,56,0.06)',
      }}
    >
      {m.text}
    </div>
  );
}
