import React, { useEffect, useRef, useState } from 'react';
import { supabaseCoach } from '../lib/supabaseCoach';
import CatalogCard from './CatalogCard';
import {
  NAVY, NAVY_DARK, RED, RED_SOFT, OFF_WHITE, BORDER, BORDER_DARK,
  TEXT, TEXT_MUTED, TEXT_FAINT, displayType,
} from './theme';
import { LAUNCH_CATEGORIES } from './categories';
import { fetchCategoryHeroes, pickHeroForCategory } from './categoryHeroes';

// Team Shop landing page — the approved "National Team Shop - Home" Claude
// Design mockup, translated section-by-section. Replaces the Stage-1 hero
// placeholder that used to live inline in TeamShopApp (see the
// TODO(teamshop-landing) this component resolves).
//
// Header/footer are NOT reproduced here — TeamShopApp already renders the
// shared header/footer (styled from the sibling "Shop - Polos" mockup) around
// every view, landing included. This component is content-only.
//
// Wiring:
//   onStartOrder     — 'Start with your logo' / hero + how-it-works CTAs.
//                       Same handler the old placeholder's "Start an order"
//                       button used (TeamShopApp's setRoute('order')).
//   onBrowseCatalog  — 'Shop'/browse CTAs (New Drops panel, category tiles,
//                       "Shop all products"). TeamShopApp's setRoute('catalog').
//                       Accepts an optional launch-category key (see
//                       categories.js); category tiles pass their key so the
//                       catalog opens pre-filtered, every other CTA (New
//                       Drops, "Shop all products", featured products' "Shop
//                       all products →") passes nothing and opens on 'All'.
//   onOpenStores     — hero slide 2's "Explore team stores" CTA. TeamShopApp
//                       passes its goTeamStores handler (setRoute('stores')) —
//                       the same navigation the header/footer "Team Stores"
//                       links already use. Optional: falls back to a plain
//                       href to /team-stores (the real, already-shipped
//                       directory — see the team-stores links note below) if
//                       no handler is supplied, so the slide still works if a
//                       caller doesn't wire it.
//
// Hero: a 3-slide auto-rotating slider (pure React state + CSS, no carousel
// lib). Slide 1 (shown first) is a designed navy graphic banner carrying the
// original hero content/CTAs; slide 2 is a designed Team Stores pitch; slide
// 3 is the original sideline video treatment. See the HERO SLIDER block
// below for the mechanics (auto-advance, hover/focus pause, reduced-motion,
// dots).
//
// Team-stores CTAs (header/footer nav, hero slide 2, hero slide 1's "or shop
// team stores" link, and the big category panel) all call onOpenStores —
// TeamShopApp's goTeamStores, landing in-SPA on route 'stores'
// (TeamStoresPage) with real client-side history (see useTeamShopRoute.js).
// Two of these used to be raw `<a href="/team-stores">` anchors pointing at
// the SEPARATE public directory (src/storefront/TeamStores.js, `isTeamStores`
// in src/index.js) — a full page reload to a different chunk. Routing pass:
// unified onto the same in-SPA destination as every other "Team Stores" CTA
// on this page, so Back/forward and the address bar behave consistently
// instead of one tile silently leaving the SPA.
//
// Photography: every photo/macro-photo block in the mockup is a labeled
// placeholder (no real photography yet) and stays that way here, clearly
// labeled, per the design brief — owner supplies real photography at launch.
//
// Featured products: a small real fetch (search_products RPC, same call
// shape as Catalog.js) rendered with the existing CatalogCard, reused
// anonymously (no onSelect/onAddBlank) — identical to how the anonymous
// /teamshop "Shop" tab already renders cards, so a card here behaves exactly
// like a card there. No client-side pricing is introduced; CatalogCard's
// existing "from —" placeholder stands in for the mockup's illustrative
// "from $28*" figures.
const FEATURED_LIMIT = 8;

// The 9 real launch categories (categories.js), each paired with a tile
// gradient (cycled from the mockup's original palette — visual treatment
// only, no meaning attached to which gradient lands on which category).
const TILE_GRADIENTS = [
  'linear-gradient(150deg,#1c2d4f,#192853)',
  'linear-gradient(150deg,#243a66,#192853)',
  'linear-gradient(150deg,#1c2d4f,#0F1A38)',
  'linear-gradient(150deg,#243a66,#1c2d4f)',
  'linear-gradient(150deg,#1c2d4f,#192853)',
  'linear-gradient(150deg,#243a66,#192853)',
  'linear-gradient(150deg,#1c2d4f,#0F1A38)',
  'linear-gradient(150deg,#243a66,#1c2d4f)',
];

// Category-tile product imagery (public/teamshop/cat-<key>.jpg) — on-brand
// National team gear, one per launch category, each carrying a left-chest
// team crest in a red/white/grey colorway mix. Static assets committed to the
// repo, so the grid shows consistent branded photography rather than a mix of
// per-SKU catalog shots. These take precedence over the DB hero photos; if a
// file ever fails to load, the tile's <img> onError hides it and the tile
// falls back to its gradient (same graceful degradation the DB-hero path
// already had).
const CATEGORY_TILE_IMG = {
  quarter_zips: '/teamshop/cat-quarter_zips.jpg',
  hoodies: '/teamshop/cat-hoodies.jpg',
  polos: '/teamshop/cat-polos.jpg',
  outerwear: '/teamshop/cat-outerwear.jpg',
  hats: '/teamshop/cat-hats.jpg',
  tees: '/teamshop/cat-tees.jpg',
  bags: '/teamshop/cat-bags.jpg',
  shorts: '/teamshop/cat-shorts.jpg',
  footwear: '/teamshop/cat-footwear.jpg',
};

const VALUE_PROPS = [
  { label: 'Free Decoration Setup*', icon: <path d="M12 2v6M12 12v8M9 20h6" /> },
  { label: 'Fast Turnaround*', icon: <><rect x="1" y="6" width="14" height="10" rx="1" /><path d="M15 9h4l3 3v4h-7z" /><circle cx="6" cy="18" r="1.8" /><circle cx="18" cy="18" r="1.8" /></> },
  { label: 'We Meet Expectations', icon: <><path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7z" /><path d="M9 12l2 2 4-4" /></> },
  { label: 'Your Logos, Saved', icon: <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /> },
  { label: 'Low Minimums*', icon: <><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 12.2V5a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8z" /><circle cx="8" cy="8" r="1.4" /></> },
];

const HOW_IT_WORKS = [
  {
    n: '01',
    title: 'Pick your gear',
    body: 'Browse polos, hoodies, caps, and uniforms from the brands you already trust.',
    icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v5" /></>,
  },
  {
    n: '02',
    title: 'Place your logo',
    body: 'Drop on a saved logo or upload a new one. Preview it on the garment instantly.',
    icon: <><path d="M12 3v12m0 0l-4-4m4 4l4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>,
  },
  {
    n: '03',
    title: 'We decorate & ship',
    body: 'Decorated in-house and shipped in days — with your art saved for the reorder.',
    icon: <><rect x="1" y="7" width="15" height="10" rx="1" /><path d="M16 10h4l3 3v4h-7z" /><circle cx="6" cy="19" r="1.8" /><circle cx="18" cy="19" r="1.8" /></>,
  },
];

const DECORATION_METHODS = [
  { n: '01', method: 'embroidery', title: 'Embroidery', body: "Best for polos, caps, and jackets — a durable, textured finish that reads premium up close.", image: '/teamshop/deco-embroidery-macro.jpg', imageAlt: 'Macro of red and white embroidery stitching on navy fabric', gradient: 'linear-gradient(150deg,#EEF1F6,#E1E6F0)' },
  { n: '02', method: 'dtf', title: 'DTF Print', body: 'Ideal for full-color logos and gradients on tees and performance wear, with soft-hand detail.', image: '/teamshop/deco-dtf-macro.jpg', imageAlt: 'Macro of a full-color DTF printed graphic on heather fabric', gradient: 'linear-gradient(150deg,#F0EDEE,#E6DADB)' },
  { n: '03', method: 'heat', title: 'Heat Applications', body: 'The fast, clean choice for names, numbers, and single-color marks on team uniforms.', image: '/teamshop/deco-heat-macro.jpg', imageAlt: 'Macro of a heat-applied white number on a navy jersey', gradient: 'linear-gradient(150deg,#E7EBF2,#DBE1EC)' },
];

const BRAND_STRIP = ['adidas', 'Augusta · Holloway', 'Richardson', 'Nike', 'Under Armour'];

const SOCIAL_LOGOS = ['Team Logo', 'School Logo', 'Team Logo', 'School Logo', 'Team Logo'];

function PhotoLabel({ children, style }) {
  return (
    <span style={{ ...displayType(11, { letterSpacing: '0.14em', color: TEXT_FAINT }), ...style }}>{children}</span>
  );
}

// Hero slider — 3 fixed slides, auto-advancing every ~6s. A plain interval
// ticks continuously; `pausedRef`/`reducedMotionRef` gate whether a tick
// actually advances, so hover/focus-pause and prefers-reduced-motion don't
// need to tear down and restart the timer (avoids drift/flicker on rapid
// hover-in/out). Dots (and clicks) always work, even when auto-advance is
// paused or disabled.
const HERO_SLIDE_COUNT = 3;
const HERO_AUTO_MS = 6000;

export default function Home({
  onStartOrder, onBrowseCatalog, onOpenDecoration, onOpenStores,
}) {
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  // Category-tile hero photos (categoryHeroes.js) — a small anon fetch of the
  // 9 owner-picked SKUs, one per launch category. Never blocks the grid:
  // starts empty (gradient tiles), and pickHeroForCategory falls back to the
  // gradient tile per-category if a row/image is missing.
  const [categoryHeroes, setCategoryHeroes] = useState([]);
  // Welcome popup / chat bubble, per the mockup's <script type="text/x-dc">
  // DCLogic component: opens once, 1.6s after mount, unless already
  // dismissed; the chat bubble toggles it. Pure local UI state, no backend —
  // there is no live chat behind it yet.
  const [popupOpen, setPopupOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dismissedRef = useRef(false);
  useEffect(() => { dismissedRef.current = dismissed; }, [dismissed]);

  useEffect(() => {
    let alive = true;
    setProductsLoading(true);
    (async () => {
      const { data, error } = await supabaseCoach.rpc('search_products', {
        p_query: null,
        p_category: null,
        p_vendor_id: null,
        p_color_category: null,
        p_in_stock: false,
        p_limit: FEATURED_LIMIT,
        p_offset: 0,
      });
      if (!alive) return;
      setProducts(error ? [] : (data || []));
      setProductsLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await fetchCategoryHeroes();
      if (alive) setCategoryHeroes(rows);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    // Intentionally mount-only (matches the mockup's componentDidMount
    // timer) — `dismissed` is read via a ref-like closure check inside the
    // callback, not re-subscribed on every change.
    const t = setTimeout(() => { setPopupOpen((open) => (dismissedRef.current ? open : true)); }, 1600);
    return () => clearTimeout(t);
  }, []);

  const dismissPopup = () => { setPopupOpen(false); setDismissed(true); };
  const toggleChat = () => { setPopupOpen((v) => !v); setDismissed(true); };

  // ---- Hero slider state -------------------------------------------------
  const [heroSlide, setHeroSlide] = useState(0);
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
      setHeroSlide((s) => (s + 1) % HERO_SLIDE_COUNT);
    }, HERO_AUTO_MS);
    return () => clearInterval(id);
  }, []);

  const pauseHero = () => { heroPausedRef.current = true; };
  const resumeHero = () => { heroPausedRef.current = false; };

  return (
    <div style={{ width: '100%', overflowX: 'hidden', background: '#fff', position: 'relative' }}>

      {/* ============ HERO SLIDER ============ */}
      {/* 3 fixed slides, cross-fading via opacity/pointer-events (no layout
          shift — every slide is absolutely stacked inside the same
          minHeight-clamped section, so the clamp keeps doing its old job of
          holding hero height steady). Only the active slide's interactive
          elements are tabbable (tabIndex -1 on the rest) so keyboard users
          don't tab through off-screen CTAs. Auto-advance pauses on
          hover/focus (onMouseEnter/Leave + onFocus/Blur on the section —
          React's onFocus/onBlur behave like focusin/focusout, i.e.
          focus-within) and is skipped entirely under prefers-reduced-motion;
          dots remain clickable either way. */}
      <section
        className="nts-hero"
        style={{ position: 'relative', minHeight: 'clamp(460px, 54vw, 700px)', overflow: 'hidden', background: NAVY_DARK }}
        onMouseEnter={pauseHero}
        onMouseLeave={resumeHero}
        onFocus={pauseHero}
        onBlur={resumeHero}
      >
        {/* ---- Slide 1: designed graphic banner (no photo/video) ---- */}
        <div
          aria-hidden={heroSlide !== 0}
          style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: heroSlide === 0 ? 1 : 0, pointerEvents: heroSlide === 0 ? 'auto' : 'none', transition: 'opacity 700ms ease' }}
        >
          <span aria-hidden="true" style={{ position: 'absolute', inset: 0, background: `linear-gradient(115deg, ${NAVY_DARK} 0%, ${NAVY} 55%, #1c2d4f 100%)` }} />
          {/* Angled brand-color planes — subtle geometric accents, kept out
              of the right two-thirds where the headline/CTAs sit. */}
          <span aria-hidden="true" style={{ position: 'absolute', left: '-12%', top: '-20%', width: '52%', height: '150%', background: 'linear-gradient(135deg, rgba(28,45,79,0.65), rgba(28,45,79,0))', transform: 'skewX(-14deg)' }} />
          <span aria-hidden="true" style={{ position: 'absolute', left: '14%', bottom: '-25%', width: '26%', height: '75%', background: 'linear-gradient(135deg, rgba(150,44,50,0.20), rgba(150,44,50,0))', transform: 'skewX(-14deg)' }} />
          {/* Faint oversized wordmark watermark, anchored left so it stays
              clear of the right-aligned headline. */}
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
            <span style={{ ...displayType('clamp(6rem, 19vw, 15rem)', { fontWeight: 700, color: 'rgba(255,255,255,0.045)', letterSpacing: '0.02em', whiteSpace: 'nowrap' }), marginLeft: '-4%' }}>NATIONAL TEAM SHOP</span>
          </div>
          <span style={{ position: 'absolute', top: 22, left: 26, marginTop: 26, ...displayType(13, { letterSpacing: '0.18em', color: RED_SOFT }), display: 'inline-flex', alignItems: 'center', gap: 10, pointerEvents: 'none' }}>
            <span aria-hidden="true" style={{ width: 30, height: 2, background: RED_SOFT, display: 'inline-block' }} />National Team Shop
          </span>
          <div style={{ position: 'relative', width: '100%', marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', padding: '0 clamp(16px, 2.5vw, 36px) clamp(30px, 4vw, 56px)' }}>
            <p style={{ margin: '0 0 10px', textAlign: 'right', color: 'rgba(255,255,255,0.82)', fontSize: 'clamp(15px, 1.5vw, 19px)', fontWeight: 500 }}>Your logo. Team-quality gear.</p>
            <h1 style={{ ...displayType('clamp(3.2rem, 9vw, 7rem)', { fontWeight: 700, lineHeight: 0.9, letterSpacing: '0.01em', color: '#fff' }), margin: '0 0 26px', textAlign: 'right' }}>Days, not weeks.</h1>
            <div style={{ width: 'min(660px, 100%)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                type="button"
                onClick={onStartOrder}
                tabIndex={heroSlide === 0 ? 0 : -1}
                className="nts-cta-red"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: RED, color: '#fff', fontWeight: 600, fontSize: 'clamp(16px, 1.6vw, 19px)', letterSpacing: '0.02em', padding: '18px 32px', borderRadius: 6, textTransform: 'uppercase', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Start with your logo
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
              <button
                type="button"
                onClick={onOpenStores}
                tabIndex={heroSlide === 0 ? 0 : -1}
                className="nts-footlink"
                style={{ alignSelf: 'flex-end', display: 'inline-flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.85)', fontWeight: 600, fontSize: 15, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                or shop team stores
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </div>
          </div>
        </div>

        {/* ---- Slide 2: Team Stores (designed, no photo) ---- */}
        <div
          aria-hidden={heroSlide !== 1}
          style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: heroSlide === 1 ? 1 : 0, pointerEvents: heroSlide === 1 ? 'auto' : 'none', transition: 'opacity 700ms ease' }}
        >
          <span aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(150deg,#1c2d4f,#192853 55%,#0F1A38)' }} />
          <span aria-hidden="true" style={{ position: 'absolute', right: '-10%', top: '-15%', width: '48%', height: '135%', background: 'linear-gradient(135deg, rgba(150,44,50,0.18), rgba(150,44,50,0))', transform: 'skewX(12deg)' }} />
          <span style={{ position: 'absolute', top: 22, left: 26, marginTop: 26, ...displayType(13, { letterSpacing: '0.18em', color: RED_SOFT }), display: 'inline-flex', alignItems: 'center', gap: 10, pointerEvents: 'none' }}>
            <span aria-hidden="true" style={{ width: 30, height: 2, background: RED_SOFT, display: 'inline-block' }} />Team Stores
          </span>
          <div style={{ position: 'relative', width: '100%', marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '0 clamp(16px, 2.5vw, 36px) clamp(30px, 4vw, 56px)' }}>
            <h1 style={{ ...displayType('clamp(2.6rem, 6vw, 4.6rem)', { fontWeight: 700, lineHeight: 0.96, letterSpacing: '0.01em', color: '#fff' }), margin: '0 0 14px' }}>Launch a team store</h1>
            <p style={{ margin: '0 0 24px', maxWidth: 560, color: 'rgba(255,255,255,0.82)', fontSize: 'clamp(15px, 1.5vw, 18px)', fontWeight: 500, lineHeight: 1.5 }}>
              A private branded storefront for your program — players and parents order their own gear, with optional fundraising back to the team. No upfront cost.
            </p>
            <button
              type="button"
              onClick={onOpenStores ? onOpenStores : undefined}
              tabIndex={heroSlide === 1 ? 0 : -1}
              className="nts-cta-red"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: RED, color: '#fff', fontWeight: 600, fontSize: 'clamp(16px, 1.6vw, 19px)', letterSpacing: '0.02em', padding: '18px 32px', borderRadius: 6, textTransform: 'uppercase', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Explore team stores
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
        </div>

        {/* ---- Slide 3: sideline video ---- */}
        {/* Generated hero loop (owner-approved) over the sideline photo,
            under a navy gradient so the headline stays legible. The photo
            stays mounted underneath and doubles as the poster — if the video
            can't load or autoplay (data saver, old browsers), the slide
            looks the same as the original hero did. muted + playsInline are
            both required for mobile autoplay. The video keeps playing across
            rotations even while off-screen — simplest and avoids restart
            flicker each time this slide comes back around. */}
        <div
          aria-hidden={heroSlide !== 2}
          style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: heroSlide === 2 ? 1 : 0, pointerEvents: heroSlide === 2 ? 'auto' : 'none', transition: 'opacity 700ms ease' }}
        >
          <img src="/teamshop/hero-sideline.jpg" alt="" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%' }} />
          <video
            src="/teamshop/hero-sideline-loop.mp4"
            poster="/teamshop/hero-sideline.jpg"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <span aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(15,26,56,0.88) 0%, rgba(25,40,83,0.55) 48%, rgba(15,26,56,0.35) 100%)' }} />
          <span style={{ position: 'absolute', top: 22, left: 26, marginTop: 26, ...displayType(13, { letterSpacing: '0.18em', color: RED_SOFT }), display: 'inline-flex', alignItems: 'center', gap: 10, pointerEvents: 'none' }}>
            <span aria-hidden="true" style={{ width: 30, height: 2, background: RED_SOFT, display: 'inline-block' }} />National Team Shop
          </span>
          <div style={{ position: 'relative', width: '100%', marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', padding: '0 clamp(16px, 2.5vw, 36px) clamp(30px, 4vw, 56px)' }}>
            <p style={{ margin: '0 0 10px', textAlign: 'right', color: 'rgba(255,255,255,0.82)', fontSize: 'clamp(15px, 1.5vw, 19px)', fontWeight: 500 }}>Your logo. Team-quality gear.</p>
            <h1 style={{ ...displayType('clamp(2.8rem, 7vw, 5.6rem)', { fontWeight: 700, lineHeight: 0.92, letterSpacing: '0.01em', color: '#fff' }), margin: 0, textAlign: 'right' }}>Built for the sideline.</h1>
          </div>
        </div>

        {/* ---- Pagination dots ---- */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'clamp(10px, 1.6vw, 18px)', display: 'flex', justifyContent: 'center', gap: 10, zIndex: 5 }}>
          {Array.from({ length: HERO_SLIDE_COUNT }).map((_, i) => (
            <button
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              type="button"
              onClick={() => setHeroSlide(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={heroSlide === i}
              style={{ width: 10, height: 10, padding: 0, borderRadius: 999, border: 'none', cursor: 'pointer', background: heroSlide === i ? RED : 'rgba(255,255,255,0.45)' }}
            />
          ))}
        </div>
      </section>

      {/* ============ BRAND STRIP ============ */}
      <section style={{ background: '#fff', padding: 'clamp(26px, 3.2vw, 42px) 24px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Prev/next controls are visual-only in the mockup itself (no
              behavior wired there either) — a static brand strip, not a
              functioning carousel. TODO(teamshop-nav): wire real
              pagination if/when the brand list grows past one row. */}
          <button type="button" aria-label="Previous brands" disabled className="nts-ghost" style={{ flex: 'none', width: 44, height: 44, borderRadius: 8, border: 'none', background: NAVY, color: '#fff', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-around', gap: 'clamp(18px, 3.5vw, 44px)' }}>
            {BRAND_STRIP.map((b) => (
              <span key={b} style={{ ...displayType('clamp(19px, 2.2vw, 26px)', { letterSpacing: '0.04em', color: NAVY }), opacity: 0.55 }}>{b}</span>
            ))}
          </div>
          <button type="button" aria-label="Next brands" disabled className="nts-ghost" style={{ flex: 'none', width: 44, height: 44, borderRadius: 8, border: 'none', background: NAVY, color: '#fff', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>
      </section>

      {/* ============ BIG CATEGORY PANELS ============ */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 0 }}>
        <button
          type="button"
          onClick={onOpenStores}
          style={{ position: 'relative', minHeight: 'clamp(360px, 32vw, 460px)', display: 'flex', alignItems: 'flex-end', padding: 'clamp(28px, 3vw, 44px)', background: 'linear-gradient(160deg,#1c2d4f,#192853 60%,#0F1A38)', overflow: 'hidden', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%' }}
        >
          <img src="/teamshop/panel-teamstores.jpg" alt="" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
          <span aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(15,26,56,0.15) 30%, rgba(15,26,56,0.82) 100%)' }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ ...displayType('clamp(2.6rem, 4.2vw, 3.6rem)', { fontWeight: 700, lineHeight: 0.96, color: '#fff' }), marginBottom: 14, letterSpacing: '0.01em' }}>Team Stores</div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 16, color: '#fff' }}>
              Shop now <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
          </div>
        </button>
        <button type="button" onClick={() => onBrowseCatalog()} style={{ position: 'relative', minHeight: 'clamp(360px, 32vw, 460px)', display: 'flex', alignItems: 'flex-end', padding: 'clamp(28px, 3vw, 44px)', background: 'linear-gradient(160deg,#F7F8FB,#EEF1F6 60%,#E4E8F0)', overflow: 'hidden', textAlign: 'left', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          <img src="/teamshop/panel-newdrops.jpg" alt="" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
          <span aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(247,248,251,0.05) 35%, rgba(247,248,251,0.88) 100%)' }} />
          <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: RED, zIndex: 1 }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ ...displayType('clamp(2.6rem, 4.2vw, 3.6rem)', { fontWeight: 700, lineHeight: 0.96, color: NAVY }), marginBottom: 14, letterSpacing: '0.01em' }}>New Drops</div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 16, color: NAVY }}>
              Shop now <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
          </div>
        </button>
      </section>

      {/* ============ CATEGORY TILES ============ */}
      <section style={{ background: '#fff', padding: 'clamp(48px, 6vw, 80px) 24px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 28 }}>
            <div>
              <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 6px' })}>Shop by category</p>
              <h2 style={displayType('clamp(1.9rem, 3.2vw, 2.2rem)', { color: NAVY, margin: 0, letterSpacing: '0.01em' })}>Everything the roster needs</h2>
            </div>
          </div>
          <div className="nts-category-grid">
            {LAUNCH_CATEGORIES.filter((cat) => cat.key !== 'footwear').map((cat, i) => {
              const tileImg = CATEGORY_TILE_IMG[cat.key];
              const hero = pickHeroForCategory(categoryHeroes, cat);
              const gradient = TILE_GRADIENTS[i % TILE_GRADIENTS.length];
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => onBrowseCatalog(cat.key)}
                  aria-label={`Shop ${cat.label}`}
                  className="nts-category-tile"
                  style={{
                    position: 'relative', aspectRatio: '1 / 1', borderRadius: 12, overflow: 'hidden',
                    display: 'flex', flexDirection: 'column', padding: 0, background: (tileImg || hero) ? 'linear-gradient(150deg,#F7F8FB,#E4E8F0)' : gradient,
                    border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  }}
                >
                  {tileImg ? (
                    <>
                      <img
                        src={tileImg}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: NAVY, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={displayType(16, { letterSpacing: '0.04em', color: '#fff' })}>{cat.label}</span>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                      </span>
                    </>
                  ) : hero ? (
                    <>
                      <span style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px 18px 6px', minHeight: 0 }}>
                        <img
                          src={hero.image_front_url}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'contain', mixBlendMode: 'multiply' }}
                        />
                      </span>
                      <span style={{ position: 'relative', flex: 'none', background: NAVY, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={displayType(16, { letterSpacing: '0.04em', color: '#fff' })}>{cat.label}</span>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                      </span>
                    </>
                  ) : (
                    <span style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'flex-end', padding: 18 }}>
                      <span aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(15,26,56,0.55), transparent 55%)' }} />
                      <span style={{ position: 'relative', ...displayType(19, { letterSpacing: '0.04em', color: '#fff' }) }}>{cat.label}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============ VALUE-PROP ICON ROW ============ */}
      <section style={{ background: OFF_WHITE, padding: 'clamp(40px, 5vw, 64px) 24px', borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 32 }}>
          {VALUE_PROPS.map((vp) => (
            <div key={vp.label} style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="1.5" aria-hidden="true">{vp.icon}</svg>
              <span style={{ ...displayType(15, { letterSpacing: '0.06em', color: NAVY }), lineHeight: 1.2 }}>{vp.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section style={{ background: NAVY_DARK, padding: 'clamp(56px, 7vw, 96px) 24px', position: 'relative' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', maxWidth: 620, margin: '0 auto 56px' }}>
            <p style={displayType(13, { letterSpacing: '0.16em', color: RED_SOFT, margin: '0 0 12px' })}>How it works</p>
            <h2 style={displayType('clamp(2rem, 3.6vw, 2.5rem)', { color: '#fff', margin: '0 0 14px', lineHeight: 1.06, letterSpacing: '0.01em' })}>Three steps. No back-and-forth.</h2>
            <p style={{ color: 'rgba(255,255,255,0.7)', margin: 0, fontSize: 'clamp(15px, 1.3vw, 17px)', lineHeight: 1.6 }}>
              Pick your gear, drop on your logo, and we handle the rest. Your account remembers everything for next season.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
            {HOW_IT_WORKS.map((step) => (
              <div key={step.n} style={{ background: NAVY, border: '1px solid #1c2d4f', borderRadius: 12, padding: '36px 32px', position: 'relative' }}>
                <span aria-hidden="true" style={{ position: 'absolute', top: 24, right: 28, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 44, color: 'rgba(255,255,255,0.08)', lineHeight: 1 }}>{step.n}</span>
                <div style={{ width: 46, height: 46, borderRadius: 10, background: 'rgba(217,74,82,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: RED_SOFT, marginBottom: 22 }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{step.icon}</svg>
                </div>
                <h3 style={displayType(22, { color: '#fff', margin: '0 0 10px', letterSpacing: '0.02em' })}>{step.title}</h3>
                <p style={{ margin: 0, fontSize: 15, color: 'rgba(255,255,255,0.68)', lineHeight: 1.6 }}>{step.body}</p>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 44 }}>
            <button
              type="button"
              onClick={onStartOrder}
              style={{ display: 'inline-block', fontWeight: 600, fontSize: 16, padding: '15px 30px', borderRadius: 8, background: '#fff', color: NAVY, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Start with your logo
            </button>
          </div>
        </div>
      </section>

      {/* ============ DECORATION STYLES ============ */}
      <section id="decoration" style={{ background: '#fff', padding: 'clamp(56px, 7vw, 96px) 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', maxWidth: 580, margin: '0 auto 44px' }}>
            <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 10px' })}>How we decorate</p>
            <h2 style={displayType('clamp(1.9rem, 3.2vw, 2.15rem)', { color: NAVY, margin: '0 0 12px', lineHeight: 1.06 })}>The right method for the garment</h2>
            <p style={{ color: TEXT_MUTED, margin: 0, lineHeight: 1.6, fontSize: 'clamp(15px, 1.3vw, 17px)' }}>Every job is matched to the fabric and the design. Here&apos;s when each one is the right call.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            {DECORATION_METHODS.map((m) => (
              <button
                key={m.n}
                type="button"
                className="nts-card"
                onClick={() => onOpenDecoration && onOpenDecoration(m.method)}
                style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,26,56,0.06)', textAlign: 'left', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <div style={{ aspectRatio: '4 / 3', background: m.gradient, overflow: 'hidden' }}>
                  <img src={m.image} alt={m.imageAlt} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
                <div style={{ padding: '22px 24px 26px' }}>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', color: RED, marginBottom: 6 }}>{m.n}</div>
                  <h3 style={displayType(22, { color: NAVY, margin: '0 0 8px', letterSpacing: '0.01em' })}>{m.title}</h3>
                  <p style={{ margin: '0 0 14px', color: TEXT_MUTED, fontSize: 15, lineHeight: 1.55 }}>{m.body}</p>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 600, fontSize: 14, color: RED }}>
                    Learn more
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FEATURED PRODUCTS ============ */}
      <section id="products" style={{ background: OFF_WHITE, padding: 'clamp(56px, 7vw, 96px) 24px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 36 }}>
            <div>
              <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 6px' })}>Featured &amp; on deal</p>
              <h2 style={displayType('clamp(1.9rem, 3.2vw, 2.15rem)', { color: NAVY, margin: 0, letterSpacing: '0.01em' })}>Ready to decorate</h2>
            </div>
            <button
              type="button"
              onClick={() => onBrowseCatalog()}
              className="nts-navlink"
              style={{ fontWeight: 600, fontSize: 15, color: NAVY, borderBottom: `1.5px solid ${BORDER_DARK}`, paddingBottom: 3, background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Shop all products →
            </button>
          </div>

          {productsLoading && <p style={{ color: TEXT_MUTED, fontSize: 14 }}>Loading…</p>}
          {!productsLoading && !products.length && (
            // TODO(featured-products): search_products returned nothing (or the
            // RPC failed) — falls back to an empty state rather than fake tiles,
            // so we never show garments that don't exist.
            <p style={{ color: TEXT_MUTED, fontSize: 14 }}>Featured products are on their way.</p>
          )}
          {!productsLoading && !!products.length && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 24 }}>
              {products.map((p) => (
                // CatalogCard now takes a colorways.js style-group (see
                // Catalog.js) rather than a single product row. This featured
                // strip has no grouping of its own (no colorway UI needed
                // here) — wrap each row as its own single-variant group so
                // the card renders exactly as it did before that change.
                <CatalogCard key={p.id} group={{ key: p.id, brand: p.brand, name: p.name, variants: [p] }} />
              ))}
            </div>
          )}
          <p style={{ textAlign: 'center', margin: '28px 0 0', fontSize: 12, color: TEXT_MUTED, letterSpacing: '0.02em' }}>* Placeholder pricing — final pricing set at build time.</p>
        </div>
      </section>

      {/* ============ SOCIAL PROOF ============ */}
      <section style={{ background: OFF_WHITE, padding: 'clamp(56px, 7vw, 96px) 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
          <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 10px' })}>Trusted on the sideline</p>
          <h2 style={displayType('clamp(1.9rem, 3.2vw, 2.15rem)', { color: NAVY, margin: '0 0 40px', letterSpacing: '0.01em' })}>Trusted by programs across California</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 16 }}>
            {SOCIAL_LOGOS.map((label, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={`${label}-${i}`} style={{ aspectRatio: '16 / 9', border: `1px solid ${BORDER}`, borderRadius: 12, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6, color: BORDER_DARK }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7z" /></svg>
                <PhotoLabel style={{ fontSize: 10, letterSpacing: '0.12em' }}>{label}</PhotoLabel>
              </div>
            ))}
          </div>
          <p style={{ margin: '36px auto 0', fontSize: 'clamp(16px, 1.5vw, 19px)', color: TEXT_MUTED, maxWidth: 560, lineHeight: 1.6, fontStyle: 'italic' }}>
            &quot;Uploaded our crest once and now every reorder takes about two minutes. The gear looks the part.&quot;*
          </p>
          <p style={{ margin: '14px 0 0', ...displayType(13, { letterSpacing: '0.1em', color: NAVY }) }}>— Placeholder coach quote</p>
        </div>
      </section>

      {/* ============ WELCOME POPUP ============ */}
      {popupOpen && (
        <div style={{ position: 'fixed', right: 24, bottom: 96, zIndex: 70, width: 'min(348px, calc(100vw - 32px))', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: '0 24px 60px rgba(15,26,56,0.28)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 18px', borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 999, background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15 }}>AR</span>
              <div style={{ lineHeight: 1.1 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: NAVY }}>Alex, National Team Shop</div>
                <div style={{ fontSize: 12, color: TEXT_MUTED }}>Typically replies in minutes</div>
              </div>
            </div>
            <button type="button" onClick={dismissPopup} aria-label="Close" style={{ flex: 'none', width: 30, height: 30, borderRadius: 999, border: 'none', background: 'transparent', color: TEXT_MUTED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div style={{ padding: 18 }}>
            <p style={{ margin: '0 0 14px', fontSize: 15, color: TEXT, lineHeight: 1.5 }}>Welcome! New here? Drop your logo and we&apos;ll build your team store.</p>
            <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: 'linear-gradient(150deg,#1c2d4f,#192853 60%,#0F1A38)', padding: 20, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: RED_SOFT }} />
              <span style={{ ...displayType(15, { letterSpacing: '0.08em', color: '#fff' }), fontWeight: 700 }}>National Team Shop</span>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>+ Top brands</span>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>+ Your logos, saved</span>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>+ Free decoration setup*</span>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>+ Fast turnaround*</span>
            </div>
            <p style={{ margin: '14px 0 16px', fontSize: 13, color: TEXT_MUTED, lineHeight: 1.55 }}>Elevate your program&apos;s look — pair your logo with top-tier brands and let our in-house team handle the rest.</p>
            <button
              type="button"
              onClick={() => { dismissPopup(); onStartOrder(); }}
              className="nts-cta-red"
              style={{ display: 'block', width: '100%', textAlign: 'center', fontWeight: 600, fontSize: 15, background: RED, color: '#fff', padding: 13, borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Start with your logo
            </button>
            {/* TODO(teamshop-nav): no live chat backend yet — this input is a
                visual affordance from the mockup only. */}
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${BORDER}`, borderRadius: 999, padding: '11px 16px', color: TEXT_MUTED, fontSize: 14, background: OFF_WHITE }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 5h16v12H7l-3 3z" /></svg>
              Click to reply…
            </div>
          </div>
        </div>
      )}

      {/* ============ CHAT BUBBLE ============ */}
      <button
        type="button"
        onClick={toggleChat}
        aria-label="Open chat"
        className="nts-cta-navy"
        style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 71, width: 58, height: 58, borderRadius: 999, border: 'none', background: NAVY, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 30px rgba(15,26,56,0.35)' }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" /><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" /></svg>
      </button>
    </div>
  );
}
