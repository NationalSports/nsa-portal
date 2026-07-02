// Publish-time mockup baking — composites each store garment photo with its placed
// logos into a saved PNG proof, written to the owning art record's item_mockups
// (keyed sku|color, tagged auto:true + color_way_id). Webstore-sourced Sales Orders
// then arrive with a real decorated mockup instead of the bare catalog photo, because
// batchOrders already merges item_mockups onto the SO's art files.
//
// Split for testability: planStoreBakes() is pure — it decides WHAT to bake from the
// store catalog (unit-tested, no DOM). bakeMockBlob() does the canvas compositing in
// the browser. The executor (Webstores.bakeStoreMockups) uploads and writes the library.
//
// Deliberate non-goals (see WEB_LOGOS_CW_AUTOMATION_RESEARCH_2026-07-02.md):
// - NEVER touches webstore_products.image_url or decorations[] — the storefront keeps
//   its live CSS overlay; baking into those would stamp the logo twice.
// - Personalization tokens (perso_number/perso_name) are not baked: their sample
//   values would read as a promise on a saved proof.
// - Auto entries REPLACE prior auto entries for the same garment+art on re-publish;
//   a garment that already has a manual (artist) mock is never auto-baked over.
import { placementById } from './artPlacements';

const _colorKey = (name) => String(name || '').trim().toLowerCase();
const _words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
// Only raster-or-svg cutouts can be drawn onto the canvas — vector sources can't.
const _isDrawable = (u) => /\.(png|svg|jpe?g|gif|webp)(\?|$)/i.test(u || '') || /^data:image\//i.test(u || '');

// Resolve a placed decoration to the web-logo cutout + color way for ONE garment color.
// Mirrors the builder's decoUrlForColor but returns the CW identity alongside the url:
//   1. explicit cw_by_color pick — {url, color_way_id} (id-keyed) or a legacy bare url
//   2. auto-match the garment color against the art's web_logos (shared word token,
//      e.g. "Heather Grey" matches a "Grey" color way), then the default/blank entry
//   3. the deco's placed art_url
export function resolveDecoForColor(deco, colorName, art) {
  if (!deco) return null;
  const pick = deco.cw_by_color && deco.cw_by_color[_colorKey(colorName)];
  if (pick) {
    if (typeof pick === 'string') return { url: pick, colorWayId: null };
    if (pick.url) return { url: pick.url, colorWayId: pick.color_way_id || null };
  }
  const wls = (art && Array.isArray(art.web_logos) ? art.web_logos : []).filter((w) => w && w.url);
  const g = _words(colorName);
  if (wls.length && g.length) {
    const hit = wls.find((w) => { const c = _words(w.color_way); return c.length && (c.some((t) => g.includes(t)) || g.some((t) => c.includes(t))); });
    if (hit) return { url: hit.url, colorWayId: hit.color_way_id || null };
  }
  const def = wls.find((w) => { const c = (w.color_way || '').trim(); return w.is_default || !c || /all/i.test(c); });
  if (def) return { url: def.url, colorWayId: def.color_way_id || null };
  return deco.art_url ? { url: deco.art_url, colorWayId: null } : null;
}

// Decide what to bake for a store. Returns one task per garment color × side that has
// placed art:
//   { key: 'SKU|Color', sku, color, side, garmentUrl,
//     decos: [{ url, x, y, w }],                      // drawables at center-%, width-%
//     writes: [{ artId, custId, colorWayId }] }       // which art records get the mock
export function planStoreBakes({ catalog, stockByWp, libraryArt, storeArt, defaultCustId }) {
  const lib = Array.isArray(libraryArt) ? libraryArt : [];
  const store = Array.isArray(storeArt) ? storeArt : [];
  const artOf = (id) => (id && (lib.find((a) => a.id === id) || store.find((a) => a.id === id))) || null;
  const tasks = [];
  (Array.isArray(catalog) ? catalog : []).forEach((c) => {
    if (!c || c.kind !== 'single') return;
    const decos = (Array.isArray(c.decorations) ? c.decorations : []).filter((d) => d && d.kind !== 'perso_number' && d.kind !== 'perso_name' && (d.art_id || d.art_file_id || d.art_url));
    if (!decos.length) return;
    const st = (stockByWp || {})[c.id] || {};
    const color = st.color || '';
    const key = (c.sku || '') + '|' + color;
    const urlBySide = { front: c.image_url || st.image_front_url || '', back: st.image_back_url || '' };
    ['front', 'back'].forEach((side) => {
      const garmentUrl = urlBySide[side];
      if (!garmentUrl) return;
      const sideDecos = decos.filter((d) => ((d.side || 'front') === 'back') === (side === 'back'));
      const draw = []; const writes = []; const seenArt = new Set();
      sideDecos.forEach((d) => {
        const artId = d.art_id || d.art_file_id;
        const art = artOf(artId);
        const r = resolveDecoForColor(d, color, art);
        if (!r || !_isDrawable(r.url)) return;
        const p = placementById(d.placement);
        draw.push({ url: r.url, x: d.x != null ? d.x : p.x, y: d.y != null ? d.y : p.y, w: d.w != null ? d.w : p.w });
        // Only art with a home in the library gets the mock written back; ad-hoc logos
        // (no record) still bake into the image but have nowhere durable to live.
        if (art && artId && !seenArt.has(artId)) {
          seenArt.add(artId);
          writes.push({ artId, custId: art._srcCustId || defaultCustId || null, colorWayId: r.colorWayId });
        }
      });
      if (draw.length && writes.length) tasks.push({ key, sku: c.sku || '', color, side, garmentUrl, decos: draw, writes });
    });
  });
  return tasks;
}

// Composite one garment + its decos into a PNG blob. 4:5 canvas, garment cover-cropped
// (mirrors GarmentLogoPreview / the storefront card), each logo centered at (x%, y%)
// with width w% and its own aspect ratio, same as the live overlay math.
const _loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('image failed: ' + url)); i.src = url; });
export async function bakeMockBlob({ garmentUrl, decos }, size = { w: 920, h: 1150 }) {
  const garment = await _loadImg(garmentUrl);
  const logos = await Promise.all((decos || []).map((d) => _loadImg(d.url).then((img) => ({ d, img }))));
  const canvas = document.createElement('canvas');
  canvas.width = size.w; canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size.w, size.h);
  // cover-crop the garment photo into the 4:5 frame
  const s = Math.max(size.w / garment.width, size.h / garment.height);
  const gw = garment.width * s, gh = garment.height * s;
  ctx.drawImage(garment, (size.w - gw) / 2, (size.h - gh) / 2, gw, gh);
  logos.forEach(({ d, img }) => {
    const w = (Number(d.w) || 0) / 100 * size.w;
    if (!w || !img.width) return;
    const h = w * (img.height / img.width);
    const cx = (Number(d.x) || 50) / 100 * size.w, cy = (Number(d.y) || 50) / 100 * size.h;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  });
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('canvas export failed (tainted image?)'))), 'image/png'));
}
