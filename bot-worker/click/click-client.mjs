// Adidas CLICK cart client — Phase 2 of ADIDAS_CLICK_FAST_ORDER_ENTRY_SPEC_2026-08-12.md.
//
// Replaces the mechanical half of the LLM browser run with direct calls to the JSON API the
// portal's own SPA uses (endpoints and bodies verified by the Phase 1 capture, PO 57073 SFVB):
//
//   GET    /service/cart/{acct}/storefronts/1/cart          → current cart id
//   GET    /service/cart/{acct}/cart/{cartId}/materials     → cart lines + each article's sizes
//   POST   /service/cart/{acct}/cart/{cartId}/materials/add → [{context,materialNumber}]
//   PUT    /service/cart/{acct}/cart/{cartId}/materials/sizes
//                        → [{context,materialNumber,requestedDeliveryDate,quantity,technicalSize}]
//   PATCH  /service/cart/{acct}/cart/{cartId}               → {personalReference:"<PO number>"}
//
// Both array endpoints take every row in ONE request. The browser agent sent one PUT per size and
// spent 4m11s of an 8m40s run doing it; this sends one.
//
// NEVER submits. There is no checkout call in this file, by design — the cart is left for human
// review exactly as the existing flow leaves it.
//
// Auth: the caller passes headers captured from a live browser session (see fill-cart.mjs). That
// avoids guessing how CLICK authenticates — Salesforce SSO with Akamai in front — and means this
// file holds no credential logic at all.

// A failure that names the endpoint, status and payload, so a portal change is diagnosable from the
// error text alone (same principle as netlify/functions/silverscreen-job.js).
export class ClickError extends Error {
  constructor(message, { method, url, status, body, sent } = {}) {
    super(message + (status ? ' (HTTP ' + status + ')' : '') + (method ? ' — ' + method + ' ' + url : ''));
    this.name = 'ClickError';
    Object.assign(this, { method, url, status, body, sent });
  }
}

const CTX = 'default';

// Our size labels vs. the size text CLICK shows. Their wire format is a technicalSize CODE
// (210/230/250/270 for the 15 pcs in the captured run), so codes are always looked up from the
// article's own grid — never assumed. This only normalises LABELS before comparing them.
const SIZE_ALIASES = {
  XS: ['XS', 'XSMALL', 'X-SMALL', 'EXTRA SMALL'],
  S: ['S', 'SM', 'SMALL'],
  M: ['M', 'MD', 'MED', 'MEDIUM'],
  L: ['L', 'LG', 'LARGE'],
  XL: ['XL', 'XLARGE', 'X-LARGE', 'EXTRA LARGE'],
  '2XL': ['2XL', 'XXL', '2X', 'XX-LARGE'],
  '3XL': ['3XL', 'XXXL', '3X'],
  '4XL': ['4XL', 'XXXXL', '4X'],
  '5XL': ['5XL', 'XXXXXL', '5X'],
  OSFA: ['OSFA', 'OSFM', 'ONE SIZE', 'OS', 'NS'],
};
const canonSize = (raw) => {
  const s = String(raw ?? '').toUpperCase().replace(/[\s._-]+/g, '');
  for (const [canon, alts] of Object.entries(SIZE_ALIASES)) {
    if (alts.some((a) => a.replace(/[\s._-]+/g, '') === s)) return canon;
  }
  return s;
};

// The article's size grid, dug out of whatever shape the response uses. Their payloads nest
// differently per endpoint, so probe the plausible spots rather than hardcoding one path; if none
// match, the caller gets a loud error listing the keys that WERE present.
function extractSizeGrid(node, depth = 0) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    // A grid is an array of objects carrying a technical size code.
    const codes = node.filter((x) => x && typeof x === 'object'
      && (x.technicalSize != null || x.technicalSizeCode != null));
    if (codes.length) {
      return codes.map((x) => ({
        technicalSize: String(x.technicalSize ?? x.technicalSizeCode),
        label: String(x.size ?? x.sizeLabel ?? x.displaySize ?? x.name ?? x.technicalSize ?? ''),
        available: x.available ?? x.isAvailable ?? x.stock ?? null,
        futureDate: x.futureDate ?? x.availableDate ?? x.nextDeliveryDate ?? null,
      }));
    }
    for (const item of node) { const hit = extractSizeGrid(item, depth + 1); if (hit) return hit; }
    return null;
  }
  if (typeof node === 'object') {
    for (const key of ['sizes', 'availableSizes', 'sizeGrid', 'materialSizes', 'productSizes', 'items', 'materials', 'data']) {
      if (node[key] != null) { const hit = extractSizeGrid(node[key], depth + 1); if (hit) return hit; }
    }
    for (const v of Object.values(node)) { const hit = extractSizeGrid(v, depth + 1); if (hit) return hit; }
  }
  return null;
}

// Cart lines as {materialNumber, sizes:{technicalSize:qty}} — used for the post-write diff.
function extractCartLines(node, depth = 0, out = new Map()) {
  if (!node || depth > 6) return out;
  if (Array.isArray(node)) { node.forEach((x) => extractCartLines(x, depth + 1, out)); return out; }
  if (typeof node === 'object') {
    const mat = node.materialNumber ?? node.material ?? node.articleNumber;
    if (mat) {
      const grid = extractSizeGrid(node, 0) || [];
      const sizes = {};
      grid.forEach((g) => {
        const q = Number(g.quantity ?? 0);
        if (q > 0) sizes[g.technicalSize] = (sizes[g.technicalSize] || 0) + q;
      });
      // Quantities may sit alongside the grid rather than inside it.
      if (!Object.keys(sizes).length && Array.isArray(node.sizes)) {
        node.sizes.forEach((s) => {
          const q = Number(s?.quantity ?? 0);
          const code = s?.technicalSize ?? s?.technicalSizeCode;
          if (q > 0 && code != null) sizes[String(code)] = (sizes[String(code)] || 0) + q;
        });
      }
      const prev = out.get(String(mat)) || {};
      Object.entries(sizes).forEach(([k, v]) => { prev[k] = (prev[k] || 0) + v; });
      out.set(String(mat), prev);
    }
    Object.values(node).forEach((v) => extractCartLines(v, depth + 1, out));
  }
  return out;
}

export class ClickClient {
  // headers: captured from a live browser request to the API host (cookies/auth included).
  constructor({ baseUrl = 'https://clapp-v2.whs.adidas.com', headers = {}, account, salesOrg, soldTo, fetchImpl = fetch, log = () => {} }) {
    if (!account) throw new Error('ClickClient needs the account number (e.g. 0000270384)');
    Object.assign(this, { baseUrl: baseUrl.replace(/\/$/, ''), headers, account, salesOrg, soldTo, fetchImpl, log });
  }

  async call(method, path, body) {
    const url = this.baseUrl + path;
    const init = { method, headers: { ...this.headers, accept: 'application/json' } };
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try { res = await this.fetchImpl(url, init); }
    catch (e) { throw new ClickError('request failed: ' + e.message, { method, url, sent: body }); }
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON (204, HTML challenge) */ }
    if (res.status === 401 || res.status === 403) {
      throw new ClickError('CLICK rejected the session — the browser login may have expired, or Akamai challenged a non-browser request', { method, url, status: res.status, body: text.slice(0, 300), sent: body });
    }
    if (!res.ok) {
      throw new ClickError('CLICK refused ' + method + ' ' + path, { method, url, status: res.status, body: text.slice(0, 500), sent: body });
    }
    this.log('[click] ' + method + ' ' + path + ' → ' + res.status);
    return json;
  }

  cartBase(cartId) { return '/service/cart/' + this.account + '/cart/' + cartId; }

  async currentCartId() {
    const j = await this.call('GET', '/service/cart/' + this.account + '/storefronts/1/cart');
    const id = j?.cartId ?? j?.id ?? j?.cart?.id ?? j?.cart?.cartId
      ?? (Array.isArray(j) ? (j[0]?.cartId ?? j[0]?.id) : null);
    if (!id) {
      throw new ClickError('could not find the cart id in the storefront cart response; keys seen: ['
        + Object.keys(j || {}).join(', ') + ']', { method: 'GET', url: '/storefronts/1/cart', body: JSON.stringify(j).slice(0, 400) });
    }
    return String(id);
  }

  async cartMaterials(cartId) { return this.call('GET', this.cartBase(cartId) + '/materials'); }

  // Every article in ONE call (the endpoint takes an array).
  async addMaterials(cartId, materialNumbers) {
    const uniq = [...new Set(materialNumbers.filter(Boolean))];
    if (!uniq.length) return null;
    return this.call('POST', this.cartBase(cartId) + '/materials/add',
      uniq.map((materialNumber) => ({ context: CTX, materialNumber })));
  }

  // Every size row for every article in ONE call — the 4m11s stage.
  async setSizes(cartId, rows) {
    if (!rows.length) return null;
    return this.call('PUT', this.cartBase(cartId) + '/materials/sizes', rows.map((r) => ({
      context: CTX,
      materialNumber: r.materialNumber,
      requestedDeliveryDate: r.requestedDeliveryDate,
      quantity: r.quantity,
      technicalSize: r.technicalSize,
    })));
  }

  async setPersonalReference(cartId, poNumber) {
    return this.call('PATCH', this.cartBase(cartId), { personalReference: poNumber });
  }

  async searchArticle(term) {
    if (!this.salesOrg || !this.soldTo) throw new Error('searchArticle needs salesOrg and soldTo');
    return this.call('POST', '/service/catalog/products/' + this.salesOrg + '/' + this.soldTo + '/adidas/reorder',
      { articleNumbers: [term], page: 1, pageSize: 1, orderType: 'OR' });
  }

  // Resolve our {sku, sizes:{LABEL:qty}} lines into technicalSize rows using each article's own
  // grid. A label we can't place is an error, never a silent drop: 15 pcs must stay 15 pcs.
  async buildSizeRows({ cartId, lines, requestedDeliveryDate, materialsResponse = null }) {
    const cart = materialsResponse || await this.cartMaterials(cartId);
    const rows = [];
    const problems = [];
    for (const line of lines) {
      const mat = String(line.sku);
      // The grid for this article: prefer its cart entry, else ask the catalog.
      let grid = null;
      const forMat = findNodeForMaterial(cart, mat);
      if (forMat) grid = extractSizeGrid(forMat, 0);
      if (!grid) {
        const prod = await this.searchArticle(mat).catch(() => null);
        if (prod) grid = extractSizeGrid(prod, 0);
      }
      if (!grid || !grid.length) {
        problems.push(mat + ': no size grid found (cart keys: [' + Object.keys(forMat || {}).join(', ') + '])');
        continue;
      }
      const byLabel = new Map();
      grid.forEach((g) => { byLabel.set(canonSize(g.label), g); byLabel.set(canonSize(g.technicalSize), g); });
      for (const [label, qty] of Object.entries(line.sizes || {})) {
        const q = Number(qty) || 0;
        if (q <= 0) continue;
        const hit = byLabel.get(canonSize(label));
        if (!hit) {
          problems.push(mat + ' size "' + label + '" (' + q + ' pcs): no match. Grid offers: '
            + grid.map((g) => g.label + '=' + g.technicalSize).join(', '));
          continue;
        }
        rows.push({ materialNumber: mat, technicalSize: hit.technicalSize, quantity: q, requestedDeliveryDate, _label: label, _available: hit.available, _futureDate: hit.futureDate });
      }
    }
    return { rows, problems };
  }

  // Fill the cart and verify by reading it back. Returns a report; never submits.
  async fillCart({ lines, poNumber, requestedDeliveryDate, cartId = null }) {
    const id = cartId || await this.currentCartId();
    const before = extractCartLines(await this.cartMaterials(id));
    await this.addMaterials(id, lines.map((l) => l.sku));
    const built = await this.buildSizeRows({ cartId: id, lines, requestedDeliveryDate });
    if (built.problems.length && !built.rows.length) {
      throw new ClickError('no size rows could be built: ' + built.problems.join(' | '), { method: 'PUT', url: '/materials/sizes' });
    }
    await this.setSizes(id, built.rows);
    if (poNumber) await this.setPersonalReference(id, poNumber);
    // Read back and diff against intent — a partial write must be reported, not assumed good.
    const after = extractCartLines(await this.cartMaterials(id));
    const intended = new Map();
    built.rows.forEach((r) => {
      const m = intended.get(r.materialNumber) || {};
      m[r.technicalSize] = (m[r.technicalSize] || 0) + r.quantity;
      intended.set(r.materialNumber, m);
    });
    const mismatches = [];
    for (const [mat, sizes] of intended) {
      const got = after.get(mat) || {};
      for (const [code, qty] of Object.entries(sizes)) {
        const had = Number((before.get(mat) || {})[code] || 0);
        const now = Number(got[code] || 0);
        if (now < qty && now - had !== qty) mismatches.push(mat + ' ' + code + ': wanted ' + qty + ', cart shows ' + now + (had ? ' (had ' + had + ' before)' : ''));
      }
    }
    return {
      cartId: id,
      poNumber: poNumber || null,
      rows: built.rows,
      unresolved: built.problems,
      mismatches,
      ok: !mismatches.length && !built.problems.length,
      cartBefore: Object.fromEntries([...before].map(([k, v]) => [k, v])),
      cartAfter: Object.fromEntries([...after].map(([k, v]) => [k, v])),
    };
  }
}

// The subtree describing one article, wherever it sits in the response.
function findNodeForMaterial(node, mat, depth = 0) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const x of node) { const hit = findNodeForMaterial(x, mat, depth + 1); if (hit) return hit; }
    return null;
  }
  if (typeof node === 'object') {
    const m = node.materialNumber ?? node.material ?? node.articleNumber;
    if (m != null && String(m) === String(mat)) return node;
    for (const v of Object.values(node)) { const hit = findNodeForMaterial(v, mat, depth + 1); if (hit) return hit; }
  }
  return null;
}

export const _internal = { canonSize, extractSizeGrid, extractCartLines, findNodeForMaterial };
