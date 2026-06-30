// ─────────────────────────────────────────────────────────────────────────────
// Catalog UI kit — the shared visual language behind the public "Product Live
// Look" catalog (src/storefront/AdidasInventory.js, served at /adidas + /livelook).
//
// These primitives are lifted VERBATIM from that catalog so every webstore
// authoring surface (add items, templates, art) renders with the exact same
// feel — card grid, pill filters, chips, swatches — instead of re-approximating
// it. Render <CatalogKitStyles/> once per surface to inject the CSS + fonts.
//
// NOTE: AdidasInventory.js still carries its own inline copy of this CSS;
// migrating it to import from here (single source of truth) is a safe follow-up.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';

// Type — condensed display face for headings, humanist sans for body.
export const DISPLAY = "'Barlow Condensed','Oswald','Helvetica Neue',Impact,sans-serif";
export const BODY = "'Source Sans 3','Source Sans Pro','Helvetica Neue',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

// Verbatim from AdidasInventory.js. `.aik-scope` is the only addition: an
// embeddable wrapper that gives border-box sizing without the full-page
// background/min-height of `.ai-root`, so the kit can live inside an admin panel.
const KIT_CSS = `
.aik-scope *{box-sizing:border-box}
.ai-root *{box-sizing:border-box}
.ai-root{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;background:#F4F5F7;color:#191919;min-height:100vh}
.ai-root ::selection{background:#191919;color:#fff}
.ai-card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,26,56,.08);transition:transform .16s ease, box-shadow .16s ease;display:flex;flex-direction:column;cursor:pointer;border:none;padding:0;text-align:left;font-family:inherit}
.ai-card:hover{transform:translateY(-3px);box-shadow:0 14px 32px rgba(15,26,56,.13)}
.ai-chipgrid{display:flex;flex-wrap:wrap;gap:5px}
.ai-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid #E2E5EA;border-radius:6px;padding:2px 7px;font-size:12px;font-weight:600;background:#FAFBFC;white-space:nowrap}
.ai-chip b{font-weight:700}
.ai-filterbtn{border:1px solid #D8DCE2;background:#fff;border-radius:999px;padding:5px 13px;font-size:13px;font-weight:600;cursor:pointer;color:#3A4150;white-space:nowrap;transition:background .12s,color .12s,border-color .12s;font-family:inherit}
.ai-filterbtn:hover{border-color:#191919}
.ai-filterbtn.on{background:#191919;color:#fff;border-color:#191919}
.ai-select{border:1px solid #D8DCE2;background:#fff;border-radius:10px;padding:8px 10px;font-size:13.5px;font-weight:600;color:#3A4150;font-family:inherit;cursor:pointer;outline:none;max-width:180px}
.ai-select:focus{border-color:#191919}
.ai-search{width:100%;border:1px solid #D8DCE2;border-radius:10px;padding:9px 14px;font-size:15px;font-family:inherit;outline:none;background:#fff}
.ai-search:focus{border-color:#191919;box-shadow:0 0 0 3px rgba(25,25,25,.08)}
.ai-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
@media (max-width:560px){.ai-grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}}
.ai-more{display:block;margin:28px auto;border:2px solid #191919;background:#fff;color:#191919;border-radius:999px;padding:11px 38px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;transition:background .12s,color .12s}
.ai-more:hover{background:#191919;color:#fff}
.ai-dot{width:14px;height:14px;border-radius:50%;border:1px solid rgba(25,25,25,.18);display:inline-block;flex:none}
.ai-badge{display:inline-block;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.ai-modal-bg{position:fixed;inset:0;background:rgba(15,18,26,.55);z-index:50;display:flex;align-items:flex-start;justify-content:center;padding:4vh 14px;overflow-y:auto}
.ai-modal{background:#fff;border-radius:16px;max-width:860px;width:100%;box-shadow:0 30px 80px rgba(0,0,0,.35);margin-bottom:6vh}
.ai-cwrow{display:flex;gap:14px;padding:14px 0;border-top:1px solid #EEF0F3;align-items:flex-start}
.ai-iconbtn{border:1px solid #E2E5EA;background:#fff;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;cursor:pointer;color:#3A4150;font-family:inherit;transition:border-color .12s}
.ai-iconbtn:hover{border-color:#191919}
.ai-fab{position:fixed;right:18px;bottom:18px;z-index:40;background:#191919;color:#fff;border:none;border-radius:999px;padding:13px 22px;font-size:14.5px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 10px 28px rgba(15,26,56,.3);display:flex;align-items:center;gap:8px;transition:transform .15s}
.ai-fab:hover{transform:translateY(-2px)}
.ai-drawer-bg{position:fixed;inset:0;background:rgba(15,18,26,.45);z-index:60}
.ai-drawer{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);background:#fff;z-index:61;box-shadow:-18px 0 50px rgba(0,0,0,.25);display:flex;flex-direction:column}
.ai-input{width:100%;border:1px solid #D8DCE2;border-radius:8px;padding:9px 12px;font-size:14px;font-family:inherit;outline:none}
.ai-input:focus{border-color:#191919}
.ai-qbtn{border:1px solid #D8DCE2;background:#fff;border-radius:6px;width:26px;height:26px;font-size:14px;font-weight:700;cursor:pointer;color:#3A4150;line-height:1}
.ai-qbtn:hover{border-color:#191919}
.ai-toast{position:fixed;bottom:84px;left:50%;transform:translateX(-50%);background:#191919;color:#fff;border-radius:999px;padding:9px 20px;font-size:13.5px;font-weight:600;z-index:70;box-shadow:0 10px 28px rgba(0,0,0,.3);white-space:nowrap;animation:ai-toast-in .18s ease}
.ai-colorpop{position:absolute;top:calc(100% + 6px);left:0;z-index:20;background:#fff;border:1px solid #E2E5EA;border-radius:12px;padding:12px;box-shadow:0 18px 44px rgba(15,26,56,.18);width:280px}
.ai-swatch{display:flex;align-items:center;gap:7px;border:1px solid #E2E5EA;background:#FAFBFC;border-radius:8px;padding:6px 8px;font-size:12.5px;font-weight:600;cursor:pointer;color:#3A4150;font-family:inherit;transition:border-color .12s}
.ai-swatch:hover{border-color:#191919}
.ai-swatch.on{border-color:#191919;background:#191919;color:#fff}
.ai-sizecell{display:flex;flex-direction:column;align-items:center;gap:3px;border:1px solid #E2E5EA;border-radius:8px;padding:5px 4px 4px;background:#FAFBFC;width:54px}
.ai-sizecell.inbound{border-color:#F0DCC0;background:#FFFBF3}
.ai-sizecell.inhouse{border-color:#BBE3C8;background:#F2FBF5}
.ai-sizecell .lbl{font-size:11.5px;font-weight:700;line-height:1}
.ai-sizecell .avail{font-size:10.5px;font-weight:700;line-height:1}
.ai-qtyin{width:44px;border:1px solid #D8DCE2;border-radius:6px;padding:3px 2px;font-size:12.5px;font-weight:700;text-align:center;font-family:inherit;outline:none;background:#fff}
.ai-qtyin:focus{border-color:#191919}
.ai-qtyin:not(:placeholder-shown){border-color:#191919;background:#fff;color:#191919}
@keyframes ai-toast-in{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
`;

// Inject the kit CSS + Google Font links. Render once per surface that uses the
// catalog look (idempotent — duplicate identical <style> tags are harmless).
export function CatalogKitStyles() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700&family=Source+Sans+3:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{KIT_CSS}</style>
    </>
  );
}

// Embeddable wrapper: applies the body font + border-box without the full-page
// background/min-height of the live-look's `.ai-root`, so the kit can live
// inside an existing admin panel.
export function KitScope({ style, className = '', children, ...rest }) {
  return (
    <div className={('aik-scope ' + className).trim()} style={{ fontFamily: BODY, color: '#191919', ...style }} {...rest}>
      {children}
    </div>
  );
}

// Pill toggle (brand / category / any facet). Solid near-black when active.
export function FilterBtn({ on, children, ...rest }) {
  return <button type="button" className={'ai-filterbtn' + (on ? ' on' : '')} {...rest}>{children}</button>;
}

// Color/option swatch toggle.
export function Swatch({ on, children, ...rest }) {
  return <button type="button" className={'ai-swatch' + (on ? ' on' : '')} {...rest}>{children}</button>;
}

// Dense info chip (sizes, tags, counts).
export function Chip({ children, style, ...rest }) {
  return <span className="ai-chip" style={style} {...rest}>{children}</span>;
}

// "Show more" pill for chunked lists.
export function ShowMore({ children = 'Show more', ...rest }) {
  return <button type="button" className="ai-more" {...rest}>{children}</button>;
}

// Multi-word token search: every whitespace-separated token must appear in the
// haystack. Mirrors the live-look's matcher so search behaves identically.
export function tokenMatch(query, haystack) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = String(haystack || '').toLowerCase();
  return tokens.every((t) => hay.includes(t));
}
