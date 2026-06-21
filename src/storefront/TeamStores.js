/* eslint-disable */
// Public Team Stores finder — /team-stores
// A search-first portal: stores are NOT listed. A shopper searches their school /
// team / organization name and only matching OPEN, publicly-listed stores appear.
// Surfaced at nationalsportsapparel.com/team-stores via the same Netlify proxy
// rewrite used for /livelook, so the browser URL stays on the marketing domain.
import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { supabase } from '../lib/supabase';

// The public store builder is a sizeable, login-free flow; load it only when a
// coach actually clicks "Build" so the directory itself stays instant.
const BuildStore = lazy(() => import('./BuildStore'));

const DISPLAY = "'Barlow Condensed','Oswald','Helvetica Neue',Impact,sans-serif";
const BODY = "'Source Sans 3','Source Sans Pro','Helvetica Neue',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
const NAVY = '#192853';
const RED = '#962C32';
// Where "Let's build one" sends shoppers — a relative path so it resolves on
// whatever domain serves this page (the marketing site once proxied).
const QUOTE_URL = '/get-a-quote';

function shade(hex, pct) {
  if (!hex || hex[0] !== '#' || (hex.length !== 7)) return hex || NAVY;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = pct < 0 ? 0 : 255, p = Math.abs(pct) / 100;
  r = Math.round((t - r) * p) + r; g = Math.round((t - g) * p) + g; b = Math.round((t - b) * p) + b;
  return '#' + (r * 65536 + g * 256 + b).toString(16).padStart(6, '0');
}
function closesLabel(close_at) {
  if (!close_at) return null;
  const d = new Date(close_at);
  if (isNaN(d)) return null;
  const days = Math.ceil((d - Date.now()) / 86400000);
  if (days < 0) return null;
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return days <= 7 ? `Closes ${date} · ${days <= 0 ? 'today' : days + ' day' + (days === 1 ? '' : 's')} left` : `Open until ${date}`;
}

function Fonts() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700&family=Source+Sans+3:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        .ts-root *{box-sizing:border-box}
        .ts-root{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
        .ts-card{transition:transform .16s ease, box-shadow .16s ease}
        .ts-card:hover{transform:translateY(-5px);box-shadow:0 18px 40px rgba(15,26,56,.18)}
        .ts-input::placeholder{color:rgba(255,255,255,0.55)}
      `}</style>
    </>
  );
}

function StoreCard({ s }) {
  const primary = s.primary_color || NAVY;
  const accent = s.accent_color || RED;
  const closes = closesLabel(s.close_at);
  const stripes = 'repeating-linear-gradient(-55deg, transparent 0 26px, rgba(255,255,255,0.05) 26px 52px)';
  return (
    <a href={'/shop/' + s.slug} className="ts-card"
      style={{ display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 14px rgba(15,26,56,.10)', textDecoration: 'none', color: 'inherit' }}>
      <div style={{ position: 'relative', height: 150, background: s.banner_url ? `linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.5)), url(${s.banner_url}) center/cover` : `${stripes}, linear-gradient(135deg, ${primary}, ${shade(primary, -16)})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {s.logo_url
          ? <img src={s.logo_url} alt="" style={{ maxHeight: 96, maxWidth: '74%', objectFit: 'contain', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,.35))' }} />
          : <div style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center', padding: '0 16px', textShadow: '0 2px 8px rgba(0,0,0,.4)' }}>{s.name}</div>}
        <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: accent }} />
      </div>
      <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ fontFamily: DISPLAY, textTransform: 'uppercase', fontWeight: 800, fontSize: 19, letterSpacing: 0.3, lineHeight: 1.1, color: NAVY }}>{s.name}</div>
        {closes && <div style={{ fontSize: 12.5, color: '#64748b', fontWeight: 600, marginTop: 5 }}>{closes}</div>}
        <span style={{ marginTop: 14, alignSelf: 'flex-start', fontFamily: DISPLAY, fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#fff', background: accent, padding: '9px 18px', borderRadius: 8 }}>Shop the store →</span>
      </div>
    </a>
  );
}

// Strip characters that would break the PostgREST or() filter syntax.
const cleanTerm = (q) => String(q || '').replace(/[%,()*:]/g, ' ').trim();

export default function TeamStores() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null); // null = not searched yet; [] = no match
  const [searching, setSearching] = useState(false);
  const [openCount, setOpenCount] = useState(null);
  const [building, setBuilding] = useState(false); // public store-builder overlay
  const seq = useRef(0);

  useEffect(() => {
    document.title = 'Team Stores · National Sports Apparel';
    supabase.from('webstores_public').select('id', { count: 'exact', head: true })
      .eq('status', 'open').eq('public_listed', true)
      .then(({ count }) => setOpenCount(typeof count === 'number' ? count : null));
  }, []);

  // Debounced search — only runs once 2+ characters are typed.
  useEffect(() => {
    const term = cleanTerm(q);
    if (term.length < 2) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const { data } = await supabase.from('webstores_public')
        .select('slug,name,logo_url,primary_color,accent_color,banner_url,close_at')
        .eq('status', 'open').eq('public_listed', true)
        .or(`name.ilike.*${term}*,slug.ilike.*${term}*`)
        .order('name').limit(24);
      if (mine !== seq.current) return; // a newer keystroke superseded this one
      setResults(data || []);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const term = cleanTerm(q);
  return (
    <div className="ts-root" style={{ fontFamily: BODY, color: '#2A2F3E', minHeight: '100vh', background: '#F7F8FB' }}>
      <Fonts />
      {/* Hero + search */}
      <section style={{ position: 'relative', overflow: 'hidden', background: `repeating-linear-gradient(-55deg, transparent 0 30px, rgba(255,255,255,0.03) 30px 60px), linear-gradient(135deg, ${NAVY}, ${shade(NAVY, -18)})`, color: '#fff' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: 'clamp(40px,6vw,76px) 20px clamp(36px,5vw,56px)', textAlign: 'center' }}>
          <h1 style={{ fontFamily: DISPLAY, margin: '0 0 26px', fontSize: 'clamp(38px,6.5vw,72px)', letterSpacing: 0.3, textTransform: 'uppercase', lineHeight: 0.98, fontWeight: 800 }}>Find your <em style={{ fontStyle: 'italic', color: shade(RED, 26) }}>Team Store</em></h1>
          <div style={{ position: 'relative', maxWidth: 640, margin: '0 auto' }}>
            <span style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', fontSize: 18, opacity: 0.6 }}>🔍</span>
            <input className="ts-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by school, team, or organization name…"
              style={{ width: '100%', fontFamily: BODY, fontSize: 17, color: '#fff', padding: '16px 18px 16px 52px', borderRadius: 12, border: '1.5px solid rgba(255,255,255,0.28)', background: 'rgba(255,255,255,0.08)', outline: 'none' }} />
          </div>
          <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, flexWrap: 'wrap' }}>
            {openCount != null && <div style={{ fontFamily: DISPLAY, fontSize: 14, letterSpacing: 1.5, textTransform: 'uppercase', color: shade(RED, 30), fontWeight: 700 }}>{openCount} open store{openCount === 1 ? '' : 's'}</div>}
            <button type="button" onClick={() => setBuilding(true)}
              style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#fff', background: RED, border: 'none', padding: '11px 24px', borderRadius: 10, cursor: 'pointer' }}>Build your store →</button>
          </div>
        </div>
      </section>

      {/* Results — only after a search */}
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: 'clamp(24px,4vw,42px) 20px clamp(40px,6vw,72px)' }}>
        {term.length < 2
          ? <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 15, padding: '30px 20px' }}>Start typing your team or school name to find your store.</div>
          : searching
            ? <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 15, padding: '40px 20px' }}>Searching…</div>
            : (results && results.length)
              ? <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginBottom: 16, textAlign: 'center' }}>{results.length} store{results.length === 1 ? '' : 's'} matching “{term}”</div>
                  {/* Cap the column width (not 1fr) + center the tracks so a small
                      result set sits centered instead of hugging the left edge. */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 340px))', gap: 22, justifyContent: 'center' }}>
                    {results.map((s) => <StoreCard key={s.slug} s={s} />)}
                  </div>
                </>
              : <div style={{ textAlign: 'center', color: '#475569', fontSize: 16, padding: '40px 20px' }}>No open store matches “{term}”.</div>}
      </div>

      {/* Don't see your store? */}
      <section style={{ background: `repeating-linear-gradient(-55deg, transparent 0 30px, rgba(255,255,255,0.03) 30px 60px), linear-gradient(135deg, ${NAVY}, ${shade(NAVY, -12)})`, color: '#fff', textAlign: 'center', padding: 'clamp(36px,5vw,56px) 20px', borderTop: `3px solid ${RED}` }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 'clamp(24px,3.5vw,36px)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3 }}>Don't see your store? <span style={{ color: shade(RED, 28) }}>Let's build one.</span></div>
        <p style={{ margin: '10px auto 22px', maxWidth: 560, fontSize: 16, color: 'rgba(255,255,255,0.85)' }}>We set up custom team stores for schools, clubs, and organizations — gear delivered to your team with no upfront cost.</p>
        <button type="button" onClick={() => setBuilding(true)} style={{ display: 'inline-block', fontFamily: DISPLAY, fontSize: 16, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#fff', background: RED, border: 'none', padding: '13px 30px', borderRadius: 10, cursor: 'pointer' }}>Build your store →</button>
        <div style={{ marginTop: 14 }}>
          <a href={QUOTE_URL} style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.72)', textDecoration: 'underline', fontWeight: 600 }}>Prefer to talk to us? Request a quote →</a>
        </div>
      </section>

      {/* Public store builder — a full-screen overlay, lazy-loaded on demand. */}
      {building && (
        <Suspense fallback={<div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', fontFamily: BODY, fontWeight: 600 }}>Loading the builder…</div>}>
          <BuildStore onClose={() => setBuilding(false)} />
        </Suspense>
      )}
    </div>
  );
}
