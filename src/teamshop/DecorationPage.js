import React from 'react';
import {
  NAVY, NAVY_DARK, RED, RED_SOFT, OFF_WHITE, BORDER, TEXT, TEXT_MUTED, TEXT_FAINT, displayType,
} from './theme';

// "Decoration" — the approved Claude Design mockup ("Decoration.dc.html")
// translated to React. One page, three method variants switched by the
// `method` prop (embroidery | dtf | heat, default embroidery) — NOT three
// separate routes, matching the design's single-page-with-a-param approach.
//
// Uses the EXISTING TeamShopApp header/footer (not the mockup's own
// NT-tile ones) — this component is content-only, same convention as
// Home.js/AccountPage.js.
//
// This is a pure content page: no pricing, no endpoints, no forms. All copy
// below is verbatim from the approved design (including the asterisked,
// owner-to-confirm claims like "Up to 15 thread colors*") — see
// /decoration-spec.md. Every photo/macro-photo block is a clearly-labeled,
// method-tinted placeholder — no real photography yet, per the same
// convention Home.js already uses for its placeholders.
//
// props:
//   method         — 'embroidery' | 'dtf' | 'heat' (default 'embroidery')
//   onSelectMethod — (method) => void. Called by the "Other methods" cards;
//                    TeamShopApp swaps `decorationMethod` and stays on this
//                    view (no route change), scrolling back to top.
//   onShopMethod   — () => void. The hero CTA ("Shop gear for this method").
//                    Wired to the existing goCatalog — this page never
//                    invents its own catalog/cart logic.

const METHOD_ORDER = ['embroidery', 'dtf', 'heat'];

const METHODS = {
  embroidery: {
    index: '01',
    title: 'Embroidery',
    lede: 'Thread stitched directly into the fabric for a raised, textured mark that reads premium up close and holds up season after season.',
    bestFor: 'Polos · Caps · Jackets',
    durability: 'Highest',
    colorRange: 'Up to 15 thread colors*',
    heroBg: 'linear-gradient(150deg,#EEF1F6,#E1E6F0)',
    heroInk: '#5A6075',
    heroCaption: 'Macro Photo — Embroidery stitching detail',
    processHeading: 'Your art becomes a stitch file, then thread on fabric.',
    steps: [
      { n: '01', title: 'Digitize', body: 'We convert your logo into a stitch file — mapping every path, fill, and thread color.' },
      { n: '02', title: 'Stitch', body: 'Commercial machines lay the thread directly into the garment at high stitch counts.' },
      { n: '03', title: 'Finish', body: 'Backing is trimmed and the piece is pressed and inspected before it ships.' },
    ],
    detailHeading: 'Texture you can feel',
    detailBody: "Embroidery is the most durable decoration we offer. Because the design is thread — not print — it resists fading and wear, making it the go-to for staff polos, coaches' gear, and structured caps.",
    points: ['Dimensional, high-end look', "Won't crack, peel, or fade", 'Ideal on heavier woven fabrics'],
    gallery: {
      caps: ['Macro — Left-chest crest', 'Macro — Thread detail', 'Photo — Embroidered cap'],
      gradients: ['linear-gradient(150deg,#EEF1F6,#E1E6F0)', 'linear-gradient(150deg,#E7EBF2,#DBE1EC)', 'linear-gradient(150deg,#F7F8FB,#E4E8F0)'],
    },
  },
  dtf: {
    index: '02',
    title: 'DTF Print',
    lede: 'Direct-to-film transfers reproduce full-color art — gradients, photos, fine detail — with a soft hand that sits light on performance fabric.',
    bestFor: 'Tees · Performance wear',
    durability: 'High',
    colorRange: 'Unlimited / full color',
    heroBg: 'linear-gradient(150deg,#F0EDEE,#E6DADB)',
    heroInk: '#7A5C60',
    heroCaption: 'Macro Photo — DTF full-color detail',
    processHeading: 'Full-color art, printed to film, pressed to fabric.',
    steps: [
      { n: '01', title: 'Print', body: 'Your artwork is printed onto transfer film in full color, with a white ink base for opacity.' },
      { n: '02', title: 'Cure', body: 'Adhesive powder is applied and cured so the transfer bonds cleanly to the garment.' },
      { n: '03', title: 'Press', body: 'Heat and pressure fuse the design into the fabric for a durable, flexible finish.' },
    ],
    detailHeading: 'Color without limits',
    detailBody: "DTF handles the artwork embroidery can't — photographic detail, tight gradients, and complex multi-color logos — while staying soft and stretchable, so it moves with performance apparel.",
    points: ['Unlimited colors and gradients', 'Soft, flexible hand feel', 'Great on tech and blended fabrics'],
    gallery: {
      caps: ['Macro — Full-color transfer', 'Macro — Gradient edge', 'Photo — DTF on tech tee'],
      gradients: ['linear-gradient(150deg,#F0EDEE,#E6DADB)', 'linear-gradient(150deg,#EDE6E7,#E0D2D4)', 'linear-gradient(150deg,#F7F8FB,#E4E8F0)'],
    },
  },
  heat: {
    index: '03',
    title: 'Heat Applications',
    lede: 'Heat-applied vinyl and transfers give clean, single-color names, numbers, and marks — the fast, precise choice for team uniforms.',
    bestFor: 'Uniforms · Names & numbers',
    durability: 'High',
    colorRange: 'Solid spot colors',
    heroBg: 'linear-gradient(150deg,#E7EBF2,#DBE1EC)',
    heroInk: '#5A6075',
    heroCaption: 'Macro Photo — Heat application detail',
    processHeading: 'Precision-cut material, heat-sealed to the garment.',
    steps: [
      { n: '01', title: 'Cut', body: 'Names, numbers, and marks are precision-cut from premium heat-transfer material.' },
      { n: '02', title: 'Weed & set', body: 'Excess material is weeded away and each element is positioned exactly on the garment.' },
      { n: '03', title: 'Press', body: 'A heat press seals the material into the fabric for a smooth, durable bond.' },
    ],
    detailHeading: 'Sharp, roster-ready lettering',
    detailBody: 'Heat applications are the standard for numbered uniforms — crisp edges, consistent placement, and a clean single-color finish that presses fast so full rosters ship on schedule.',
    points: ['Crisp names and numbers', 'Consistent, repeatable placement', 'Quick turnaround on full rosters'],
    gallery: {
      caps: ['Macro — Pressed number', 'Macro — Cut edge detail', 'Photo — Uniform back'],
      gradients: ['linear-gradient(150deg,#E7EBF2,#DBE1EC)', 'linear-gradient(150deg,#E1E6F0,#D3DBE8)', 'linear-gradient(150deg,#F7F8FB,#E4E8F0)'],
    },
  },
};

function PhotoPlaceholder({ gradient, ink, caption, style }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, background: gradient, color: ink, overflow: 'hidden', ...style }}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.6" /><path d="M21 16l-5-5-9 8" /></svg>
      <span style={{ ...displayType(11, { letterSpacing: '0.14em', color: ink }), textAlign: 'center', padding: '0 12px' }}>{caption}</span>
    </div>
  );
}

function StatCell({ label, value }) {
  return (
    <div style={{ padding: '0 18px', borderLeft: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: TEXT_FAINT, marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 14, color: NAVY }}>{value}</div>
    </div>
  );
}

function StepCard({ step }) {
  return (
    <div style={{ position: 'relative', background: NAVY, border: '1px solid #1c2d4f', borderRadius: 12, padding: '32px 26px' }}>
      <span aria-hidden="true" style={{ position: 'absolute', top: 18, right: 22, ...displayType(40, { color: 'rgba(255,255,255,0.08)' }) }}>{step.n}</span>
      <h3 style={displayType(20, { color: '#fff', margin: '0 0 10px', letterSpacing: '0.01em' })}>{step.title}</h3>
      <p style={{ margin: 0, fontSize: 15, color: 'rgba(255,255,255,0.68)', lineHeight: 1.6 }}>{step.body}</p>
    </div>
  );
}

function CheckPoint({ children }) {
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 15, color: TEXT_MUTED, lineHeight: 1.5 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={RED} strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}><path d="M20 6L9 17l-5-5" /></svg>
      {children}
    </li>
  );
}

function OtherMethodCard({ methodKey, onSelectMethod }) {
  const data = METHODS[methodKey];
  return (
    <button
      type="button"
      className="nts-card"
      onClick={() => onSelectMethod(methodKey)}
      style={{ textAlign: 'left', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
    >
      <PhotoPlaceholder gradient={data.heroBg} ink={data.heroInk} caption={data.heroCaption} style={{ aspectRatio: '16 / 9' }} />
      <div style={{ padding: '22px 24px 26px' }}>
        <h3 style={displayType(21, { color: NAVY, margin: '0 0 8px', letterSpacing: '0.01em' })}>{data.title}</h3>
        <p style={{ margin: '0 0 14px', color: TEXT_MUTED, fontSize: 14, lineHeight: 1.55 }}>{data.bestFor}</p>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 14, color: RED }}>Learn more →</span>
      </div>
    </button>
  );
}

export default function DecorationPage({ method, onSelectMethod, onShopMethod }) {
  const key = METHODS[method] ? method : 'embroidery';
  const data = METHODS[key];
  const otherKeys = METHOD_ORDER.filter((k) => k !== key);

  return (
    <div style={{ width: '100%', overflowX: 'hidden', background: '#fff' }}>

      {/* ============ BREADCRUMB ============ */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '18px 24px 0' }}>
        <p style={{ margin: 0, fontSize: 13, color: TEXT_FAINT }}>
          Home <span aria-hidden="true" style={{ margin: '0 6px' }}>/</span>
          Decoration <span aria-hidden="true" style={{ margin: '0 6px' }}>/</span>
          <span style={{ color: NAVY, fontWeight: 600 }}>{data.title}</span>
        </p>
      </div>

      {/* ============ HERO ============ */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(28px,4vw,48px) 24px clamp(48px,6vw,72px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'clamp(28px,4vw,56px)', alignItems: 'center' }}>
          <div>
            <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 12px' })}>— Decoration method {data.index}</p>
            <h1 style={displayType('clamp(2.6rem, 5.5vw, 4.2rem)', { color: NAVY, margin: '0 0 18px', lineHeight: 0.98, letterSpacing: '0.01em' })}>{data.title}</h1>
            <p style={{ margin: '0 0 28px', color: TEXT_MUTED, fontSize: 'clamp(15px, 1.4vw, 17px)', lineHeight: 1.65, maxWidth: 480 }}>{data.lede}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 30, marginLeft: -18 }}>
              <StatCell label="Best for" value={data.bestFor} />
              <StatCell label="Durability" value={data.durability} />
              <StatCell label="Color range" value={data.colorRange} />
            </div>
            <button
              type="button"
              onClick={onShopMethod}
              className="nts-cta-red"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: RED, color: '#fff', fontWeight: 600, fontSize: 15, padding: '15px 26px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Shop gear for this method
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <PhotoPlaceholder gradient={data.heroBg} ink={data.heroInk} caption={data.heroCaption} style={{ aspectRatio: '4 / 3', borderRadius: 16 }} />
            <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: RED, borderRadius: '0 0 16px 16px' }} />
          </div>
        </div>
      </section>

      {/* ============ HOW IT'S DONE (navy band) ============ */}
      <section style={{ background: NAVY_DARK, padding: 'clamp(56px, 7vw, 96px) 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', maxWidth: 620, margin: '0 auto 48px' }}>
            <p style={displayType(13, { letterSpacing: '0.16em', color: RED_SOFT, margin: '0 0 12px' })}>How it&apos;s done</p>
            <h2 style={displayType('clamp(1.9rem, 3.4vw, 2.4rem)', { color: '#fff', margin: 0, lineHeight: 1.08, letterSpacing: '0.01em' })}>{data.processHeading}</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
            {data.steps.map((step) => <StepCard key={step.n} step={step} />)}
          </div>
        </div>
      </section>

      {/* ============ UP CLOSE ============ */}
      <section style={{ background: '#fff', padding: 'clamp(56px, 7vw, 96px) 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'clamp(28px,4vw,56px)', alignItems: 'center' }}>
          <div>
            <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 10px' })}>Up close</p>
            <h2 style={displayType('clamp(1.9rem, 3.2vw, 2.3rem)', { color: NAVY, margin: '0 0 16px', lineHeight: 1.08 })}>{data.detailHeading}</h2>
            <p style={{ margin: '0 0 22px', color: TEXT_MUTED, fontSize: 15, lineHeight: 1.65 }}>{data.detailBody}</p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data.points.map((p) => <CheckPoint key={p}>{p}</CheckPoint>)}
            </ul>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <PhotoPlaceholder gradient={data.gallery.gradients[0]} ink={data.heroInk} caption={data.gallery.caps[0]} style={{ gridColumn: '1 / -1', aspectRatio: '16 / 10', borderRadius: 14 }} />
            <PhotoPlaceholder gradient={data.gallery.gradients[1]} ink={data.heroInk} caption={data.gallery.caps[1]} style={{ aspectRatio: '1 / 1', borderRadius: 14 }} />
            <PhotoPlaceholder gradient={data.gallery.gradients[2]} ink={data.heroInk} caption={data.gallery.caps[2]} style={{ aspectRatio: '1 / 1', borderRadius: 14 }} />
          </div>
        </div>
      </section>

      {/* ============ OTHER METHODS (off-white band) ============ */}
      <section style={{ background: OFF_WHITE, padding: 'clamp(56px, 7vw, 96px) 24px', borderTop: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', maxWidth: 580, margin: '0 auto 44px' }}>
            <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 10px' })}>Other methods</p>
            <h2 style={displayType('clamp(1.9rem, 3.2vw, 2.15rem)', { color: NAVY, margin: 0, lineHeight: 1.06 })}>Explore the full range</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, maxWidth: 820, margin: '0 auto' }}>
            {otherKeys.map((k) => <OtherMethodCard key={k} methodKey={k} onSelectMethod={onSelectMethod} />)}
          </div>
        </div>
      </section>
    </div>
  );
}
