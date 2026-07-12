import React, { useEffect, useRef, useState } from 'react';
import {
  NAVY, NAVY_DARK, RED, RED_SOFT, OFF_WHITE, BORDER, BORDER_DARK,
  TEXT, TEXT_MUTED, TEXT_FAINT, GREEN, displayType,
} from './theme';
import { searchPublicTeamStores, closesLabel, cleanTerm } from '../lib/publicTeamStores';

// "Team Stores" — the approved Claude Design mock ("Team Stores.dc.html")
// translated to React. Content-only, same convention as FAQPage.js /
// DecorationPage.js — TeamShopApp renders the shared header/footer around
// this view.
//
// What departs from the mock, and why:
//   - "Find your store" search is REAL: it reuses the exact webstores_public
//     query the portal's /team-stores finder uses (src/lib/publicTeamStores.js,
//     extracted from src/storefront/TeamStores.js — one query path, not two).
//     Unlike that open-only finder, this page also surfaces recently-closed
//     stores, marked closed, so a parent searching after the window shut gets
//     an answer instead of a confusing "no match".
//   - The mock's interactive one-click store builder ("Pick your colors. Drop
//     your logo. Done.") is rendered as a STATIC/decorative section below —
//     visual fidelity to the mock, no self-service logic. Self-service store
//     creation still lives in the Connect coach portal, not this marketing
//     page, so the section's copy stays rep-led ("your rep handles the
//     setup") rather than implying a literal one-click flow.
//   - 2026-07-12 tightening pass (owner design review): the hero headline's
//     "up in days" and the stats row's "~1 wk to go live*" timing claims were
//     reinstated to match the mock, at the owner's explicit direction, with a
//     footnote hedge ("typical timeline...may vary") preserving some of the
//     caution behind the original softening below. Fundraising claims stay:
//     fundraise_enabled is a real webstore feature.
//   - The example-store band keeps the mock's browser-frame layout but uses
//     labeled photo placeholders (house style, per DecorationPage.js) — no
//     fake store screenshots.
//   - The mock's fundraising payout-math demo card ($1,200 raised, etc.) is
//     dropped — no client-side money math, illustrative or otherwise.

const CONTACT_HREF = 'mailto:info@nationalsportsapparel.com?subject=Team%20store%20for%20my%20program';

const PITCHES = [
  {
    title: 'Open 24/7',
    body: 'Your store runs itself around the clock during the order window. No spreadsheets, no cash collection, no order-night table in the gym.',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>,
  },
  {
    title: 'Direct-ship to families',
    body: 'Each order ships straight to the family that placed it. No sorting bulk boxes by hand or chasing people down at practice.',
    icon: <><rect x="1" y="7" width="15" height="10" rx="1" /><path d="M16 10h4l3 3v4h-7z" /><circle cx="6" cy="19" r="1.8" /><circle cx="18" cy="19" r="1.8" /></>,
  },
  {
    title: 'Automated tracking',
    body: 'Families get order confirmations and shipment tracking by email, plus a portal to check status — so no one calls the coach asking where their hoodie is.',
    icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 8l9 5 9-5" /></>,
  },
  {
    title: 'Built-in fundraising',
    body: 'Add a margin to any item and your program keeps the difference. Every spirit-pack order quietly funds the season.',
    icon: <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  },
];

const STEPS = [
  {
    n: 1,
    title: 'We build your store',
    body: 'Pick gear with your rep, we brand it in your colors and logo, and set your fundraising margin.',
  },
  {
    n: 2,
    title: 'Share one link',
    body: 'Send families the store link. They browse, order, and pay on their own — 24/7 while the window is open.',
  },
  {
    n: 3,
    title: 'We decorate & ship',
    body: 'We produce every order in-house and ship direct to each family, with tracking emails throughout.',
  },
  {
    n: 4,
    title: 'Your program earns',
    body: 'After the window closes, your rep totals your fundraising margin and it goes back to your program.',
  },
];

// Labeled photo placeholder in the house style (see DecorationPage.js) —
// a gradient block with an icon + caption, never a fake screenshot.
function PhotoPlaceholder({ gradient, ink, caption, style }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, background: gradient, color: ink, overflow: 'hidden', ...style }}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.6" /><path d="M21 16l-5-5-9 8" /></svg>
      <span style={{ ...displayType(11, { letterSpacing: '0.14em', color: ink }), textAlign: 'center', padding: '0 12px' }}>{caption}</span>
    </div>
  );
}

// One search result — real store data from webstores_public. Open stores link
// to their live storefront (/shop/<slug> — the same URL the /team-stores
// finder uses; src/index.js's path branches win on this host too). Closed
// stores render inert, clearly marked.
function StoreResult({ store }) {
  const open = store.status === 'open';
  const closes = open ? closesLabel(store.close_at) : null;
  const primary = store.primary_color || NAVY;
  const inner = (
    <>
      <span aria-hidden="true" style={{ width: 46, height: 46, borderRadius: 10, flexShrink: 0, background: `linear-gradient(135deg, ${primary}, ${NAVY_DARK})`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {store.logo_url
          ? <img src={store.logo_url} alt="" style={{ maxWidth: '80%', maxHeight: '80%', objectFit: 'contain' }} />
          : <span style={displayType(18, { color: '#fff' })}>{(store.name || '?').charAt(0)}</span>}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span style={displayType(17, { color: NAVY, letterSpacing: '0.02em', lineHeight: 1.15 })}>{store.name}</span>
        {closes && <span style={{ fontSize: 12.5, fontWeight: 600, color: TEXT_MUTED }}>{closes}</span>}
      </span>
      <span
        style={{
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          padding: '5px 12px',
          borderRadius: 999,
          background: open ? 'rgba(47,107,69,0.1)' : OFF_WHITE,
          color: open ? GREEN : TEXT_FAINT,
          border: `1px solid ${open ? 'rgba(47,107,69,0.3)' : BORDER_DARK}`,
        }}
      >
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: open ? GREEN : TEXT_FAINT }} />
        {open ? 'Open' : 'Closed'}
      </span>
      {open && (
        <span aria-hidden="true" style={{ flexShrink: 0, display: 'flex', color: RED }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </span>
      )}
    </>
  );
  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 16, background: '#fff',
    border: `1px solid ${BORDER}`, borderRadius: 14, padding: '14px 18px', textAlign: 'left',
  };
  return open ? (
    <a href={`/shop/${store.slug}`} className="nts-card" style={{ ...rowStyle, color: 'inherit' }}>{inner}</a>
  ) : (
    <div style={{ ...rowStyle, opacity: 0.75 }}>{inner}</div>
  );
}

export default function TeamStoresPage() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null); // null = not searched yet; [] = no match
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);
  const findRef = useRef(null);

  // Debounced search — the same webstores_public query the /team-stores
  // finder runs (see publicTeamStores.js), plus closed stores, marked below.
  useEffect(() => {
    const term = cleanTerm(q);
    if (term.length < 2) { setResults(null); setSearching(false); return undefined; }
    setSearching(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const data = await searchPublicTeamStores(term, { statuses: ['open', 'closed'] });
      if (mine !== seq.current) return; // a newer keystroke superseded this one
      setResults(data);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const goFind = () => {
    if (findRef.current && findRef.current.scrollIntoView) findRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const term = cleanTerm(q);

  return (
    <div style={{ width: '100%', overflowX: 'hidden', background: '#fff' }}>
      {/* ============ HERO ============ */}
      <section style={{ position: 'relative', background: `linear-gradient(120deg, ${NAVY_DARK} 0%, ${NAVY} 55%, #1c2d4f 100%)`, color: '#fff', overflow: 'hidden' }}>
        <div style={{ position: 'relative', maxWidth: 1200, margin: '0 auto', padding: 'clamp(48px, 6vw, 88px) 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'clamp(32px, 4vw, 56px)', alignItems: 'center' }}>
          <div>
            <p style={{ ...displayType(13, { letterSpacing: '0.18em', color: RED_SOFT, margin: '0 0 18px' }), display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <span aria-hidden="true" style={{ width: 30, height: 2, background: RED_SOFT, display: 'inline-block' }} />
              Online Team Stores
            </p>
            <h1 style={displayType('clamp(2.4rem, 5vw, 4rem)', { lineHeight: 0.98, letterSpacing: '0.01em', margin: '0 0 20px', maxWidth: '20ch' })}>
              A storefront for your program — up in days.
            </h1>
            <p style={{ fontSize: 'clamp(16px, 1.5vw, 18px)', lineHeight: 1.6, color: 'rgba(255,255,255,0.78)', maxWidth: 520, margin: '0 0 30px' }}>
              We build a private, branded store for your team. Players and parents order and pay individually, gear ships to their door, and your program can earn on every sale — with no upfront cost and zero inventory to manage. Fast setup with your rep.
            </p>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <a
                className="nts-cta-red"
                href={CONTACT_HREF}
                style={{ fontWeight: 600, fontSize: 16, padding: '15px 28px', borderRadius: 8, background: RED, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.02em' }}
              >
                Talk to your rep about a store
              </a>
              <button
                type="button"
                className="nts-ghost"
                onClick={goFind}
                style={{ fontFamily: 'inherit', fontWeight: 600, fontSize: 16, padding: '15px 28px', borderRadius: 8, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', cursor: 'pointer' }}
              >
                Find your store
              </button>
            </div>
            <div style={{ display: 'flex', gap: 'clamp(24px, 3vw, 44px)', marginTop: 36, flexWrap: 'wrap' }}>
              {[['24/7', 'Open to order'], ['$0', 'Upfront cost'], ['~1 wk', 'To go live*']].map(([big, small], i) => (
                <React.Fragment key={small}>
                  {i > 0 && <div aria-hidden="true" style={{ width: 1, background: 'rgba(255,255,255,0.15)' }} />}
                  <div>
                    <div style={{ ...displayType('clamp(1.8rem, 2.6vw, 2.4rem)', { fontWeight: 700, lineHeight: 1 }), ...(i === 2 ? { color: '#F3B0B4' } : {}) }}>{big}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 5 }}>{small}</div>
                  </div>
                </React.Fragment>
              ))}
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>*Typical timeline once you confirm colors and logo with your rep — can vary by season.</p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            {/* Decorative LIVE store preview — pure CSS/JSX recreation of the
                mock's store-preview card (no binary assets), aria-hidden. */}
            <div
              aria-hidden="true"
              style={{
                position: 'relative', width: '100%', maxWidth: 440,
                transform: 'rotate(-3deg)', borderRadius: 16, overflow: 'hidden',
                boxShadow: '0 40px 80px rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.14)',
                background: '#fff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#1c2840' }}>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: '#ff5f57' }} />
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: '#febc2e' }} />
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: '#28c840' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.75)', borderRadius: 6, padding: '5px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ flexShrink: 0 }}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                  nationalteamshop.com/store/oak-grove-football
                </div>
              </div>
              <div style={{ position: 'relative', background: 'linear-gradient(150deg, #22335c, #131f42)', padding: '22px 20px 26px' }}>
                <span style={{ position: 'absolute', top: 14, right: 14, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 999, padding: '4px 10px', ...displayType(9.5, { letterSpacing: '0.06em', color: '#fff' }) }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: '#3DDC84' }} />
                  Live store
                </span>
                <div style={displayType(10.5, { letterSpacing: '0.14em', color: RED_SOFT })}>Official Team Store</div>
                <div style={{ ...displayType('clamp(16px, 2vw, 20px)', { color: '#fff' }), margin: '4px 0 8px', maxWidth: '75%', lineHeight: 1.05 }}>Oak Grove Football Team Store</div>
                <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.72)', lineHeight: 1.5, maxWidth: '88%' }}>Spirit-pack gear for players &amp; families — order anytime, ships direct to your door.</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10, padding: 14, background: OFF_WHITE }}>
                {[
                  { label: 'Spirit hoodie', gradient: 'linear-gradient(150deg, #F7F9FC, #E9EEF6)' },
                  { label: 'Practice tee', gradient: 'linear-gradient(150deg, #FFFFFF, #EEF1F6)' },
                  { label: 'Team cap', gradient: 'linear-gradient(150deg, #F2F3F5, #E4E6EA)' },
                ].map((item) => (
                  <div key={item.label} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ aspectRatio: '1 / 1', background: item.gradient }} />
                    <div style={{ padding: '6px 6px 8px', fontSize: 9.5, fontWeight: 600, color: TEXT_MUTED, textAlign: 'center', lineHeight: 1.25 }}>{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <span aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0, height: 4, width: '100%', background: RED }} />
      </section>

      {/* ============ HOW YOUR STORE COMES TOGETHER ============
          Static/decorative recreation of the mock's one-click builder
          section — visual fidelity only, no self-service logic. Copy stays
          rep-led ("your rep handles the setup") since store creation is
          still rep-assisted, not literally one-click, on this page. */}
      <section style={{ background: OFF_WHITE, borderBottom: `1px solid ${BORDER}`, padding: 'clamp(48px, 6vw, 80px) 24px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', textAlign: 'center' }}>
          <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 10px' })}>Simple by design</p>
          <h2 style={displayType('clamp(1.9rem, 3.4vw, 2.5rem)', { color: NAVY, margin: '0 0 14px', letterSpacing: '0.01em' })}>Pick your colors. Drop your logo. Done.</h2>
          <p style={{ maxWidth: 560, margin: '0 auto 44px', fontSize: 15, color: TEXT_MUTED, lineHeight: 1.6 }}>
            Your rep handles the setup — send your colors and logo, and we build a store like this one, ready to share with your team.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24 }}>
            {[
              {
                n: 1,
                title: 'Pick your colors',
                body: 'Tell your rep your team colors — we theme the whole store to match.',
                icon: <><path d="M12 3a9 9 0 100 18 1.5 1.5 0 001.06-2.56 1.5 1.5 0 011.06-2.56H16a5 5 0 005-5c0-4.4-4.03-8-9-8z" /><circle cx="7.5" cy="10.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="10.5" cy="7" r="1.1" fill="currentColor" stroke="none" /><circle cx="15" cy="7.3" r="1.1" fill="currentColor" stroke="none" /></>,
              },
              {
                n: 2,
                title: 'Drop your logo',
                body: 'Send your logo file. We place it across your gear and store branding.',
                icon: <><path d="M12 15V4M8 8l4-4 4 4" /><rect x="3" y="16" width="18" height="4" rx="1" /></>,
              },
              {
                n: 3,
                title: 'Done — share the link',
                body: 'Preview, approve, and send families one link. No software to learn.',
                icon: <><circle cx="12" cy="12" r="9" /><path d="M8 12.3l2.6 2.6L16 9.5" /></>,
              },
            ].map((s) => (
              <div key={s.n} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '28px 22px', textAlign: 'left' }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{s.icon}</svg>
                </div>
                <h3 style={displayType(17, { color: NAVY, margin: '0 0 6px', letterSpacing: '0.02em' })}>{s.title}</h3>
                <p style={{ margin: 0, fontSize: 13.5, color: TEXT_MUTED, lineHeight: 1.55 }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FOUR PITCHES ============ */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(48px, 6vw, 88px) 24px' }}>
        <div style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto 48px' }}>
          <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 8px' })}>Why programs use team stores</p>
          <h2 style={displayType('clamp(1.9rem, 3.4vw, 2.5rem)', { color: NAVY, margin: 0, letterSpacing: '0.01em' })}>Everything handled, nothing to manage</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 22 }}>
          {PITCHES.map((p) => (
            <div key={p.title} style={{ position: 'relative', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '30px 26px', boxShadow: '0 1px 2px rgba(15,26,56,0.05)', overflow: 'hidden' }}>
              <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: RED }} />
              <div style={{ width: 46, height: 46, borderRadius: 11, background: OFF_WHITE, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: NAVY, marginBottom: 18 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{p.icon}</svg>
              </div>
              <h3 style={displayType(19, { color: NAVY, margin: '0 0 8px', letterSpacing: '0.02em' })}>{p.title}</h3>
              <p style={{ margin: 0, fontSize: 14, color: TEXT_MUTED, lineHeight: 1.55 }}>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ============ FIND YOUR STORE ============ */}
      <section ref={findRef} style={{ background: NAVY_DARK, padding: 'clamp(48px, 6vw, 80px) 24px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
          <p style={displayType(13, { letterSpacing: '0.16em', color: RED_SOFT, margin: '0 0 12px' })}>Already have a store?</p>
          <h2 style={displayType('clamp(2rem, 3.6vw, 2.7rem)', { color: '#fff', margin: '0 0 14px', lineHeight: 1.02, letterSpacing: '0.01em' })}>Find your store</h2>
          <p style={{ margin: '0 0 28px', color: 'rgba(255,255,255,0.72)', fontSize: 'clamp(15px, 1.4vw, 17px)', lineHeight: 1.6 }}>
            Search your school, team, or organization name to jump straight to your program&apos;s store.
          </p>
          <label htmlFor="nts-store-search" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search team stores</label>
          <input
            id="nts-store-search"
            className="nts-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by school, team, or organization name…"
            style={{
              width: '100%', maxWidth: 520, padding: '15px 20px', border: 'none', borderRadius: 999,
              fontSize: 15, fontFamily: 'inherit', color: TEXT, background: '#fff', boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
            }}
          />
          <div style={{ marginTop: 26, textAlign: 'left' }}>
            {term.length < 2 ? (
              <p style={{ margin: 0, textAlign: 'center', fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>Start typing your team or school name to find your store.</p>
            ) : searching ? (
              <p style={{ margin: 0, textAlign: 'center', fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>Searching…</p>
            ) : results && results.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {results.map((s) => <StoreResult key={s.slug} store={s} />)}
              </div>
            ) : (
              <div style={{ border: '1px dashed rgba(255,255,255,0.3)', borderRadius: 12, padding: '32px 24px', textAlign: 'center' }}>
                <p style={displayType(17, { color: '#fff', margin: '0 0 6px' })}>No store matches &ldquo;{term}&rdquo;</p>
                <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.6)' }}>
                  Don&apos;t see your program? <a href={CONTACT_HREF} style={{ color: RED_SOFT, fontWeight: 600 }}>Talk to your rep about opening one.</a>
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ============ EXAMPLE STORE SHOWCASE ============ */}
      <section style={{ background: OFF_WHITE, borderBottom: `1px solid ${BORDER}`, padding: 'clamp(48px, 6vw, 88px) 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 28 }}>
            <div style={{ maxWidth: 560 }}>
              <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 8px' })}>What families see</p>
              <h2 style={displayType('clamp(1.9rem, 3.2vw, 2.4rem)', { color: NAVY, margin: '0 0 10px', letterSpacing: '0.01em' })}>Your store, in your colors</h2>
              <p style={{ fontSize: 16, color: TEXT_MUTED, lineHeight: 1.6, margin: 0 }}>
                Every store is branded with your team&apos;s colors and logo, stocked with gear hand-picked with your coaching staff — so families order with confidence.
              </p>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: GREEN, background: '#EAF3EE', border: '1px solid #D4E7DC', padding: '8px 14px', borderRadius: 999 }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: GREEN }} />
              Example layout
            </span>
          </div>

          {/* Browser frame per the mock — placeholder imagery, no fake screenshots. */}
          <div style={{ borderRadius: 16, overflow: 'hidden', boxShadow: '0 30px 70px rgba(15,26,56,0.22)', border: '1px solid #E4E8F0', background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', background: '#1c2840' }}>
              <div aria-hidden="true" style={{ display: 'flex', gap: 7 }}>
                <span style={{ width: 12, height: 12, borderRadius: 999, background: '#ff5f57' }} />
                <span style={{ width: 12, height: 12, borderRadius: 999, background: '#febc2e' }} />
                <span style={{ width: 12, height: 12, borderRadius: 999, background: '#28c840' }} />
              </div>
              <div style={{ flex: 1, maxWidth: 520, margin: '0 auto', background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.75)', borderRadius: 8, padding: '6px 14px', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                nationalteamshop.com/shop/your-team
              </div>
              <span aria-hidden="true" style={{ width: 40 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px clamp(16px, 2.5vw, 32px)', borderBottom: `1px solid ${BORDER}`, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span aria-hidden="true" style={{ width: 46, height: 46, borderRadius: 8, background: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={RED_SOFT} strokeWidth="1.5"><path d="M3 6l9-3 9 3-9 4z" /><path d="M7 10v5c0 2 10 2 10 0v-5" /></svg>
                </span>
                <div style={{ lineHeight: 1.15 }}>
                  <div style={displayType(11, { letterSpacing: '0.1em', color: RED })}>Official Team Store</div>
                  <div style={displayType('clamp(18px, 2vw, 23px)', { fontWeight: 700, letterSpacing: '0.02em', color: NAVY })}>Your Team Store</div>
                </div>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ships to each family · Open while the window is</span>
            </div>
            <div style={{ padding: 'clamp(18px, 2.5vw, 28px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, background: OFF_WHITE }}>
              <PhotoPlaceholder gradient={`linear-gradient(150deg, #22335c, ${NAVY_DARK})`} ink="rgba(255,255,255,0.75)" caption="Photo — Store hero in your team colors" style={{ gridColumn: '1 / -1', aspectRatio: '16 / 6', borderRadius: 12 }} />
              <PhotoPlaceholder gradient="linear-gradient(150deg, #F7F9FC, #E9EEF6)" ink={TEXT_FAINT} caption="Photo — Spirit hoodie" style={{ aspectRatio: '1 / 1', borderRadius: 12 }} />
              <PhotoPlaceholder gradient="linear-gradient(150deg, #FFFFFF, #EEF1F6)" ink={TEXT_FAINT} caption="Photo — Practice tee" style={{ aspectRatio: '1 / 1', borderRadius: 12 }} />
              <PhotoPlaceholder gradient="linear-gradient(150deg, #F2F3F5, #E4E6EA)" ink={TEXT_FAINT} caption="Photo — Team cap" style={{ aspectRatio: '1 / 1', borderRadius: 12 }} />
            </div>
          </div>
          <p style={{ textAlign: 'center', margin: '18px 0 0', fontSize: 12, color: TEXT_FAINT }}>Example layout shown with placeholder imagery — your store is branded to your program.</p>
        </div>
      </section>

      {/* ============ HOW IT WORKS FOR COACHES ============ */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(48px, 6vw, 88px) 24px' }}>
        <div style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto 52px' }}>
          <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 10px' })}>How it works for coaches</p>
          <h2 style={displayType('clamp(1.9rem, 3.4vw, 2.5rem)', { color: NAVY, margin: 0, letterSpacing: '0.01em' })}>Open it, share it, fund the season</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 24 }}>
          {STEPS.map((s) => (
            <div key={s.n}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <span style={{ ...displayType(20, { fontWeight: 700, color: '#fff' }), background: s.n === 4 ? RED : NAVY, width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s.n}</span>
                <span aria-hidden="true" style={{ height: 2, flex: 1, background: BORDER }} />
              </div>
              <h3 style={displayType(19, { color: NAVY, margin: '0 0 8px', letterSpacing: '0.02em' })}>{s.title}</h3>
              <p style={{ margin: 0, fontSize: 14, color: TEXT_MUTED, lineHeight: 1.55 }}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ============ CTA BAND ============ */}
      <section style={{ background: OFF_WHITE, borderTop: `1px solid ${BORDER}`, padding: 'clamp(48px, 6vw, 80px) 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 12px' })}>Ready when you are</p>
          <h2 style={displayType('clamp(2rem, 4vw, 2.8rem)', { color: NAVY, margin: '0 0 14px', lineHeight: 1.02, letterSpacing: '0.01em' })}>Launch your team store</h2>
          <p style={{ fontSize: 'clamp(15px, 1.5vw, 17px)', color: TEXT_MUTED, lineHeight: 1.6, margin: '0 auto 30px', maxWidth: 520 }}>
            Tell us your program and colors — your rep will build the store with you and send a preview to approve before it goes live to families.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a
              className="nts-cta-red"
              href={CONTACT_HREF}
              style={{ background: RED, color: '#fff', fontWeight: 600, fontSize: 16, padding: '15px 30px', borderRadius: 8, textTransform: 'uppercase', letterSpacing: '0.02em' }}
            >
              Talk to your rep about a store
            </a>
            <button
              type="button"
              onClick={goFind}
              style={{ fontFamily: 'inherit', background: 'transparent', color: NAVY, fontWeight: 600, fontSize: 16, padding: '15px 28px', borderRadius: 8, border: `1px solid ${BORDER_DARK}`, cursor: 'pointer' }}
            >
              Find your store
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
