import { garmentMockKey, mockSlotKeys } from '../safeHelpers';
import { decoUrlForColor } from './decoOverlay';
import { placementById } from './artPlacements';

// Use the storefront's raw-photo / contain / 4:5 geometry, not a supplier
// thumbnail alone. Keeping this plan pure makes color/side routing testable.
export function storeMockPlan({ item, product = {}, catalog = {}, decorations = [], ambiguous, substituted }, side = 'front') {
  if (ambiguous || substituted) throw new Error('Garment changed or store image is ambiguous; review the mock manually');
  const decos = decorations.filter(d => d && (d.side || 'front') === side);
  if (!decos.length) return null;
  const base = side === 'back'
    ? catalog.image_back_url || product.image_back_url
    : catalog.image_url || product.image_front_url;
  if (!base) throw new Error('No ' + side + ' garment image for ' + item.sku);
  const layers = decos.filter(d => !d.baked).map(d => {
    const url = decoUrlForColor(d, item.color);
    if (!url) throw new Error('Missing placed logo for ' + item.sku);
    const preset = placementById(d.placement);
    const x = d.x ?? preset.x, y = d.y ?? preset.y, w = d.w ?? preset.w;
    if (![x, y, w].every(v => Number.isFinite(Number(v))) || Number(w) <= 0) throw new Error('Invalid logo placement for ' + item.sku);
    return { url, x: Number(x), y: Number(y), w: Number(w) };
  });
  // A baked placement only proves a mock when the store's own photo exists.
  if (decos.some(d => d.baked) && !(side === 'back' ? catalog.image_back_url : catalog.image_url)) throw new Error('Missing saved mock for ' + item.sku);
  return { base, layers, side, width: 800, height: 1000 };
}

export const containRect = (iw, ih, width, height) => {
  const scale = Math.min(width / iw, height / ih);
  return { x: (width - iw * scale) / 2, y: (height - ih * scale) / 2, width: iw * scale, height: ih * scale };
};

const loadImage = url => new Promise((resolve, reject) => {
  const img = new Image();
  const timer = setTimeout(() => reject(new Error('Store mock image timed out')), 20000);
  img.crossOrigin = 'anonymous';
  img.onload = () => { clearTimeout(timer); resolve(img); };
  img.onerror = () => { clearTimeout(timer); reject(new Error('Could not load store mock image')); };
  img.src = '/.netlify/functions/image-proxy?url=' + encodeURIComponent(url);
});

export async function renderStoreMock(plan) {
  if (!plan.layers.length) return plan.base; // already baked: no duplicate logo
  const [base, ...logos] = await Promise.all([plan.base, ...plan.layers.map(l => l.url)].map(loadImage));
  const canvas = document.createElement('canvas'); canvas.width = plan.width; canvas.height = plan.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not render store mock');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const r = containRect(base.naturalWidth, base.naturalHeight, canvas.width, canvas.height);
  ctx.drawImage(base, r.x, r.y, r.width, r.height);
  plan.layers.forEach((l, i) => {
    const w = canvas.width * l.w / 100, h = w * logos[i].naturalHeight / logos[i].naturalWidth;
    ctx.drawImage(logos[i], canvas.width * l.x / 100 - w / 2, canvas.height * l.y / 100 - h / 2, w, h);
  });
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not export store mock');
  return new File([blob], 'store-garment-mock.png', { type: 'image/png' });
}

// Only write slots actually decorated by this product. Never copy all store
// photos onto every art, overwrite an existing mock, or change approval status.
export async function attachStoreGarmentMocks(artFiles, sources, { render = renderStoreMock, upload }) {
  let arts = artFiles;
  const warnings = [], cache = new Map();
  for (const source of sources) {
    const { item } = source;
    const slots = mockSlotKeys(garmentMockKey(item), item.decorations).filter(s => s.kind === 'art');
    for (const side of ['front', 'back']) {
      const target = slots.filter(s => (item.decorations[s.di].side || 'front') === side);
      const missing = target.filter(s => {
        const art = arts.find(a => a.id === item.decorations[s.di].art_file_id);
        // An explicit empty bucket is a deliberate removal, not a request to refill.
        return art && !Object.prototype.hasOwnProperty.call(art.item_mockups || {}, s.key);
      });
      if (!missing.length) continue;
      try {
        if (missing.some(s => item.decorations[s.di].transfer_code)) throw new Error('Transfer has no positioned store image; review the mock manually');
        const plan = storeMockPlan(source, side);
        if (!plan) throw new Error('No positioned store artwork; upload the garment mock manually');
        const key = JSON.stringify(plan);
        if (!cache.has(key)) cache.set(key, (async () => { const result = await render(plan); return typeof result === 'string' ? result : upload(result, 'nsa-store-mocks'); })());
        const url = await cache.get(key);
        if (!url) throw new Error('Store mock upload failed');
        arts = arts.map(a => {
          const owned = missing.filter(s => item.decorations[s.di].art_file_id === a.id);
          if (!owned.length) return a;
          const mocks = { ...(a.item_mockups || {}) };
          owned.forEach(s => { mocks[s.key] = [{ url, name: item.sku + ' · ' + (item.color || '') + ' · Store mock ' + side + '.png', sku: item.sku, art_file_id: a.id, source: 'webstore', side }]; });
          return { ...a, item_mockups: mocks };
        });
      } catch (e) { warnings.push(item.sku + ' (' + side + '): ' + e.message); }
    }
  }
  return { artFiles: arts, warnings: [...new Set(warnings)] };
}
