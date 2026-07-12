import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import {
  NAVY, NAVY_DARK, RED, RED_SOFT, OFF_WHITE, BORDER, BORDER_DARK,
  TEXT, TEXT_MUTED, TEXT_FAINT, GREEN, displayType,
} from './theme';
import { searchPublicTeamStores, closesLabel, cleanTerm } from '../lib/publicTeamStores';

// "Team Stores" — rebuilt against the ACTUAL Claude Design source this time
// (scratchpad design/TeamStores.dc.html, a design-canvas file: static
// sections + a React-ish script block driving THEMES/SPORTS/garment() SVGs).
// Section-by-section translation, in the design's own order:
//   HERO -> FOUR PITCHES -> ONE-CLICK BUILDER -> EXAMPLE STORE PREVIEW
//   (the centerpiece) -> FIND YOUR STORE (real functionality, no design slot)
//   -> HOW IT WORKS -> FUNDRAISING CALLOUT -> LAUNCH CTA.
//
// What intentionally departs from the mock, and why:
//   - PRICING: the mock's product cards show {{ p.price }} (illustrative
//     dollar figures). Per the owner's explicit override, no $ prices render
//     anywhere on this page — product cards keep name, swatch dots, stock
//     badge, and the "View ->" affordance, nothing invented.
//   - HERO / EXAMPLE STORE screenshots: the mock cycles real store
//     screenshots (STORE_IMGS) inside the hero frame. Those photo assets
//     aren't available here, so both the hero and the example-store
//     centerpiece are built as in-page CSS/SVG store mocks (garment() SVGs
//     translated to JSX) instead — same visual language, no binary assets,
//     no fake photography. The hero still cycles three differently-themed
//     mocks with the 600ms fade, slug swap, ~4s rotation, reduced-motion
//     guard, and pause-on-hover the mock specifies.
//   - The one-click builder ("Pick your colors. Drop your logo. Done.") IS
//     fully interactive — sport/gender/colors/logo are real React state and
//     the live preview recolors immediately (reusing Garment/DemoStore's
//     --tp/--tp2/--ta vars). The one piece that's illustrative is the
//     "Launch" action itself: real store creation is rep-led, not literally
//     one click, so clicking Launch flips a local "your store is live"
//     confirmation with no backend call, and its follow-up link reuses the
//     exact same rep-contact destination (CONTACT_HREF) as the hero CTA —
//     no invented store-creation endpoint.
//   - "Find your store" search is REAL: the same webstores_public query the
//     portal's /team-stores finder uses (src/lib/publicTeamStores.js — one
//     query path, not two), extended to also surface recently-closed stores
//     (marked closed) so a late searcher gets an answer, not a dead end. The
//     mock has no slot for this, so it's its own section, styled to match.
//   - FUNDRAISING CALLOUT: the mock's right-column card does client-side
//     money math ("$1,200 raised" off a made-up average order). That's
//     dropped — the layout/visual treatment is kept, but the numbers are
//     replaced with how the mechanism works, not a fabricated payout.
//   - All CTA hrefs/handlers stay wired to the shipped rep-led flow
//     (CONTACT_HREF / goFind) — the mock's literal "Launch a store" /
//     "#launch" self-service links are relabeled to match.

const CONTACT_HREF = 'mailto:info@nationalsportsapparel.com?subject=Team%20store%20for%20my%20program';

// ---------------------------------------------------------------------------
// Shared visual building blocks — translated from the mock's garment() SVG
// generator and THEMES/product data (script block, ~line 453 & 545 of the
// design file).
// ---------------------------------------------------------------------------

// Six store color palettes from the mock's THEMES array — drives the "See it
// in your colors" swatch selector via CSS custom properties on the demo
// store, exactly as the mock does (--tp / --tp2 / --ta).
const THEMES = [
  { name: 'Royal & Gold', primary: '#0E2A6B', light: '#123a8f', accent: '#F5B429' },
  { name: 'Navy & Gold', primary: '#12213F', light: '#1c3160', accent: '#F5B429' },
  { name: 'Crimson & Gold', primary: '#7A121E', light: '#9c1a2a', accent: '#F0B429' },
  { name: 'Forest & Gold', primary: '#113B29', light: '#1a5a3f', accent: '#F5B429' },
  { name: 'Purple & Gold', primary: '#3A1D66', light: '#512a8c', accent: '#F5B429' },
  { name: 'Black & Vegas', primary: '#1A1D22', light: '#2A2F3E', accent: '#E7B84B' },
];

// The mock's "reusable team gear placeholder illustration in the customer's
// colors" (garment(kind, tone, letter)), translated 1:1 to JSX. Reads its
// theme from the nearest --tp/--tp2/--ta CSS custom properties, same as the
// mock.
function Garment({ kind, tone }) {
  const body = tone === 'white' ? '#F1F3F7' : tone === 'black' ? '#23262B' : 'var(--tp2, #123a8f)';
  const stroke = tone === 'white' ? '#C9D0DC' : tone === 'black' ? '#3a3f47' : 'var(--tp, #0E2A6B)';
  const sleeveLong = kind !== 'tee';
  const crestX = kind === 'shorts' ? 54 : 46;
  const crestY = kind === 'shorts' ? 60 : 46;
  const crestInk = tone === 'white' ? 'var(--ta, #F5B429)' : 'var(--tp, #0E2A6B)';
  return (
    <svg width="62%" height="62%" viewBox="0 0 92 96" fill="none" aria-hidden="true">
      {kind !== 'shorts' && (
        <>
          <path
            d={sleeveLong
              ? 'M34 20 L46 14 L54 20 L62 30 L56 40 L50 36 L50 84 L18 84 L18 36 L12 40 L6 30 L14 20 L26 14 Z'
              : 'M34 22 L46 16 L54 22 L66 30 L60 42 L50 37 L50 84 L18 84 L18 37 L8 42 L2 30 L14 22 L26 16 Z'}
            transform="translate(6 4)"
            fill={body}
            stroke={stroke}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {kind === 'hoodie' && (
            <path d="M40 18 q10 8 20 0 q-2 12 -10 12 q-8 0 -10 -12 Z" transform="translate(6 4)" fill={stroke} opacity={0.5} />
          )}
        </>
      )}
      {kind === 'shorts' && (
        <path
          d="M16 20 L64 20 L60 74 L44 74 L40 40 L36 74 L20 74 Z"
          transform="translate(6 4)"
          fill={body}
          stroke={stroke}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      )}
      <g transform={`translate(${crestX} ${crestY})`}>
        <circle r={9} fill={tone === 'white' ? 'var(--tp2, #123a8f)' : 'var(--ta, #F5B429)'} opacity={0.95} />
        <path d="M-4 -1 L0 -5 L4 -1 L2 4 L-2 4 Z" fill={crestInk} />
      </g>
    </svg>
  );
}

const TILE_BG = {
  royal: 'linear-gradient(150deg, #F7F9FC, #E9EEF6)',
  white: 'linear-gradient(150deg, #FFFFFF, #EEF1F6)',
  black: 'linear-gradient(150deg, #F2F3F5, #E4E6EA)',
};

// The mock's storeProducts (4 items) — price dropped everywhere per the
// owner's pricing rule; everything else (name, stock, tone) kept.
const STORE_PRODUCTS = [
  { name: 'PosiCharge Hooded Pullover', tone: 'royal', kind: 'hoodie', inStock: true },
  { name: 'Long Sleeve Competitor Tee', tone: 'royal', kind: 'ls', inStock: true },
  { name: 'PosiCharge Competitor Tee', tone: 'white', kind: 'tee', inStock: true },
  { name: 'Repeat 7" Short', tone: 'black', kind: 'shorts', inStock: false },
];

function swatchDotStyle(color) {
  return { width: 14, height: 14, borderRadius: 999, background: color, border: '1px solid rgba(15,26,56,0.15)', flexShrink: 0 };
}

function toneSwatches(tone) {
  if (tone === 'white') return [swatchDotStyle('var(--tp2, #123a8f)'), swatchDotStyle('#F1F3F7')];
  if (tone === 'black') return [swatchDotStyle('#23262B'), swatchDotStyle('#5A6075')];
  return [swatchDotStyle('var(--tp2, #123a8f)'), swatchDotStyle('#F1F3F7')];
}

// ---------------------------------------------------------------------------
// ONE-CLICK BUILDER data — copied from the mock's SPORTS/BPRIMS/SECONDARIES/
// BLOGOS/MENS_ITEMS/WOMENS_ITEMS (script block, ~lines 462-542 of the design
// file). The builder itself is real, interactive React state (see
// TeamStoresPage below) — only the store-creation *action* is illustrative
// (see the CONTACT_HREF note on the Launch button further down).
// ---------------------------------------------------------------------------
const SPORTS = [
  { name: 'Football', icon: 'M4 12c0-4 3-7 8-7s8 3 8 7-3 7-8 7-8-3-8-7z M9 12h6 M12 9.5v5' },
  { name: 'Basketball', icon: 'M3 12h18 M12 3v18 M5 5c4 3 4 11 0 14 M19 5c-4 3-4 11 0 14' },
  { name: 'Soccer', icon: 'M12 3l3 2-1 4h-4l-1-4z M6 9l3 1 1 4-3 2-3-3z M18 9l-3 1-1 4 3 2 3-3z' },
  { name: 'Baseball', icon: 'M6 5c4 3 6 9 6 14 M18 5c-4 3-6 9-6 14' },
  { name: 'Volleyball', icon: 'M12 3v18 M12 12c-5 0-8-3-9-6 M12 12c5 0 8-3 9-6 M12 12c-2 4-5 6-9 6' },
];

const BPRIMS = [
  { name: 'Navy', primary: '#0E2A6B', light: '#123a8f' },
  { name: 'Royal', primary: '#123a8f', light: '#2350b0' },
  { name: 'Crimson', primary: '#7A121E', light: '#9c1a2a' },
  { name: 'Forest', primary: '#113B29', light: '#1a5a3f' },
  { name: 'Purple', primary: '#3A1D66', light: '#512a8c' },
  { name: 'Teal', primary: '#0F5C63', light: '#157a83' },
  { name: 'Black', primary: '#1A1D22', light: '#2A2F3E' },
];

const SECONDARIES = [
  { name: 'Gold', color: '#F5B429', ink: '#0E2A6B' },
  { name: 'White', color: '#FFFFFF', ink: '#0E2A6B' },
  { name: 'Silver', color: '#C7CDD6', ink: '#1A1D22' },
  { name: 'Columbia', color: '#6CADE0', ink: '#0E2A6B' },
  { name: 'Scarlet', color: '#C8102E', ink: '#FFFFFF' },
  { name: 'Kelly', color: '#1E7A46', ink: '#FFFFFF' },
];

const BLOGOS = [
  { letter: 'E', name: 'Eastside Eagles' },
  { letter: 'W', name: 'Valley Wildcats' },
  { letter: 'T', name: 'Harbor Titans' },
];

const MENS_ITEMS = [
  { kind: 'hoodie', tone: 'royal', label: 'Hooded Pullover' },
  { kind: 'ls', tone: 'royal', label: 'Long Sleeve Tee' },
  { kind: 'tee', tone: 'white', label: 'Competitor Tee' },
  { kind: 'ls', tone: 'black', label: 'Warm-Up Top' },
  { kind: 'tee', tone: 'royal', label: 'Team Polo' },
  { kind: 'shorts', tone: 'black', label: '7" Short' },
  { kind: 'ls', tone: 'royal', label: 'Quarter-Zip' },
  { kind: 'tee', tone: 'black', label: 'Crewneck Tee' },
  { kind: 'shorts', tone: 'royal', label: 'Joggers' },
];

const WOMENS_ITEMS = [
  { kind: 'hoodie', tone: 'royal', label: 'Fitted Hoodie' },
  { kind: 'ls', tone: 'royal', label: 'Long Sleeve Tee' },
  { kind: 'tee', tone: 'white', label: 'Fitted Tee' },
  { kind: 'ls', tone: 'black', label: 'Quarter-Zip' },
  { kind: 'tee', tone: 'royal', label: 'V-Neck Polo' },
  { kind: 'shorts', tone: 'black', label: '5" Short' },
  { kind: 'tee', tone: 'royal', label: 'Crewneck' },
  { kind: 'hoodie', tone: 'black', label: 'Full-Zip' },
  { kind: 'shorts', tone: 'royal', label: 'Leggings' },
];

// One sport chip's icon — stroke brightens when its chip is the active pick.
function SportIcon({ path, active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#fff' : 'rgba(255,255,255,0.55)'} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

// The mock's browser-framed, CSS-custom-property-themed demo store
// (EXAMPLE STORE PREVIEW, lines 249-315 of the design file). Used both as
// the full interactive centerpiece and — via `compact` — reused (per the
// task's "scaled-down variant is fine") as the hero's cycling store mocks.
function DemoStore({
  theme, teamName, compact = false,
}) {
  const vars = { '--tp': theme.primary, '--tp2': theme.light, '--ta': theme.accent };
  return (
    <div style={{ background: '#fff', ...vars, ...(compact ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } : {}) }}>
      {/* announcement bar */}
      <div
        style={{
          background: 'var(--tp)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, padding: compact ? '6px 14px' : '9px clamp(16px, 2.5vw, 32px)', fontSize: compact ? 9.5 : 12, letterSpacing: '0.05em', flexWrap: 'wrap',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 600, whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--ta)' }}>★</span> OFFICIAL TEAM STORE
        </span>
        {!compact && <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>SHIPS TO EACH FAMILY</span>}
      </div>

      {/* store header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: compact ? '10px 14px' : '18px clamp(16px, 2.5vw, 32px)', borderBottom: `1px solid ${BORDER}`, flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 14, minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              width: compact ? 28 : 46, height: compact ? 28 : 46, borderRadius: 8, background: 'var(--tp)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <svg width={compact ? 16 : 26} height={compact ? 16 : 26} viewBox="0 0 24 24" fill="none" stroke="var(--ta)" strokeWidth="1.5">
              <path d="M3 6l9-3 9 3-9 4z" /><path d="M7 10v5c0 2 10 2 10 0v-5" />
            </svg>
          </span>
          <div style={{ lineHeight: 1.15, minWidth: 0 }}>
            {!compact && <div style={displayType(11, { letterSpacing: '0.1em', color: 'var(--ta)' })}>Official Team Store</div>}
            <div style={{ ...displayType(compact ? 12.5 : 'clamp(18px, 2vw, 23px)', { fontWeight: 700, letterSpacing: '0.02em', color: 'var(--tp)' }), whiteSpace: compact ? 'nowrap' : 'normal', overflow: compact ? 'hidden' : 'visible', textOverflow: compact ? 'ellipsis' : 'clip' }}>
              {teamName}
            </div>
          </div>
        </div>
        {!compact && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: 'var(--tp)', color: '#fff', fontWeight: 700, fontSize: 13, letterSpacing: '0.05em', padding: '11px 18px', borderRadius: 8 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8h12l-1 12H7z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>
            CART <span style={{ background: 'var(--ta)', color: 'var(--tp)', borderRadius: 999, minWidth: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>0</span>
          </span>
        )}
      </div>

      {/* store nav — full variant only, no room in the compact hero card */}
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px clamp(16px, 2.5vw, 32px)', borderBottom: `1px solid ${BORDER}`, flexWrap: 'wrap' }}>
          <span style={{ ...displayType(14, { fontWeight: 700, color: 'var(--tp)' }), borderBottom: '3px solid var(--ta)', paddingBottom: 5 }}>All Gear</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#F5F6F8', color: '#8790A5', borderRadius: 8, padding: '8px 14px', fontSize: 13, minWidth: 220 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            Search the store
          </span>
        </div>
      )}

      {/* store hero — striped gradient, Spirit Pack badge, stat trio, jersey grid */}
      <div
        style={{
          position: 'relative', background: 'linear-gradient(120deg, var(--tp2), var(--tp))', overflow: 'hidden',
          padding: compact ? '16px 14px' : 'clamp(24px, 3vw, 44px) clamp(16px, 2.5vw, 40px)',
          display: 'grid', gridTemplateColumns: compact ? '1.1fr 1fr' : 'repeat(auto-fit, minmax(260px, 1fr))', gap: compact ? 12 : 24,
          alignItems: 'center', flex: 'none',
        }}
      >
        <span aria-hidden="true" style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 22px)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <span style={{ display: 'inline-block', background: 'var(--ta)', color: 'var(--tp)', ...displayType(compact ? 9.5 : 12, { fontWeight: 700 }), padding: compact ? '4px 9px' : '6px 12px', borderRadius: 5, marginBottom: compact ? 8 : 16 }}>
            Spirit Pack · Now Open
          </span>
          <h3 style={{ ...displayType(compact ? '15px' : 'clamp(1.8rem, 3.6vw, 2.8rem)', { fontWeight: 700, lineHeight: 0.95, color: '#fff' }), margin: compact ? '0 0 6px' : '0 0 14px' }}>
            {teamName.replace(' Team Store', '')} <span style={{ color: 'var(--ta)' }}>Team Store</span>
          </h3>
          {!compact && (
            <>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: 'rgba(255,255,255,0.82)', margin: '0 0 22px', maxWidth: 400 }}>
                Hand-picked and approved by your coaching staff, so you can order with confidence.
              </p>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, border: '1.5px solid rgba(255,255,255,0.5)', color: '#fff', ...displayType(14, { fontWeight: 600 }), padding: '12px 22px', borderRadius: 6 }}>
                Shop the collection
              </span>
              <div style={{ display: 'flex', gap: 26, marginTop: 26 }}>
                {[['No', 'Minimums'], ['Top', 'Brands'], ['Ship', 'To Families']].map(([big, small], i) => (
                  <div key={small}>
                    <div style={{ ...displayType(26, { fontWeight: 700, lineHeight: 1 }), color: i === 2 ? 'var(--ta)' : '#fff' }}>{big}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>{small}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1.3fr 1fr', gridTemplateRows: '1fr 1fr', gap: compact ? 8 : 12, minHeight: compact ? 120 : 220 }}>
          <div style={{ gridRow: '1 / span 2', background: '#fff', borderRadius: compact ? 8 : 12, boxShadow: '0 12px 30px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Garment kind="hoodie" tone="royal" />
          </div>
          <div style={{ background: '#fff', borderRadius: compact ? 8 : 12, boxShadow: '0 12px 30px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Garment kind="ls" tone="white" />
          </div>
          <div style={{ background: '#fff', borderRadius: compact ? 8 : 12, boxShadow: '0 12px 30px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Garment kind="ls" tone="royal" />
          </div>
        </div>
      </div>

      {/* store product grid — compact gets a 3-up mini strip that fills the rest of
          the hero card; full variant gets the complete cards. No illustrative prices. */}
      {compact && (
        <div style={{ background: '#FAF7F0', padding: 12, flex: 1, minHeight: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, height: '100%' }}>
            {STORE_PRODUCTS.slice(0, 3).map((p) => (
              <div key={p.name} style={{ background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,26,56,0.08)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ position: 'relative', flex: 1, minHeight: 0, background: TILE_BG[p.tone], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Garment kind={p.kind} tone={p.tone} />
                </div>
                <div style={{ padding: '6px 8px', ...displayType(9, { color: 'var(--tp)', lineHeight: 1.2 }), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!compact && (
        <div style={{ background: '#FAF7F0', padding: 'clamp(22px, 3vw, 36px) clamp(18px, 2.5vw, 32px)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 }}>
            {STORE_PRODUCTS.map((p) => (
              <div
                key={p.name}
                className="nts-card"
                style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,26,56,0.08)', display: 'flex', flexDirection: 'column' }}
              >
                <div style={{ position: 'relative', aspectRatio: '1 / 1', background: TILE_BG[p.tone], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span
                    style={{
                      position: 'absolute', top: 10, right: 10, background: p.inStock ? GREEN : 'var(--tp)', color: '#fff',
                      ...displayType(10, { letterSpacing: '0.06em' }), padding: '4px 9px', borderRadius: 5,
                    }}
                  >
                    {p.inStock ? 'In Stock' : 'Sold Out'}
                  </span>
                  <Garment kind={p.kind} tone={p.tone} />
                </div>
                <div style={{ padding: '14px 15px 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                  <div style={displayType(14, { color: 'var(--tp)', lineHeight: 1.2 })}>{p.name}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {toneSwatches(p.tone).map((s, i) => <span key={i} style={s} />)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 8 }}>
                    <span style={{ ...displayType(12, { letterSpacing: '0.06em', color: '#B8860B' }), display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      View <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
    body: 'We produce every order in-house and ship direct to each family, with automated tracking emails throughout.',
  },
  {
    n: 4,
    title: 'You get paid',
    body: 'After the window closes, your rep totals your fundraising margin and sends your program one clean payout.*',
  },
];

// Three differently-themed CSS store mocks for the hero to cycle through
// (screenshots aren't available — see file header). Distinct sports/palettes
// so the rotation reads as "real stores," not one card recolored.
const HERO_STORES = [
  { slug: 'oak-grove-football', teamName: 'Oak Grove Football Team Store', theme: THEMES[1] }, // Navy & Gold
  { slug: 'riverside-baseball', teamName: 'Riverside Baseball Team Store', theme: THEMES[2] }, // Crimson & Gold
  { slug: 'eastside-soccer', teamName: 'Eastside Soccer Team Store', theme: THEMES[3] }, // Forest & Gold
];
const HERO_AUTO_MS = 3800;

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

  // ---- Hero store-mock cycler (mirrors Home.js's hero slider pattern:
  //      a single interval that keeps ticking, gated by refs so hover-pause
  //      and prefers-reduced-motion don't need to tear the timer down). ----
  const [heroIdx, setHeroIdx] = useState(0);
  const heroPausedRef = useRef(false);
  const heroReducedMotionRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    heroReducedMotionRef.current = mq.matches;
    const onChange = (e) => { heroReducedMotionRef.current = e.matches; };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (heroPausedRef.current || heroReducedMotionRef.current) return;
      setHeroIdx((i) => (i + 1) % HERO_STORES.length);
    }, HERO_AUTO_MS);
    return () => clearInterval(id);
  }, []);

  const pauseHero = () => { heroPausedRef.current = true; };
  const resumeHero = () => { heroPausedRef.current = false; };
  const heroStore = HERO_STORES[heroIdx];

  // ---- Example store theme switcher ("See it in your colors") ----
  const [storeThemeIdx, setStoreThemeIdx] = useState(0);
  const storeTheme = THEMES[storeThemeIdx];
  const exampleStore = useMemo(() => ({ teamName: 'Oak Grove Football Team Store', slug: 'oak-grove-football' }), []);

  // ---- One-click builder ("Pick your colors. Drop your logo. Done.") ----
  // Real interactive state — the live preview recolors as these change, via
  // the same --tp/--tp2/--ta custom properties Garment/DemoStore already key
  // off. Store creation itself stays rep-led (see the Launch button below):
  // this is a visual confirmation, not a self-service create action.
  const [bSport, setBSport] = useState(0);
  const [bGender, setBGender] = useState('mens');
  const [bPrim, setBPrim] = useState(0);
  const [bSec, setBSec] = useState(0);
  const [bLogo, setBLogo] = useState('E');
  const [bLaunched, setBLaunched] = useState(false);
  const builderPrim = BPRIMS[bPrim];
  const builderSec = SECONDARIES[bSec];
  const builderItems = bGender === 'womens' ? WOMENS_ITEMS : MENS_ITEMS;

  return (
    <div style={{ width: '100%', overflowX: 'hidden', background: '#fff' }}>
      {/* ============ HERO ============ */}
      <section style={{ position: 'relative', background: `linear-gradient(120deg, ${NAVY_DARK} 0%, ${NAVY} 55%, #1c2d4f 100%)`, color: '#fff', overflow: 'hidden' }}>
        <span aria-hidden="true" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'clamp(90px, 16%, 280px)', background: '#22335c' }} />
        <div style={{ position: 'relative', maxWidth: 1280, margin: '0 auto', padding: 'clamp(48px, 6vw, 88px) 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'clamp(32px, 4vw, 56px)', alignItems: 'center' }}>
          <div>
            <p style={{ ...displayType(13, { letterSpacing: '0.18em', color: RED_SOFT, margin: '0 0 20px' }), display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <span aria-hidden="true" style={{ width: 30, height: 2, background: RED_SOFT, display: 'inline-block' }} />
              Online Team Stores
            </p>
            <h1 style={displayType('clamp(2.6rem, 5.5vw, 4.4rem)', { lineHeight: 0.98, letterSpacing: '0.01em', margin: '0 0 20px', maxWidth: '16ch' })}>
              A storefront for your program — up in days.
            </h1>
            <p style={{ fontSize: 'clamp(16px, 1.5vw, 19px)', lineHeight: 1.6, color: 'rgba(255,255,255,0.78)', maxWidth: 520, margin: '0 0 34px' }}>
              We build a branded store for your team. Families order and pay directly, gear ships to their door, and your program earns on every sale — with zero inventory to manage.
            </p>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <a
                className="nts-cta-red"
                href={CONTACT_HREF}
                style={{ fontWeight: 600, fontSize: 17, padding: '16px 30px', borderRadius: 8, background: RED, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.02em' }}
              >
                Talk to your rep about a store
              </a>
              <button
                type="button"
                className="nts-ghost"
                onClick={goFind}
                style={{ fontFamily: 'inherit', fontWeight: 600, fontSize: 17, padding: '16px 30px', borderRadius: 8, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', cursor: 'pointer' }}
              >
                See an example store
              </button>
            </div>
            <div style={{ display: 'flex', gap: 'clamp(24px, 3vw, 44px)', marginTop: 36, flexWrap: 'wrap' }}>
              {[['24/7', 'Open to order'], ['$0', 'Upfront cost'], ['~1 wk', 'To go live*']].map(([big, small], i) => (
                <React.Fragment key={small}>
                  {i > 0 && <div aria-hidden="true" style={{ width: 1, background: 'rgba(255,255,255,0.15)' }} />}
                  <div>
                    <div style={{ ...displayType('clamp(2rem, 3vw, 2.6rem)', { fontWeight: 700, lineHeight: 1 }), ...(i === 2 ? { color: '#F3B0B4' } : {}) }}>{big}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 5 }}>{small}</div>
                  </div>
                </React.Fragment>
              ))}
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>*Typical timeline once you confirm colors and logo with your rep — can vary by season.</p>
          </div>

          {/* Perspective-tilted, cycling store mock — pure CSS/SVG (Garment +
              DemoStore compact variant), no binary screenshot assets. */}
          <div style={{ perspective: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div
              style={{ position: 'relative', width: '100%', maxWidth: 500, transform: 'rotate(4deg) rotateY(11deg) rotateX(4deg)', transformStyle: 'preserve-3d' }}
              onMouseEnter={pauseHero}
              onMouseLeave={resumeHero}
              onFocus={pauseHero}
              onBlur={resumeHero}
            >
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 7,
                  background: 'rgba(15,26,56,0.82)', backdropFilter: 'blur(4px)', color: 'rgba(255,255,255,0.9)', border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 999, padding: '6px 14px', fontSize: 11.5, whiteSpace: 'nowrap',
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                nationalteamshop.com/store/{heroStore.slug}
              </span>
              <div style={{ aspectRatio: '0.95', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 50px 90px rgba(0,0,0,0.5), 0 12px 30px rgba(0,0,0,0.35)', display: 'flex' }}>
                <div key={heroIdx} style={{ flex: 1, display: 'flex', flexDirection: 'column', animation: heroReducedMotionRef.current ? 'none' : 'nts-ts-fade 600ms ease' }} aria-hidden="true">
                  <DemoStore theme={heroStore.theme} teamName={heroStore.teamName} slug={heroStore.slug} compact />
                </div>
              </div>
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute', bottom: 16, right: 16, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: NAVY_DARK,
                  borderRadius: 999, padding: '8px 14px', ...displayType(12, { fontWeight: 700 }), boxShadow: '0 8px 20px rgba(0,0,0,0.28)',
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 999, background: GREEN }} />
                Live store
              </span>
            </div>
          </div>
        </div>
        <span aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0, height: 4, width: '100%', background: RED }} />
      </section>

      {/* ============ FOUR PITCHES ============ */}
      <section style={{ maxWidth: 1280, margin: '0 auto', padding: 'clamp(48px, 6vw, 88px) 24px' }}>
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

      {/* ============ ONE-CLICK BUILDER ============
          Full interactive store-launcher: sport, team colors, and logo are
          real React state, and the live preview recolors as they change
          (Garment already reads --tp/--tp2/--ta). The one thing that ISN'T
          self-service is store creation itself — that's still rep-led, so
          "Launch" is an illustrative confirmation (no backend call), and its
          follow-up link reuses the exact same rep-contact destination as the
          hero's "Talk to your rep about a store" CTA (CONTACT_HREF). */}
      <section style={{ background: NAVY_DARK, color: '#fff', padding: 'clamp(36px, 4.5vw, 64px) 24px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', maxWidth: 620, margin: '0 auto 32px' }}>
            <p style={displayType(13, { letterSpacing: '0.16em', color: RED_SOFT, margin: '0 0 12px' })}>One-click store creation</p>
            <h2 style={displayType('clamp(2rem, 3.6vw, 2.7rem)', { margin: '0 0 14px', lineHeight: 1.02, letterSpacing: '0.01em' })}>Pick your colors. Drop your logo. Done.</h2>
            <p style={{ fontSize: 'clamp(15px, 1.4vw, 17px)', lineHeight: 1.6, color: 'rgba(255,255,255,0.72)', margin: 0 }}>
              Pick your sport, add your logo and team colors once — it lands on every product in the store automatically. No per-item setup, no design files to wrangle.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'clamp(18px, 2.5vw, 28px)', alignItems: 'stretch' }}>

            {/* CONTROLS */}
            <div style={{ background: NAVY, border: '1px solid #1c2d4f', borderRadius: 16, padding: 'clamp(18px, 2vw, 24px)' }}>
              {/* Step 1 — sport + gender toggle */}
              <div style={{ marginBottom: 15 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 9 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 999, background: RED_SOFT, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', ...displayType(14) }}>1</span>
                    <span style={displayType(16, { letterSpacing: '0.08em' })}>Pick your sport</span>
                  </div>
                  <div style={{ display: 'flex', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: 3, minWidth: 168 }}>
                    <button
                      type="button"
                      onClick={() => setBGender('mens')}
                      style={{
                        flex: 1, padding: '9px 14px', border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                        fontWeight: 600, fontSize: 14, background: bGender === 'mens' ? '#fff' : 'transparent', color: bGender === 'mens' ? NAVY : 'rgba(255,255,255,0.7)',
                      }}
                    >
                      Men&apos;s
                    </button>
                    <button
                      type="button"
                      onClick={() => setBGender('womens')}
                      style={{
                        flex: 1, padding: '9px 14px', border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                        fontWeight: 600, fontSize: 14, background: bGender === 'womens' ? '#fff' : 'transparent', color: bGender === 'womens' ? NAVY : 'rgba(255,255,255,0.7)',
                      }}
                    >
                      Women&apos;s
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {SPORTS.map((sp, i) => {
                    const active = i === bSport;
                    return (
                      <button
                        key={sp.name}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setBSport(i)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 9, padding: '10px 15px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                          background: active ? RED_SOFT : 'rgba(255,255,255,0.06)', border: `1px solid ${active ? RED_SOFT : 'rgba(255,255,255,0.14)'}`,
                          color: '#fff', ...displayType(15, { letterSpacing: '0.05em' }),
                        }}
                      >
                        <SportIcon path={sp.icon} active={active} />
                        {sp.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2 — team colors */}
              <div style={{ marginBottom: 15 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 999, background: RED_SOFT, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', ...displayType(14) }}>2</span>
                  <span style={displayType(16, { letterSpacing: '0.08em' })}>Team colors</span>
                </div>
                <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
                  <div>
                    <span style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.55)', marginBottom: 9 }}>Primary</span>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {BPRIMS.map((c, i) => {
                        const active = i === bPrim;
                        return (
                          <button
                            key={c.name}
                            type="button"
                            aria-label={c.name}
                            aria-pressed={active}
                            onClick={() => setBPrim(i)}
                            style={{
                              position: 'relative', width: 36, height: 36, borderRadius: 999, padding: 0, cursor: 'pointer', background: c.primary,
                              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)', border: `2px solid ${active ? '#fff' : 'transparent'}`,
                              outline: active ? `2px solid ${RED_SOFT}` : 'none', transform: active ? 'scale(1.1)' : 'scale(1)', transition: 'all 150ms ease',
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.55)', marginBottom: 9 }}>Secondary</span>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {SECONDARIES.map((s, i) => {
                        const active = i === bSec;
                        return (
                          <button
                            key={s.name}
                            type="button"
                            aria-label={s.name}
                            aria-pressed={active}
                            onClick={() => setBSec(i)}
                            style={{
                              position: 'relative', width: 36, height: 36, borderRadius: 999, padding: 0, cursor: 'pointer', background: s.color,
                              boxShadow: 'inset 0 0 0 1px rgba(15,26,56,0.12)', border: `2px solid ${active ? '#fff' : 'transparent'}`,
                              outline: active ? `2px solid ${RED_SOFT}` : 'none', transform: active ? 'scale(1.1)' : 'scale(1)', transition: 'all 150ms ease',
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 3 — logo */}
              <div style={{ marginBottom: 15 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 999, background: RED_SOFT, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', ...displayType(14) }}>3</span>
                  <span style={displayType(16, { letterSpacing: '0.08em' })}>Add your logo</span>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {BLOGOS.map((l) => {
                    const active = l.letter === bLogo;
                    return (
                      <button
                        key={l.letter}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setBLogo(l.letter)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 8px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                          background: active ? OFF_WHITE : '#fff', border: `1.5px solid ${active ? NAVY : BORDER}`,
                        }}
                      >
                        <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', ...displayType(16) }}>{l.letter}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, color: NAVY }}>{l.name}</span>
                      </button>
                    );
                  })}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px dashed rgba(255,255,255,0.35)', borderRadius: 10, padding: '9px 14px', color: 'rgba(255,255,255,0.8)', fontWeight: 600, fontSize: 13 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                    Upload
                  </span>
                </div>
              </div>

              {/* Launch — illustrative confirmation only; no store-creation
                  backend call. The follow-up link reuses the hero's rep
                  contact CTA (CONTACT_HREF), never a new/invented action. */}
              <button
                type="button"
                onClick={() => setBLaunched(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', fontFamily: 'inherit',
                  fontWeight: 600, fontSize: 17, padding: '16px 28px', border: 'none', borderRadius: 8, cursor: 'pointer',
                  textTransform: 'uppercase', letterSpacing: '0.02em', color: '#fff', transition: 'background 180ms ease',
                  background: bLaunched ? '#1E7A46' : RED,
                }}
              >
                {bLaunched && <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M5 12l5 5L20 6" /></svg>}
                {bLaunched ? 'Your store is live' : 'Launch store — one click'}
              </button>
              {bLaunched && (
                <a
                  href={CONTACT_HREF}
                  className="nts-ghost"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, fontFamily: 'inherit',
                    fontWeight: 600, fontSize: 15, color: '#fff', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.28)',
                    padding: 13, borderRadius: 8, textDecoration: 'none',
                  }}
                >
                  Finish setup in your coach portal →
                </a>
              )}
              <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 1.5 }}>We send a preview to approve before it goes live to families.*</p>
            </div>

            {/* LIVE PREVIEW — recolors in real time off the selected primary/
                secondary (Garment reads these same --tp/--tp2/--ta vars). */}
            <div
              data-testid="nts-builder-preview"
              style={{
                '--tp': builderPrim.primary, '--tp2': builderPrim.light, '--ta': builderSec.color, '--taInk': builderSec.ink,
              }}
            >
              <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 30px 70px rgba(0,0,0,0.35)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', background: 'var(--tp)', color: '#fff' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--ta)', color: 'var(--tp)', display: 'flex', alignItems: 'center', justifyContent: 'center', ...displayType(16) }}>{bLogo}</span>
                    <span style={displayType(16, { letterSpacing: '0.06em' })}>Your Team Store</span>
                  </span>
                  <span style={displayType(11, { letterSpacing: '0.06em', color: 'var(--ta)' })}>Live preview</span>
                </div>
                <div style={{ padding: 'clamp(18px, 2vw, 26px)', background: '#FAF7F0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: TEXT_MUTED }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1E7A46" strokeWidth="2.2" aria-hidden="true"><path d="M5 12l5 5L20 6" /></svg>
                    <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Your logo applied to all <strong>24 items</strong> automatically</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 14 }}>
                    {builderItems.map((it) => (
                      <div key={it.label} style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,26,56,0.08)' }}>
                        <div style={{ aspectRatio: '1 / 1', background: TILE_BG[it.tone], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Garment kind={it.kind} tone={it.tone} />
                        </div>
                        <div style={{ padding: '9px 11px', ...displayType(12, { letterSpacing: '0.03em', color: 'var(--tp)' }) }}>{it.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ============ EXAMPLE STORE PREVIEW — the centerpiece ============ */}
      <section id="example" style={{ background: OFF_WHITE, borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}`, padding: 'clamp(48px, 6vw, 88px) 24px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 28 }}>
            <div style={{ maxWidth: 560 }}>
              <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 8px' })}>A real example</p>
              <h2 style={displayType('clamp(1.9rem, 3.2vw, 2.4rem)', { color: NAVY, margin: '0 0 10px', letterSpacing: '0.01em' })}>This is what your families see</h2>
              <p style={{ fontSize: 16, color: TEXT_MUTED, lineHeight: 1.6, margin: 0 }}>
                Every store is branded in your team&apos;s colors and logo, hand-picked with your coaching staff. Here&apos;s an Oak Grove Football store, shown as an example.
              </p>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: GREEN, background: '#EAF3EE', border: '1px solid #D4E7DC', padding: '8px 14px', borderRadius: 999 }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: GREEN }} />
              Store open · demo
            </span>
          </div>

          {/* Color selector — "See it in your colors" */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '15px 20px', marginBottom: 16, boxShadow: '0 1px 2px rgba(15,26,56,0.05)' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={displayType(15, { letterSpacing: '0.08em', color: NAVY })}>See it in your colors</span>
              <span style={{ fontSize: 12.5, color: TEXT_MUTED }}>Tap a palette — the whole store restyles instantly.</span>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginLeft: 'auto' }}>
              {THEMES.map((t, i) => {
                const active = i === storeThemeIdx;
                return (
                  <button
                    key={t.name}
                    type="button"
                    aria-label={t.name}
                    aria-pressed={active}
                    onClick={() => setStoreThemeIdx(i)}
                    style={{
                      position: 'relative', width: 34, height: 34, borderRadius: 999, padding: 0, cursor: 'pointer', background: t.primary,
                      boxShadow: 'inset 0 0 0 2px #fff', border: `2px solid ${active ? NAVY : '#E4E8F0'}`, transform: active ? 'scale(1.12)' : 'scale(1)',
                      transition: 'all 160ms ease',
                    }}
                  >
                    <span aria-hidden="true" style={{ position: 'absolute', right: -2, bottom: -2, width: 13, height: 13, borderRadius: 999, background: t.accent, border: '2px solid #fff' }} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Browser-framed demo store */}
          <div style={{ borderRadius: 16, overflow: 'hidden', boxShadow: '0 30px 70px rgba(15,26,56,0.22)', border: '1px solid #E4E8F0', background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', background: '#1c2840', borderBottom: '1px solid rgba(0,0,0,0.2)' }}>
              <div aria-hidden="true" style={{ display: 'flex', gap: 7 }}>
                <span style={{ width: 12, height: 12, borderRadius: 999, background: '#ff5f57' }} />
                <span style={{ width: 12, height: 12, borderRadius: 999, background: '#febc2e' }} />
                <span style={{ width: 12, height: 12, borderRadius: 999, background: '#28c840' }} />
              </div>
              <div style={{ flex: 1, maxWidth: 520, margin: '0 auto', background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.75)', borderRadius: 8, padding: '6px 14px', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                nationalteamshop.com/store/{exampleStore.slug}
              </div>
              <span aria-hidden="true" style={{ width: 40 }} />
            </div>
            <DemoStore theme={storeTheme} teamName={exampleStore.teamName} slug={exampleStore.slug} />
          </div>
          <p style={{ textAlign: 'center', margin: '18px 0 0', fontSize: 12, color: TEXT_FAINT }}>Example store shown in a customer&apos;s team colors. Your store is branded to your program.*</p>
        </div>
      </section>

      {/* ============ FIND YOUR STORE ============
          Real functionality — the mock has no slot for this, so it's its
          own section, styled to match the surrounding sections. */}
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

      {/* ============ HOW IT WORKS ============ */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(48px, 6vw, 88px) 24px' }}>
        <div style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto 52px' }}>
          <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 10px' })}>How a store runs</p>
          <h2 style={displayType('clamp(1.9rem, 3.4vw, 2.5rem)', { color: NAVY, margin: 0, letterSpacing: '0.01em' })}>Open it, share it, cash the check</h2>
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

      {/* ============ FUNDRAISING CALLOUT ============
          Layout/visual treatment kept faithful to the mock; the mock's
          client-side money-math demo ("$1,200 raised" off a made-up average
          order) is replaced with how the mechanism works — no fabricated
          numbers. */}
      <section style={{ background: NAVY_DARK, color: '#fff', padding: 'clamp(48px, 6vw, 88px) 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'clamp(32px, 4vw, 56px)', alignItems: 'center' }}>
          <div>
            <p style={displayType(13, { letterSpacing: '0.16em', color: RED_SOFT, margin: '0 0 12px' })}>Fundraising</p>
            <h2 style={displayType('clamp(2rem, 3.6vw, 2.8rem)', { margin: '0 0 16px', lineHeight: 1.02, letterSpacing: '0.01em' })}>Every order funds the season</h2>
            <p style={{ fontSize: 16, lineHeight: 1.65, color: 'rgba(255,255,255,0.75)', margin: '0 0 26px', maxWidth: 440 }}>
              Set a margin on any item and your program keeps the difference — no car washes, no order forms, no handling cash. Spirit gear families already want quietly pays for equipment, travel, and banquets.
            </p>
            <a
              className="nts-cta-red"
              href={CONTACT_HREF}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: RED, color: '#fff', fontWeight: 600, fontSize: 16, padding: '15px 28px', borderRadius: 8, textTransform: 'uppercase', letterSpacing: '0.02em' }}
            >
              Talk to your rep about a store
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </a>
          </div>
          <div style={{ background: NAVY, border: '1px solid #1c2d4f', borderRadius: 16, padding: 32 }}>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>How the margin works</div>
            <div style={{ ...displayType('clamp(2rem, 4vw, 2.8rem)', { fontWeight: 700, lineHeight: 1 }), marginBottom: 20 }}>
              Set it once<span style={{ ...displayType(18, { fontWeight: 600, color: 'rgba(255,255,255,0.6)' }) }}> per item</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)' }}>Applies to</span>
                <span style={{ fontWeight: 600 }}>Every item, automatically</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)' }}>Families pay</span>
                <span style={{ fontWeight: 600 }}>Directly, at checkout</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)' }}>Effort from you</span>
                <span style={{ fontWeight: 600, color: RED_SOFT }}>Share a link</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ LAUNCH CTA ============ */}
      <section id="launch" style={{ maxWidth: 900, margin: '0 auto', padding: 'clamp(48px, 6vw, 88px) 24px', textAlign: 'center' }}>
        <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 12px' })}>Ready when you are</p>
        <h2 style={displayType('clamp(2rem, 4vw, 3rem)', { color: NAVY, margin: '0 0 14px', lineHeight: 1.02, letterSpacing: '0.01em' })}>Launch your team store</h2>
        <p style={{ fontSize: 'clamp(16px, 1.5vw, 18px)', color: TEXT_MUTED, lineHeight: 1.6, margin: '0 auto 32px', maxWidth: 520 }}>
          Tell us your program and colors — we&apos;ll build a store and send you a preview to approve, usually within a week.*
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            className="nts-cta-red"
            href={CONTACT_HREF}
            style={{ background: RED, color: '#fff', fontWeight: 600, fontSize: 17, padding: '16px 32px', borderRadius: 8, textTransform: 'uppercase', letterSpacing: '0.02em' }}
          >
            Talk to your rep about a store
          </a>
          <button
            type="button"
            onClick={goFind}
            style={{ fontFamily: 'inherit', background: 'transparent', color: NAVY, fontWeight: 600, fontSize: 17, padding: '16px 30px', borderRadius: 8, border: `1px solid ${BORDER_DARK}`, cursor: 'pointer' }}
          >
            Find your store
          </button>
        </div>
      </section>
    </div>
  );
}
