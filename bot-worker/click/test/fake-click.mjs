// Minimal stand-in for the CLICK cart API, built to the contract the Phase 1 capture recorded
// (PO 57073 SFVB). It exists so click-client.mjs can be tested without touching the real portal:
// it enforces the same shapes and records what it received, so the test can assert that all sizes
// arrive in ONE request rather than one per size.
//
// Deliberately NOT a general adidas emulator — it implements the five calls the client makes, plus
// a /submit route that must never be hit (the test asserts that too).
//
//   node click/test/fake-click.mjs [port]

import { createServer } from 'node:http';

const PORT = Number(process.argv[2] || 4711);
const ACCOUNT = '0000270384';
const CART_ID = '26182980';

// Article grid mirroring the captured run: technical codes with label sizes, one unavailable size
// and one future-dated, so availability handling can be exercised.
const GRID = {
  KA3126: [
    { technicalSize: '210', size: 'S', available: true, quantity: 0 },
    { technicalSize: '230', size: 'M', available: true, quantity: 0 },
    { technicalSize: '250', size: 'L', available: true, quantity: 0 },
    { technicalSize: '270', size: 'XL', available: true, quantity: 0 },
    { technicalSize: '290', size: '2XL', available: false, quantity: 0 },
    { technicalSize: '310', size: '3XL', available: true, futureDate: '2026-10-01', quantity: 0 },
  ],
  IN6148: [
    { technicalSize: '230', size: 'M', available: true, quantity: 0 },
    { technicalSize: '250', size: 'L', available: true, quantity: 0 },
  ],
};

export const state = {
  cart: { id: CART_ID, personalReference: null, materials: [] },
  calls: [],
  submitted: false,
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const lineFor = (mat) => state.cart.materials.find((m) => m.materialNumber === mat);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  let body = null;
  if (req.method !== 'GET') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  }
  state.calls.push({ method: req.method, path: p, body: body ? clone(body) : null });
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(obj === undefined ? '' : JSON.stringify(obj));
  };

  // Anything that would place an order. The client must never call this.
  if (/submit|checkout|placeOrder/i.test(p)) { state.submitted = true; return send(200, { ok: true }); }

  if (req.method === 'GET' && p === `/service/cart/${ACCOUNT}/storefronts/1/cart`) {
    return send(200, { cart: { cartId: CART_ID, storefrontId: 1 } });
  }

  if (req.method === 'GET' && p === `/service/cart/${ACCOUNT}/cart/${CART_ID}/materials`) {
    return send(200, {
      materials: state.cart.materials.map((m) => ({
        materialNumber: m.materialNumber,
        context: 'default',
        sizes: (GRID[m.materialNumber] || []).map((g) => ({
          ...g, quantity: m.sizes[g.technicalSize] || 0,
        })),
      })),
    });
  }

  if (req.method === 'POST' && p === `/service/cart/${ACCOUNT}/cart/${CART_ID}/materials/add`) {
    if (!Array.isArray(body)) return send(400, { error: 'expected an array' });
    for (const row of body) {
      if (!row?.materialNumber) return send(400, { error: 'materialNumber required' });
      if (!GRID[row.materialNumber]) return send(422, { error: 'unknown article ' + row.materialNumber });
      if (!lineFor(row.materialNumber)) state.cart.materials.push({ materialNumber: row.materialNumber, sizes: {} });
    }
    return send(200, { added: body.length });
  }

  if (req.method === 'PUT' && p === `/service/cart/${ACCOUNT}/cart/${CART_ID}/materials/sizes`) {
    if (!Array.isArray(body)) return send(400, { error: 'expected an array' });
    for (const row of body) {
      const line = lineFor(row?.materialNumber);
      if (!line) return send(422, { error: 'article not in cart: ' + row?.materialNumber });
      const g = (GRID[row.materialNumber] || []).find((x) => x.technicalSize === String(row.technicalSize));
      if (!g) return send(422, { error: 'unknown technicalSize ' + row?.technicalSize + ' for ' + row?.materialNumber });
      if (g.available === false) return send(422, { error: 'size not available: ' + g.size });
      if (!row.requestedDeliveryDate) return send(422, { error: 'requestedDeliveryDate required' });
      line.sizes[g.technicalSize] = Number(row.quantity) || 0;
    }
    return send(200, { updated: body.length });
  }

  if (req.method === 'PATCH' && p === `/service/cart/${ACCOUNT}/cart/${CART_ID}`) {
    state.cart.personalReference = body?.personalReference ?? null;
    return send(204);
  }

  if (req.method === 'POST' && /\/service\/catalog\/products\/.*\/adidas\/reorder$/.test(p)) {
    const want = body?.articleNumbers?.[0] || body?.searchTerm;
    const grid = GRID[want];
    if (!grid) return send(200, { products: [] });
    return send(200, { products: [{ materialNumber: want, sizes: grid.map((g) => ({ ...g, quantity: 0 })) }] });
  }

  return send(404, { error: 'no route ' + req.method + ' ' + p });
});

server.listen(PORT, () => console.log('[fake-click] listening on http://127.0.0.1:' + PORT));

export const stop = () => server.close();
export const ids = { ACCOUNT, CART_ID, PORT };
