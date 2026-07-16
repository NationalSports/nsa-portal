import React, { useMemo, useState } from 'react';
import {
  NAVY, NAVY_DARK, RED, RED_SOFT, OFF_WHITE, BORDER, BORDER_DARK,
  TEXT, TEXT_MUTED, TEXT_FAINT, displayType,
} from './theme';
import { FAQ_CATEGORIES, FAQS } from './faqData';

// "FAQ" — the approved Claude Design mock ("Help Center") translated to
// React, wired to REAL system facts (see faqData.js's header comment for why
// the copy departs from the mock's placeholder numbers). Content-only, same
// convention as Home.js/DecorationPage.js — TeamShopApp renders the shared
// header/footer around this view.
//
// props:
//   onBrowseCatalog — optional. Not currently wired to a CTA on this page,
//     kept for parity with sibling pages' prop shape if a future revision
//     adds a "browse gear" link here.

const TRUST_PILLARS = [
  {
    title: 'No blanket minimums',
    body: 'Most items have no piece minimum. Screen print is the one exception, at 24+ pieces per design.',
    icon: <><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 12.2V5a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8z" /><circle cx="8" cy="8" r="1.4" /></>,
  },
  {
    title: 'Turnaround shown live',
    body: 'Every product page shows a real per-item shipping estimate before you order — no guessing.',
    icon: <><rect x="1" y="6" width="14" height="10" rx="1" /><path d="M15 9h4l3 3v4h-7z" /><circle cx="6" cy="18" r="1.8" /><circle cx="18" cy="18" r="1.8" /></>,
  },
  {
    title: 'Team pricing when signed in',
    body: 'Sign in with your coach account and your program’s pricing shows automatically on every product.',
    icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  },
  {
    title: 'Orders tracked start to finish',
    body: 'Your Account page follows every order live: Received, Queued, In production, Decorated, Shipped.',
    icon: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  },
];

function matchesQuery(item, q) {
  if (!q) return true;
  const hay = `${item.question} ${item.answer}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

function ChevronCircle({ open }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flexShrink: 0, width: 28, height: 28, borderRadius: 999, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: open ? NAVY : OFF_WHITE, border: `1px solid ${open ? NAVY : BORDER_DARK}`,
        transition: 'transform 180ms ease, background 180ms ease', transform: open ? 'rotate(180deg)' : 'none',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={open ? '#fff' : NAVY} strokeWidth="2.2"><path d="M6 9l6 6 6-6" /></svg>
    </span>
  );
}

function FaqCard({ item, open, onToggle }) {
  const catLabel = (FAQ_CATEGORIES.find((c) => c.key === item.category) || {}).label || '';
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          padding: '20px 22px', display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'space-between',
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ display: 'inline-flex', alignSelf: 'flex-start', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: RED, background: 'rgba(150,44,50,0.08)', borderRadius: 999, padding: '4px 10px' }}>
            {catLabel}
          </span>
          <span style={displayType(17, { color: NAVY, letterSpacing: '0.01em' })}>{item.question}</span>
        </span>
        <ChevronCircle open={open} />
      </button>
      {open && (
        <div style={{ padding: '0 22px 22px' }}>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: TEXT_MUTED }}>{item.answer}</p>
        </div>
      )}
    </div>
  );
}

export default function FAQPage() {
  const [search, setSearch] = useState('');
  const [categoryKey, setCategoryKey] = useState('all');
  const [openId, setOpenId] = useState(null);

  const visible = useMemo(() => FAQS.filter((item) => {
    if (categoryKey !== 'all' && item.category !== categoryKey) return false;
    return matchesQuery(item, search.trim());
  }), [search, categoryKey]);

  const toggle = (id) => setOpenId((prev) => (prev === id ? null : id));

  return (
    <div style={{ width: '100%', overflowX: 'hidden', background: '#fff' }}>
      {/* ============ HERO ============ */}
      <section style={{ background: NAVY_DARK, padding: 'clamp(56px, 7vw, 88px) 24px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
          <p style={displayType(13, { letterSpacing: '0.16em', color: RED_SOFT, margin: '0 0 12px' })}>Help Center</p>
          <h1 style={displayType('clamp(2.2rem, 4.4vw, 3.2rem)', { color: '#fff', margin: '0 0 16px', lineHeight: 1.05, letterSpacing: '0.01em' })}>
            Questions? We&apos;ve got answers.
          </h1>
          <p style={{ margin: '0 0 32px', color: 'rgba(255,255,255,0.72)', fontSize: 'clamp(15px, 1.4vw, 17px)', lineHeight: 1.6 }}>
            Everything you need to know about ordering, decoration, and getting your gear.
          </p>
          <label htmlFor="nts-faq-search" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search questions</label>
          <input
            id="nts-faq-search"
            className="nts-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions — sizing, PO, shipping…"
            style={{
              width: '100%', maxWidth: 520, padding: '15px 20px', border: 'none', borderRadius: 999,
              fontSize: 15, fontFamily: 'inherit', color: TEXT, background: '#fff', boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
            }}
          />
        </div>
      </section>

      {/* ============ TRUST PILLARS ============ */}
      <section style={{ padding: 'clamp(40px, 5vw, 64px) 24px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24 }}>
          {TRUST_PILLARS.map((p) => (
            <div key={p.title} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{p.icon}</svg>
              </div>
              <span style={displayType(16, { color: NAVY, letterSpacing: '0.01em' })}>{p.title}</span>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: TEXT_MUTED }}>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ============ CATEGORY CHIPS + ACCORDION ============ */}
      <section style={{ maxWidth: 820, margin: '0 auto', padding: 'clamp(40px, 5vw, 64px) 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 28, justifyContent: 'center' }}>
          {FAQ_CATEGORIES.map((cat) => {
            const active = categoryKey === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setCategoryKey(cat.key)}
                aria-pressed={active}
                style={{
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em',
                  padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${active ? NAVY : BORDER_DARK}`,
                  background: active ? NAVY : '#fff',
                  color: active ? '#fff' : TEXT,
                }}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {visible.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {visible.map((item) => (
              <FaqCard key={item.id} item={item} open={openId === item.id} onToggle={() => toggle(item.id)} />
            ))}
          </div>
        ) : (
          <div style={{ border: `1px dashed ${BORDER_DARK}`, borderRadius: 12, padding: '48px 24px', textAlign: 'center' }}>
            <p style={displayType(18, { color: NAVY, margin: '0 0 6px' })}>No matches</p>
            <p style={{ color: TEXT_MUTED, fontSize: 14, margin: 0 }}>Try a different search, or browse a different category.</p>
          </div>
        )}
      </section>

      {/* ============ CONTACT BAND ============ */}
      <section style={{ background: OFF_WHITE, borderTop: `1px solid ${BORDER}`, padding: 'clamp(48px, 6vw, 80px) 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={displayType('clamp(1.7rem, 3vw, 2.1rem)', { color: NAVY, margin: '0 0 32px', letterSpacing: '0.01em' })}>Still have a question?</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, maxWidth: 620, margin: '0 auto' }}>
            <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '26px 24px', textAlign: 'left' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', marginBottom: 14 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
              </div>
              <p style={displayType(16, { color: NAVY, margin: '0 0 6px' })}>Chat with us</p>
              <p style={{ margin: 0, fontSize: 13.5, color: TEXT_MUTED, lineHeight: 1.5 }}>Mon–Fri, 8a–6p CT</p>
            </div>
            <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '26px 24px', textAlign: 'left' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', marginBottom: 14 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
              </div>
              <p style={displayType(16, { color: NAVY, margin: '0 0 6px' })}>Email support</p>
              <a href="mailto:info@nationalsportsapparel.com" style={{ fontSize: 13.5, color: RED, fontWeight: 600 }}>info@nationalsportsapparel.com</a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
