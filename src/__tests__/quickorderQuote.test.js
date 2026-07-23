/* Unit tests for the coach-facing quick-order quote function.
 *
 * Pricing is the money path: the browser never sets a price, so every dollar is
 * recomputed server-side. These drive the exported handler + helpers with a fake
 * supabase admin client (same stub style as webstoreCheckout.test.js), with
 * _shared mocked so getSupabaseAdmin never needs real credentials. */

let mockAdmin = null;
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => mockAdmin,
}));

const quote = require('../../netlify/functions/quickorder-quote');
const DECO = require('../lib/decoPricing');

// Minimal chainable supabase stub: from(table) returns a thenable whose query
// methods are no-ops; maybeSingle resolves the first canned row. auth.getUser
// resolves the canned user.
function fakeSb(tables, user) {
  return {
    auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad token' } }) },
    from(table) {
      const result = tables[table] || { data: [], error: null };
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
        ilike: () => chain, limit: () => chain,
        maybeSingle: () => Promise.resolve(result.error ? { data: null, error: result.error } : { data: (result.data || [])[0] || null, error: null }),
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  };
}

const COACH = { id: 'coach1', email: 'coach@team.com', name: 'Coach', status: 'active', customer_id: null, auth_user_id: 'auth1' };
const CUST = { id: 'cust1', name: 'Central High', adidas_ua_tier: 'A', catalog_markup: null };
const ADIDAS_TEE = { id: 'p1', sku: 'ADI-1', name: 'Adidas Tee', brand: 'Adidas', category: 'Apparel', retail_price: 40, catalog_sell_price: null, pricing_group: null, nsa_cost: 15, is_clearance: false, clearance_cost: null };
const PLAIN_TEE = { id: 'p2', sku: 'PC61', name: 'Port Tee', brand: 'Port & Company', category: 'Apparel', retail_price: 10, catalog_sell_price: null, pricing_group: null, nsa_cost: 4, is_clearance: false, clearance_cost: null };

const baseTables = (over = {}) => ({
  coach_accounts: { data: [COACH], error: null },
  coach_customer_access: { data: [{ customer_id: 'cust1' }], error: null },
  customers: { data: [CUST], error: null },
  products: { data: [ADIDAS_TEE, PLAIN_TEE], error: null },
  ...over,
});

const call = (body, { user = { id: 'auth1', email: 'coach@team.com' }, tables = baseTables(), auth = 'Bearer tok' } = {}) => {
  mockAdmin = fakeSb(tables, user);
  return quote.handler({ httpMethod: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });
};

describe('auth gating', () => {
  test('rejects a missing bearer token', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 1 }] }, { auth: null });
    expect(r.statusCode).toBe(401);
  });

  test('rejects an invalid token', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 1 }] }, { user: null });
    expect(r.statusCode).toBe(401);
  });

  test('rejects a signed-in user with no coach account', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 1 }] },
      { tables: baseTables({ coach_accounts: { data: [], error: null } }) });
    expect(r.statusCode).toBe(403);
  });

  test('rejects a disabled coach account', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 1 }] },
      { tables: baseTables({ coach_accounts: { data: [{ ...COACH, status: 'disabled' }], error: null } }) });
    expect(r.statusCode).toBe(403);
  });

  test('rejects a coach without access to the customer', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 1 }] },
      { tables: baseTables({ coach_customer_access: { data: [], error: null } }) });
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).error).toMatch(/authorized/i);
  });

  test("the coach account's own customer_id grants access without an access row", async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 1 }] },
      { tables: baseTables({ coach_accounts: { data: [{ ...COACH, customer_id: 'cust1' }], error: null }, coach_customer_access: { data: [], error: null } }) });
    expect(r.statusCode).toBe(200);
  });
});

describe('quote pricing', () => {
  test('prices an adidas item at the tier discount off retail (tier A = 40%)', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 12 }] });
    expect(r.statusCode).toBe(200);
    const q = JSON.parse(r.body).quote;
    expect(q.tier).toBe('A');
    expect(q.lines[0].unit_sell).toBe(24); // 40 × (1 − 0.40)
    expect(q.lines[0].line_total).toBe(288);
    expect(q.subtotal).toBe(288);
  });

  test('prices a non-AU item at cost × default 1.65 markup', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 10 }] });
    const q = JSON.parse(r.body).quote;
    expect(q.lines[0].unit_sell).toBe(DECO.rQ(4 * 1.65)); // 6.6 → rQ
    expect(q.subtotal).toBe(DECO.rQ(4 * 1.65) * 10);
  });

  test('catalog_sell_price wins for a non-AU item', async () => {
    const tables = baseTables({ products: { data: [{ ...PLAIN_TEE, catalog_sell_price: 18 }], error: null } });
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 2 }] }, { tables });
    expect(JSON.parse(r.body).quote.lines[0].unit_sell).toBe(18);
  });

  test('screen print decoration prices at the default tables via decoPricing.dP', async () => {
    const qty = 24;
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty, decorations: [{ type: 'screen_print', colors: 2 }] }] });
    const q = JSON.parse(r.body).quote;
    const expected = DECO.dP(DECO.DEFAULTS, { type: 'screen_print', colors: 2 }, qty).sell;
    expect(q.lines[0].decorations[0].unit_sell).toBe(Math.round(expected * 100) / 100);
    expect(q.lines[0].line_total).toBe(Math.round((q.lines[0].unit_sell + q.lines[0].decorations[0].unit_sell) * qty * 100) / 100);
  });

  test('a coach-supplied sell_override is stripped (never trusted)', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 24, decorations: [{ type: 'screen_print', colors: 2, sell_override: 0.01 }] }] });
    const q = JSON.parse(r.body).quote;
    const expected = DECO.dP(DECO.DEFAULTS, { type: 'screen_print', colors: 2 }, 24).sell;
    expect(q.lines[0].decorations[0].unit_sell).toBe(Math.round(expected * 100) / 100);
  });

  test('rejects an unknown decoration type', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 5, decorations: [{ type: 'outside_deco', sell_each: 1 }] }] });
    expect(r.statusCode).toBe(400);
  });

  test('rejects an unknown product', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'nope', qty: 1 }] });
    expect(r.statusCode).toBe(409);
  });

  test('rejects an empty line set', async () => {
    const r = await call({ customer_id: 'cust1', lines: [] });
    expect(r.statusCode).toBe(400);
  });
});

// A canonical Stage-4 decoSpec-shaped decoration (overlay + provenance + pricing
// fields) — the exact JSON the cart UI will send per line.
const SPEC = {
  art_url: 'https://cdn.example/logo.png', side: 'front', x: 24, y: 28, w: 22,
  placement: 'left_chest', logo_source: 'art_library', art_file_id: 'art1',
  type: 'screen_print', colors: 2, underbase: false,
};
const cartLine = (over = {}) => ({ product_id: 'p2', size: 'L', qty: 24, decorations: [{ ...SPEC }], ...over });
const getQuote = async (lines) => {
  const r = await call({ customer_id: 'cust1', lines });
  expect(r.statusCode).toBe(200);
  return JSON.parse(r.body).quote;
};

describe('cart line shape (Stage 5)', () => {
  test('a non-decorated retail line (decorations: []) prices garment-only', async () => {
    const q = await getQuote([{ product_id: 'p2', size: 'M', qty: 10, decorations: [] }]);
    const unit = DECO.rQ(4 * 1.65);
    expect(q.lines[0].unit_sell).toBe(unit);
    expect(q.lines[0].decorations).toEqual([]);
    expect(q.lines[0].size).toBe('M');
    expect(q.lines[0].line_total).toBe(Math.round(unit * 10 * 100) / 100);
    expect(q.subtotal).toBe(q.lines[0].line_total);
  });

  test('a mixed cart (decorated + plain) totals to the sum of its lines', async () => {
    const q = await getQuote([cartLine(), { product_id: 'p1', size: 'XL', qty: 12, decorations: [] }]);
    const unit2 = DECO.rQ(4 * 1.65);
    const deco = Math.round(DECO.dP(DECO.DEFAULTS, { type: 'screen_print', colors: 2 }, 24).sell * 100) / 100;
    expect(q.lines).toHaveLength(2);
    expect(q.lines[0].line_total).toBe(Math.round((unit2 + deco) * 24 * 100) / 100);
    expect(q.lines[1].line_total).toBe(24 * 12); // adidas tier A: 40 × 0.6 × 12
    expect(q.subtotal).toBe(Math.round((q.lines[0].line_total + q.lines[1].line_total) * 100) / 100);
  });

  test('multi-line carts keep per-line size/qty (same product, two sizes)', async () => {
    const q = await getQuote([
      { product_id: 'p2', size: 'S', qty: 3, decorations: [] },
      { product_id: 'p2', size: 'XXL', qty: 5, decorations: [] },
    ]);
    expect(q.lines.map((l) => l.size)).toEqual(['S', 'XXL']);
    expect(q.lines.map((l) => l.qty)).toEqual([3, 5]);
  });

  test('echoes placement/logo metadata on priced decorations, still stripping price fields', async () => {
    const q = await getQuote([cartLine({ decorations: [{ ...SPEC, sell_override: 0.01, unit_sell: 0.01 }] })]);
    const d = q.lines[0].decorations[0];
    expect(d).toMatchObject({
      type: 'screen_print', colors: 2, underbase: false,
      placement: 'left_chest', logo_source: 'art_library', art_file_id: 'art1',
      side: 'front', x: 24, y: 28, w: 22, art_url: SPEC.art_url,
    });
    expect(d.sell_override).toBeUndefined();
    // unit_sell is the server-priced value, never the client's
    expect(d.unit_sell).toBe(Math.round(DECO.dP(DECO.DEFAULTS, { type: 'screen_print', colors: 2 }, 24).sell * 100) / 100);
  });
});

describe('quote hash (v3)', () => {
  const hashOf = async (lines) => (await getQuote(lines)).quote_hash;

  test('response carries quote_hash + hash_version v3 (hash kept as alias)', async () => {
    const q = await getQuote([cartLine()]);
    expect(q.hash_version).toBe('v3');
    expect(q.quote_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(q.hash).toBe(q.quote_hash);
  });

  test('same cart → same hash', async () => {
    expect(await hashOf([cartLine()])).toBe(await hashOf([cartLine()]));
  });

  test.each([
    ['qty change', cartLine({ qty: 25 })],
    ['size change', cartLine({ size: 'XL' })],
    ['color-count change', cartLine({ decorations: [{ ...SPEC, colors: 3 }] })],
    ['placement x nudge', cartLine({ decorations: [{ ...SPEC, x: 25 }] })],
    ['different logo id', cartLine({ decorations: [{ ...SPEC, art_file_id: 'art2' }] })],
    ['zone change', cartLine({ decorations: [{ ...SPEC, placement: 'full_front', x: 50, y: 38, w: 68 }] })],
  ])('%s → different hash', async (_name, changed) => {
    expect(await hashOf([changed])).not.toBe(await hashOf([cartLine()]));
  });

  test('teamshop vs art_library logo references hash differently even with the same id', async () => {
    const a = await hashOf([cartLine()]);
    const b = await hashOf([cartLine({ decorations: [{ ...SPEC, art_file_id: undefined, logo_source: 'teamshop', teamshop_logo_id: 'art1' }] })]);
    expect(a).not.toBe(b);
  });

  test('normalizeAndHash is exported, deterministic, and recomputes the quote hash from the echoed lines (Stage 6 contract)', async () => {
    expect(typeof quote.normalizeAndHash).toBe('function');
    const q = await getQuote([cartLine(), { product_id: 'p1', size: 'M', qty: 6, decorations: [] }]);
    const totals = { customer_id: q.customer_id, tier: q.tier, subtotal: q.subtotal };
    const r1 = quote.normalizeAndHash(q.lines, totals);
    const r2 = quote.normalizeAndHash(JSON.parse(JSON.stringify(q.lines)), { ...totals });
    expect(r1.hash_version).toBe('v3');
    expect(r1.quote_hash).toBe(r2.quote_hash);
    expect(r1.quote_hash).toBe(q.quote_hash);
  });
});

// ── Flat deco rate card (00198) — WS2 money path ─────────────────────────────
// With teamshop_deco_rates mocked live, buildQuote must price decorations at
// the flat rate (not the dP tables), enforce per-line min_qty, and hash the
// resolved price (v3) so a staff rate edit invalidates open quotes. The public
// endpoint must price the identical number for the same deco (anon/coach parity).
const publicPrice = require('../../netlify/functions/teamshop-public-price');

const RATES = [
  { id: 'r1', family: 'embroidery', type: 'embroidery', option_key: 'standard', label: 'Embroidery', price: 8, cost: null, min_qty: 1, sort_order: 0, active: true },
  { id: 'r2', family: 'heat', type: 'dtf', option_key: 'standard', label: 'DTF Transfer', price: 6, cost: null, min_qty: 1, sort_order: 10, active: true },
  { id: 'r3', family: 'heat', type: 'vinyl', option_key: 'standard', label: 'Vinyl', price: 5, cost: null, min_qty: 1, sort_order: 20, active: true },
  { id: 'r4', family: 'heat', type: 'vinyl', option_key: 'number', label: 'Player number (vinyl)', price: 4, cost: null, min_qty: 1, sort_order: 21, active: true },
  { id: 'r5', family: 'heat', type: 'vinyl', option_key: 'name_number', label: 'Name + number (vinyl)', price: 7, cost: null, min_qty: 1, sort_order: 22, active: true },
  { id: 'r6', family: 'heat', type: 'silicone_patch', option_key: 'standard', label: 'Silicone patch', price: 9, cost: null, min_qty: 1, sort_order: 30, active: true },
  { id: 'r7', family: 'screen_print', type: 'screen_print', option_key: 'standard', label: 'Screen print', price: 5, cost: null, min_qty: 24, sort_order: 40, active: true },
];
const ratedTables = (rates = RATES, over = {}) => baseTables({ teamshop_deco_rates: { data: rates, error: null }, ...over });

describe('flat deco rate card (mocked teamshop_deco_rates)', () => {
  test('embroidery prices $8 flat regardless of stitches (stitches stay as production metadata)', async () => {
    for (const stitches of [1000, 8000, 60000]) {
      const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 6, decorations: [{ type: 'embroidery', stitches }] }] }, { tables: ratedTables() });
      expect(r.statusCode).toBe(200);
      const d = JSON.parse(r.body).quote.lines[0].decorations[0];
      expect(d.unit_sell).toBe(8);
      expect(d.stitches).toBe(stitches); // metadata flows through, unpriced
      expect(d.option).toBe('standard');
    }
  });

  test('vinyl name_number prices at its own $7 option rate', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 12, decorations: [{ type: 'vinyl', option: 'name_number' }] }] }, { tables: ratedTables() });
    expect(r.statusCode).toBe(200);
    const d = JSON.parse(r.body).quote.lines[0].decorations[0];
    expect(d).toMatchObject({ type: 'vinyl', option: 'name_number', unit_sell: 7 });
  });

  test('an un-whitelisted option falls back to the standard rate, never a client-picked one', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 12, decorations: [{ type: 'vinyl', option: 'free' }] }] }, { tables: ratedTables() });
    const d = JSON.parse(r.body).quote.lines[0].decorations[0];
    expect(d).toMatchObject({ type: 'vinyl', option: 'standard', unit_sell: 5 });
  });

  test('screen print under its 24-piece minimum → per-line MIN_QTY error, no quote', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 10, decorations: [{ type: 'screen_print', colors: 2 }] }] }, { tables: ratedTables() });
    expect(r.statusCode).toBe(422);
    const body = JSON.parse(r.body);
    expect(body.error).toBe('Screen print requires 24+ pieces');
    expect(body.code).toBe('MIN_QTY');
    expect(body.min).toBe(24);
  });

  test('screen print at 24+ prices at the flat rate; colors stay as metadata', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 24, decorations: [{ type: 'screen_print', colors: 4 }] }] }, { tables: ratedTables() });
    expect(r.statusCode).toBe(200);
    const d = JSON.parse(r.body).quote.lines[0].decorations[0];
    expect(d.unit_sell).toBe(5);
    expect(d.colors).toBe(4);
  });

  test('hash v3 flips when a rate price changes (staff edit invalidates open quotes)', async () => {
    const line = { product_id: 'p2', qty: 6, decorations: [{ type: 'embroidery', stitches: 8000 }] };
    const at = async (price) => {
      const rates = RATES.map((x) => (x.type === 'embroidery' ? { ...x, price } : x));
      const r = await call({ customer_id: 'cust1', lines: [line] }, { tables: ratedTables(rates) });
      expect(r.statusCode).toBe(200);
      return JSON.parse(r.body).quote.quote_hash;
    };
    expect(await at(8)).not.toBe(await at(9));
    expect(await at(8)).toBe(await at(8)); // deterministic at a fixed rate
  });

  test('public vs coach endpoint deco parity: same mocked rates → same unit_deco', async () => {
    const lines = [{ product_id: 'p2', qty: 12, decorations: [{ type: 'vinyl', option: 'name_number' }, { type: 'dtf' }] }];
    const coachRes = await call({ customer_id: 'cust1', lines }, { tables: ratedTables() });
    expect(coachRes.statusCode).toBe(200);
    const coachLine = JSON.parse(coachRes.body).quote.lines[0];
    const coachUnitDeco = Math.round(coachLine.decorations.reduce((s, d) => s + d.unit_sell, 0) * 100) / 100;

    mockAdmin = fakeSb(ratedTables(), null);
    const pubRes = await publicPrice.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ lines }) });
    expect(pubRes.statusCode).toBe(200);
    const pubLine = JSON.parse(pubRes.body).lines[0];

    expect(coachUnitDeco).toBe(13); // 7 (vinyl name_number) + 6 (dtf)
    expect(pubLine.unit_deco).toBe(coachUnitDeco);
  });

  test('the public endpoint surfaces the same MIN_QTY line error the coach path gets', async () => {
    mockAdmin = fakeSb(ratedTables(), null);
    const r = await publicPrice.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ lines: [{ product_id: 'p2', qty: 10, decorations: [{ type: 'screen_print', colors: 1 }] }] }) });
    expect(r.statusCode).toBe(422);
    expect(JSON.parse(r.body).error).toBe('Screen print requires 24+ pieces');
  });

  test('fallback: with no rates table, legacy types still price via dP and new heat kinds are rejected', async () => {
    const qty = 24;
    const ok = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty, decorations: [{ type: 'dtf', dtf_size: 0 }] }] });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).quote.lines[0].decorations[0].unit_sell)
      .toBe(Math.round(DECO.dP(DECO.DEFAULTS, { type: 'dtf', dtf_size: 0 }, qty).sell * 100) / 100);
    const rej = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty, decorations: [{ type: 'silicone_patch' }] }] });
    expect(rej.statusCode).toBe(409);
  });
});

describe('delivery-timeline estimates on the coach quote (00203)', () => {
  const TL_ROWS = [
    { rule_key: 'source_sanmar_ss', rule_type: 'source', inventory_sources: ['sanmar'], deco_type: null, min_weeks: 1.5, max_weeks: 2, label: '~1.5–2 weeks', sort_order: 10, active: true },
  ];
  const SANMAR_TEE = { ...PLAIN_TEE, inventory_source: 'sanmar' };

  beforeEach(() => require('../../netlify/functions/_teamshopTimeline')._clearCache());

  test('quote lines + quote carry the server-resolved timeline when 00203 is live', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', size: 'M', qty: 2 }] }, {
      tables: baseTables({
        products: { data: [SANMAR_TEE], error: null },
        teamshop_delivery_timelines: { data: TL_ROWS, error: null },
        product_inventory: { data: [], error: null },
      }),
    });
    const json = JSON.parse(r.body);
    expect(json.ok).toBe(true);
    expect(json.quote.lines[0].timeline).toEqual({ min_weeks: 1.5, max_weeks: 2, label: '~1.5–2 weeks' });
    expect(json.quote.timeline).toEqual({ min_weeks: 1.5, max_weeks: 2, label: '~1.5–2 weeks' });
  });

  test('the timeline is NOT a hash input — the same cart hashes identically with and without 00203', async () => {
    const body = { customer_id: 'cust1', lines: [{ product_id: 'p2', size: 'M', qty: 2 }] };
    const withTl = JSON.parse((await call(body, {
      tables: baseTables({
        products: { data: [SANMAR_TEE], error: null },
        teamshop_delivery_timelines: { data: TL_ROWS, error: null },
        product_inventory: { data: [], error: null },
      }),
    })).body);
    require('../../netlify/functions/_teamshopTimeline')._clearCache();
    const withoutTl = JSON.parse((await call(body, {
      tables: baseTables({ products: { data: [SANMAR_TEE], error: null } }),
    })).body);
    expect(withTl.quote.timeline).not.toBeNull();
    expect(withoutTl.quote.timeline).toBeNull();
    expect(withTl.quote.quote_hash).toBe(withoutTl.quote.quote_hash);
  });
});
