/* eslint-disable */
// Public Team Stores directory — /team-stores
// A portal to every open, publicly-listed club store. Surfaced on the marketing
// site (nationalsportsapparel.com/team-stores) via the same Netlify proxy rewrite
// used for /livelook, so the browser URL stays on the marketing domain.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const DISPLAY = "'Barlow Condensed','Oswald','Helvetica Neue',Impact,sans-serif";
const BODY = "'Source Sans 3','Source Sans Pro','Helvetica Neue',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
const NAVY = '#192853';
const RED = '#962C32';

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
      {/* Header band — store banner if present, else its team colors */}
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

export default function TeamStores() {
  const [stores, setStores] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    document.title = 'Team Stores · National Sports Apparel';
    (async () => {
      const { data, error } = await supabase.from('webstores_public')
        .select('slug,name,logo_url,primary_color,accent_color,banner_url,close_at')
        .eq('status', 'open').eq('public_listed', true)
        .order('name');
      if (error) { setErr(error.message); setStores([]); return; }
      setStores(data || []);
    })();
  }, []);
  return (
    <div className="ts-root" style={{ fontFamily: BODY, color: '#2A2F3E', minHeight: '100vh', background: '#F7F8FB' }}>
      <Fonts />
      {/* Hero */}
      <section style={{ position: 'relative', overflow: 'hidden', background: `repeating-linear-gradient(-55deg, transparent 0 30px, rgba(255,255,255,0.03) 30px 60px), linear-gradient(135deg, ${NAVY}, ${shade(NAVY, -18)})`, color: '#fff' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: 'clamp(34px,5vw,60px) 20px clamp(30px,4vw,48px)' }}>
          <div style={{ display: 'inline-block', background: RED, color: '#fff', fontFamily: DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', padding: '7px 18px', marginBottom: 16, transform: 'skewX(-5deg)' }}>
            <span style={{ display: 'inline-block', transform: 'skewX(5deg)' }}>National Sports Apparel</span>
          </div>
          <h1 style={{ fontFamily: DISPLAY, margin: 0, fontSize: 'clamp(36px,6vw,68px)', letterSpacing: 0.3, textTransform: 'uppercase', lineHeight: 0.98, fontWeight: 800 }}>Team <em style={{ fontStyle: 'italic', color: shade(RED, 22) }}>Stores</em></h1>
          <p style={{ margin: '14px 0 0', maxWidth: 620, fontSize: 17, lineHeight: 1.5, color: 'rgba(255,255,255,0.86)', fontWeight: 500 }}>Shop your team's official store — coach-approved gear, delivered to the club.</p>
        </div>
      </section>

      <div style={{ maxWidth: 1180, margin: '0 auto', padding: 'clamp(28px,4vw,46px) 20px clamp(56px,7vw,88px)' }}>
        {stores == null
          ? <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 15, padding: '60px 20px' }}>Loading team stores…</div>
          : stores.length === 0
            ? <div style={{ textAlign: 'center', color: '#64748b', fontSize: 16, padding: '60px 20px' }}>No team stores are open right now — check back soon.</div>
            : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}>
                {stores.map((s) => <StoreCard key={s.slug} s={s} />)}
              </div>}
        {err && <div style={{ textAlign: 'center', color: '#b91c1c', fontSize: 13, marginTop: 16 }}>Could not load stores: {err}</div>}
      </div>

      <footer style={{ background: `linear-gradient(120deg, ${NAVY}, ${shade(NAVY, -10)})`, color: 'rgba(255,255,255,0.82)', textAlign: 'center', padding: '30px 20px', borderTop: `3px solid ${RED}` }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 20, letterSpacing: 1, textTransform: 'uppercase', color: '#fff' }}>National Sports Apparel</div>
        <div style={{ fontSize: 12, letterSpacing: 0.5, marginTop: 6, opacity: 0.7 }}>Custom team apparel · Powered by NSA</div>
      </footer>
    </div>
  );
}
