// Team Shop design tokens — the single source for the storefront chunk's
// palette and fonts, matching the approved Claude Design mockup
// ("Shop - Polos.dc.html", project 0d2b8ea7). Components keep the repo's
// inline-style approach for static styles; anything that needs pseudo-states
// (:hover/:focus-visible) or media queries lives in the one shared <style>
// block injected below. No global CSS (portal.css) is touched — the block is
// namespaced with an `nts-` class prefix and only mounts when the teamshop
// chunk renders.

export const NAVY = '#192853';
export const NAVY_DARK = '#0F1A38';
export const RED = '#962C32'; // accent ONLY — never large fills
export const RED_SOFT = '#D94A52'; // thin accent strokes on navy surfaces (mockup roster card)
export const OFF_WHITE = '#F7F8FB';
export const BORDER = '#EEF1F6';
export const BORDER_DARK = '#D1D5DE';
export const TEXT = '#2A2F3E';
export const TEXT_MUTED = '#5A6075';
export const TEXT_FAINT = '#8790A5';
export const GREEN = '#2F6B45'; // "Ready to decorate" / in-stock check

export const FONT_DISPLAY = "'Barlow Condensed', sans-serif";
export const FONT_BODY = "'Source Sans 3', system-ui, sans-serif";

// Barlow Condensed uppercase display style, reused across headers/cards.
export const displayType = (size, extra = {}) => ({
  fontFamily: FONT_DISPLAY,
  textTransform: 'uppercase',
  fontWeight: 600,
  fontSize: size,
  ...extra,
});

const STYLE_ID = 'nts-teamshop-theme';

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');
.nts-root { font-family: ${FONT_BODY}; color: ${TEXT}; -webkit-font-smoothing: antialiased; }
.nts-root a { text-decoration: none; }
.nts-navlink { transition: color 150ms ease; }
.nts-navlink:hover { color: ${RED} !important; }
.nts-crumb:hover { color: ${RED} !important; }
.nts-cta-navy { transition: background 180ms ease; }
.nts-cta-navy:hover { background: ${NAVY_DARK} !important; }
.nts-cta-red { transition: background 180ms ease; }
.nts-cta-red:hover { background: #B8333B !important; }
.nts-ghost { transition: background 150ms ease; }
.nts-ghost:hover { background: rgba(255,255,255,0.18) !important; }
.nts-footlink { transition: color 150ms ease; }
.nts-footlink:hover { color: #fff !important; }
.nts-card { transition: box-shadow 180ms ease, transform 180ms ease; }
.nts-card:hover { box-shadow: 0 18px 48px rgba(15,26,56,0.12); transform: translateY(-2px); }
.nts-root button:focus-visible, .nts-root a:focus-visible, .nts-root input:focus-visible, .nts-root select:focus-visible { outline: 2px solid ${RED}; outline-offset: 2px; }
.nts-input:focus { border-color: ${NAVY} !important; outline: none; box-shadow: 0 0 0 3px rgba(25,40,83,0.12); }
.nts-listing { display: grid; grid-template-columns: 270px 1fr; gap: clamp(24px, 3vw, 40px); align-items: start; }
.nts-sidebar { position: sticky; top: 150px; display: flex; flex-direction: column; gap: 20px; }
/* Product grid: 4 across on desktop, stepping down responsively. minmax(0,1fr)
   keeps cards from overflowing on long names. */
.nts-product-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 22px; }
@media (max-width: 1024px) { .nts-product-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 760px) { .nts-product-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 480px) { .nts-product-grid { grid-template-columns: 1fr; } }
@media (max-width: 920px) {
  .nts-listing { grid-template-columns: 1fr; }
  .nts-sidebar { position: static; }
  .nts-header-tagline { display: none; }
  /* Stack the menu bar centered on small screens: nav on top, utilities below,
     both centered (the empty left spacer collapses away). */
  .nts-header-row2 { grid-template-columns: 1fr !important; justify-items: center; gap: 10px !important; }
  .nts-header-row2 > span:empty { display: none; }
  .nts-header-row2 > div { justify-self: center !important; }
}
`;

// Idempotently mount the shared style block (fonts + hover/focus/media rules).
export function ensureTeamShopStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}
