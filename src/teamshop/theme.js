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
/* Product grid: 4 across on desktop, stepping down responsively. minmax(0,1fr)
   keeps cards from overflowing on long names. */
.nts-product-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 22px; }
@media (max-width: 1024px) { .nts-product-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 760px) { .nts-product-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; } }
/* Phones stay 2-up (not 1) — a single stretched column reads oversized and
   wastes the "Ready to decorate" grid's whole point of easy comparison. */
/* Home "Shop by category" grid: 4 across on desktop, same step-down
   breakpoints as .nts-product-grid above. */
.nts-category-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 1024px) { .nts-category-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 760px) { .nts-category-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 480px) { .nts-category-grid { grid-template-columns: 1fr; } }
.nts-category-tile { transition: box-shadow 180ms ease, transform 180ms ease; }
.nts-category-tile:hover { box-shadow: 0 18px 48px rgba(15,26,56,0.16); transform: translateY(-2px); }
/* Cart (CartPage.js): line items + sticky order summary, two columns down
   to tablet width, one column (summary below items) on anything narrower. */
.nts-cart-layout { display: grid; grid-template-columns: minmax(0, 1.62fr) minmax(300px, 1fr); gap: clamp(28px, 3.5vw, 52px); align-items: start; }
@media (max-width: 860px) { .nts-cart-layout { grid-template-columns: 1fr; } }
.nts-cart-summary { position: sticky; top: 150px; }
@media (max-width: 860px) { .nts-cart-summary { position: static; } }
/* Chat widget (ChatWidget.js): pop-in panel, bouncing typing dots, and
   chips that invert to navy on hover, per the approved design. */
@keyframes nts-chat-pop-in { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
.nts-chat-panel { animation: nts-chat-pop-in 220ms ease-out; }
@keyframes nts-chat-launcher-in { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
.nts-chat-launcher { animation: nts-chat-launcher-in 220ms ease-out; }
@keyframes nts-chat-dot-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }
.nts-chat-dot { width: 6px; height: 6px; border-radius: 50%; background: ${TEXT_FAINT}; display: inline-block; animation: nts-chat-dot-bounce 950ms ease-in-out infinite; }
.nts-chat-chip { transition: background 150ms ease, color 150ms ease, border-color 150ms ease; }
.nts-chat-chip:hover { background: ${NAVY} !important; color: #fff !important; border-color: ${NAVY} !important; }
@media (max-width: 920px) {
  .nts-header-tagline { display: none; }
  /* Stack the menu bar centered on small screens: nav on top, utilities below,
     both centered (the empty left spacer collapses away). */
  .nts-header-row2 { grid-template-columns: 1fr !important; justify-items: center; gap: 10px !important; }
  .nts-header-row2 > span:empty { display: none; }
  .nts-header-row2 > div { justify-self: center !important; }
}
/* Mobile tab bar (TabBar.js) — Home / Shop / Stores / Account, fixed to the
   viewport bottom on phones only. .nts-root (TeamShopApp.js's outer div)
   gets matching bottom padding at the same breakpoint so the last bit of
   footer content is never hidden underneath it. */
.nts-tabbar { display: none; }
@media (max-width: 640px) {
  .nts-tabbar {
    display: grid; grid-template-columns: repeat(4, 1fr);
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 60;
    background: #fff; border-top: 1px solid ${BORDER};
    padding: 8px 6px calc(8px + env(safe-area-inset-bottom));
    box-shadow: 0 -4px 16px rgba(15,26,56,0.06);
  }
  .nts-root { padding-bottom: 66px; }
}
.nts-tabbar-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  min-height: 44px; padding: 4px 0; border: none; background: transparent; cursor: pointer;
  font-family: ${FONT_BODY};
}
.nts-tabbar-btn span { font-size: 10px; font-weight: 600; letter-spacing: 0.02em; }
@media (max-width: 640px) {
  /* Header: collapse to logo + search/account/cart icons only — the nav
     links and "Start with your logo" CTA are redundant with the tab bar
     (Home/Shop/Stores/Account) and the footer, and were the cramped part of
     the header at phone widths. */
  .nts-header-nav { display: none !important; }
  .nts-header-cta { display: none !important; }
  .nts-signin-label { display: none !important; }
  /* Chat launcher/panel dock above the tab bar instead of the viewport
     edge, so neither covers the other. */
  .nts-chat-dock { bottom: calc(78px + env(safe-area-inset-bottom)) !important; }
  /* Home hero: the desktop clamp's 460px floor eats over half of a phone
     screen — give phones a shorter floor of their own. */
  .nts-hero { min-height: clamp(320px, 78vw, 460px) !important; }
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
