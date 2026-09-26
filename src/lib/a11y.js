// Accessibility helpers shared by the customer-facing pages (team stores,
// coach portal). See ACCESSIBILITY_VPAT_2026-09-25.md.
import React from 'react';


// Keyboard access for a click-to-activate element that isn't a native
// <button>/<a> (a card, a table row, a tile). Without it a keyboard or
// screen-reader user can't reach or trigger the element at all (WCAG 2.1.1).
// Spread onto the element: <div {...kbActivate(fn)}>. Enter/Space activate,
// like a native control; `data-kb-activate` hooks a :focus-visible ring.
// Pass role 'button' for in-page actions, 'link' (default) for navigation.
export function kbActivate(fn, role = 'link') {
  return {
    role, tabIndex: 0, 'data-kb-activate': '', onClick: fn,
    onKeyDown: (e) => {
      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fn(e); }
    },
  };
}

// "Skip to main content" link (WCAG 2.4.1). Put it first in the page and give
// the page's <main> the matching id (MAIN_ID). Hidden until it receives
// keyboard focus. Focuses the target in JS rather than following the #hash,
// so the pushState routers (Team Shop, team stores) never see a URL change.
export const MAIN_ID = 'main-content';
const SKIP_CSS = '.a11y-skip{position:absolute;left:8px;top:-60px;z-index:10000;background:#192853;color:#fff;'
  + 'padding:10px 16px;border-radius:4px;font:600 15px system-ui,sans-serif;text-decoration:none}'
  + '.a11y-skip:focus{top:8px;outline:3px solid #fff;outline-offset:2px}';
export function SkipLink({ target = MAIN_ID }) {
  const go = (e) => {
    const el = document.getElementById(target);
    if (!el) return;
    e.preventDefault();
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus();
    if (el.scrollIntoView) el.scrollIntoView();
  };
  return (
    <>
      <style>{SKIP_CSS}</style>
      <a href={'#' + target} className="a11y-skip" onClick={go}>Skip to main content</a>
    </>
  );
}

// ── WCAG contrast (1.4.3) ─────────────────────────────────────────────
// Team store / order-tracking palettes come from each school's colors, so text drawn in or on them
// can land under 4.5:1 (gold on maroon, white on vegas gold). These keep the
// designed color whenever it already passes and only step in when it doesn't.
function _relLum(hex) {
  const h = (hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export function contrastRatio(a, b) {
  try { const x = _relLum(a), y = _relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); } catch { return 21; }
}
// Text color for a solid background: `preferred` if it reaches 4.5:1, else
// whichever of white / near-black reads better.
export function readable(bg, preferred) {
  if (preferred && /^#[0-9a-f]{3,6}$/i.test(preferred) && contrastRatio(preferred, bg) >= 4.5) return preferred;
  return contrastRatio('#FFFFFF', bg) >= contrastRatio('#111111', bg) ? '#FFFFFF' : '#111111';
}
// Keep a brand color as the text color on `bg`, nudging it toward white (dark
// bg) or black (light bg) just far enough to reach 4.5:1.
export function legibleOn(fg, bg) {
  const target = _relLum(bg) < 0.18 ? '#FFFFFF' : '#000000';
  let c = fg;
  for (let t = 0; t <= 1 && contrastRatio(c, bg) < 4.5; t += 0.05) c = _mixHex(fg, target, t);
  return c;
}
function _mixHex(a, b, t) {
  const p = (h) => { h = h.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
