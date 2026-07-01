// Uniform Builder — jersey font registry.
//
// Each entry maps a stable id (stored in the design spec) to a CSS font stack and
// a display label. The Google Fonts these reference are loaded via a <link> in
// public/index.html; every stack ends in a system fallback so text still renders
// (just less "athletic") if the webfont hasn't loaded or is offline.
//
// IMPORTANT for production export: the Canvas 2D renderer draws text with these
// same stacks, and canvas text honors document-loaded webfonts — but only once
// they're ready. Callers should `await ensureFontsReady()` before rasterizing so
// the PNG matches the on-screen preview instead of falling back to the system face.

export const FONTS = [
  { id: 'anton', label: 'Block (Anton)', stack: "'Anton', Impact, sans-serif", weight: 400 },
  { id: 'bebas', label: 'Tall (Bebas Neue)', stack: "'Bebas Neue', 'Arial Narrow', sans-serif", weight: 400 },
  { id: 'saira', label: 'Condensed (Saira)', stack: "'Saira Condensed', 'Barlow Condensed', sans-serif", weight: 700 },
  { id: 'oswald', label: 'Athletic (Oswald)', stack: "'Oswald', 'Arial Narrow', sans-serif", weight: 600 },
  { id: 'graduate', label: 'Collegiate (Graduate)', stack: "'Graduate', Georgia, serif", weight: 400 },
  { id: 'squada', label: 'Varsity (Squada One)', stack: "'Squada One', Impact, sans-serif", weight: 400 },
  { id: 'rye', label: 'Western (Rye)', stack: "'Rye', 'Rockwell', serif", weight: 400 },
  { id: 'pirata', label: 'Gothic (Pirata One)', stack: "'Pirata One', 'UnifrakturCook', serif", weight: 400 },
  { id: 'pacifico', label: 'Script (Pacifico)', stack: "'Pacifico', 'Brush Script MT', cursive", weight: 400 },
  { id: 'baloo', label: 'Rounded (Baloo 2)', stack: "'Baloo 2', 'Trebuchet MS', sans-serif", weight: 800 },
];

const BY_ID = Object.fromEntries(FONTS.map((f) => [f.id, f]));

export function fontStack(id) { return (BY_ID[id] || FONTS[0]).stack; }
export function fontWeight(id) { return (BY_ID[id] || FONTS[0]).weight; }

// Build a canvas/CSS `font` shorthand string for a given font id + pixel size.
export function fontShorthand(id, px) {
  const f = BY_ID[id] || FONTS[0];
  return `${f.weight} ${Math.round(px)}px ${f.stack}`;
}

// Resolve when the webfonts we care about are actually loaded, so a production
// raster doesn't capture the fallback face. `document.fonts.load` primes each
// family at a representative size; `.ready` waits for in-flight loads to finish.
// Degrades to an immediate resolve where the Font Loading API is unavailable.
export async function ensureFontsReady() {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.all(
      FONTS.map((f) => {
        // The first quoted family in the stack is the webfont we want to prime.
        const m = f.stack.match(/'([^']+)'/);
        const fam = m ? m[1] : f.stack.split(',')[0];
        return document.fonts.load(`${f.weight} 64px "${fam}"`).catch(() => {});
      })
    );
    await document.fonts.ready;
  } catch (_e) { /* best-effort; fall through to whatever is available */ }
}
