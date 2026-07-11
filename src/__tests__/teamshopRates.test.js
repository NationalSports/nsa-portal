/* Team Shop flat deco rate card (netlify/functions/_teamshopRates.js) — the
 * money path for storefront decoration pricing. Covers loadRates' transitional
 * fallback contract (null when the 00194 table is missing/unreadable/empty so
 * callers fall back to decoPricing.dP), rateFor/flatDecoSell for every seed
 * type + option, and min_qty enforcement (screen print 24+). */

let mockAdmin = null;
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => mockAdmin,
}));

const { loadRates, rateFor, flatDecoSell } = require('../../netlify/functions/_teamshopRates');
const priceFn = require('../../netlify/functions/teamshop-public-price');
const DECO = require('../lib/decoPricing');

// The 00194 seed rows, verbatim (family/type/option_key/label/price/min_qty).
const SEED = [
  { id: 'r1', family: 'embroidery', type: 'embroidery', option_key: 'standard', label: 'Embroidery', price: 8, cost: null, min_qty: 1, sort_order: 0, active: true },
  { id: 'r2', family: 'heat', type: 'dtf', option_key: 'standard', label: 'DTF Transfer', price: 6, cost: null, min_qty: 1, sort_order: 10, active: true },
  { id: 'r3', family: 'heat', type: 'vinyl', option_key: 'standard', label: 'Vinyl', price: 5, cost: null, min_qty: 1, sort_order: 20, active: true },
  { id: 'r4', family: 'heat', type: 'vinyl', option_key: 'number', label: 'Player number (vinyl)', price: 4, cost: null, min_qty: 1, sort_order: 21, active: true },
  { id: 'r5', family: 'heat', type: 'vinyl', option_key: 'name_number', label: 'Name + number (vinyl)', price: 7, cost: null, min_qty: 1, sort_order: 22, active: true },
  { id: 'r6', family: 'heat', type: 'silicone_patch', option_key: 'standard', label: 'Silicone patch', price: 9, cost: null, min_qty: 1, sort_order: 30, active: true },
  { id: 'r7', family: 'screen_print', type: 'screen_print', option_key: 'standard', label: 'Screen print', price: 5, cost: null, min_qty: 24, sort_order: 40, active: true },
];

const fakeAdmin = (result) => ({
  from: () => {
    const chain = {
      select: () => chain, eq: () => chain,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  },
});

let warnSpy;
beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warnSpy.mockRestore(); });

describe('loadRates — transitional fallback contract', () => {
  test('returns the active rows when the table is live', async () => {
    expect(await loadRates(fakeAdmin({ data: SEED, error: null }))).toEqual(SEED);
  });

  test('query error (00194 not applied) → null + a warn, never a throw', async () => {
    const rates = await loadRates(fakeAdmin({ data: null, error: { message: 'relation "teamshop_deco_rates" does not exist' } }));
    expect(rates).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  test('zero active rows → null (unprovisioned table falls back too)', async () => {
    expect(await loadRates(fakeAdmin({ data: [], error: null }))).toBeNull();
  });

  test('a thrown client error → null, not an unhandled rejection', async () => {
    const admin = { from: () => { throw new Error('boom'); } };
    expect(await loadRates(admin)).toBeNull();
  });
});

describe('rateFor', () => {
  test('matches type + option, defaulting the option to standard', () => {
    expect(rateFor(SEED, { type: 'dtf' }).label).toBe('DTF Transfer');
    expect(rateFor(SEED, { type: 'vinyl', option: 'number' }).price).toBe(4);
    expect(rateFor(SEED, { type: 'vinyl', option: 'standard' }).price).toBe(5);
  });
  test('null for unknown type/option or null rates', () => {
    expect(rateFor(SEED, { type: 'laser' })).toBeNull();
    expect(rateFor(SEED, { type: 'embroidery', option: 'number' })).toBeNull();
    expect(rateFor(null, { type: 'dtf' })).toBeNull();
  });
});

describe('flatDecoSell — every seed type/option prices at its flat rate', () => {
  test.each([
    [{ type: 'embroidery', option: 'standard' }, 8, 'Embroidery'],
    [{ type: 'dtf', option: 'standard' }, 6, 'DTF Transfer'],
    [{ type: 'vinyl', option: 'standard' }, 5, 'Vinyl'],
    [{ type: 'vinyl', option: 'number' }, 4, 'Player number (vinyl)'],
    [{ type: 'vinyl', option: 'name_number' }, 7, 'Name + number (vinyl)'],
    [{ type: 'silicone_patch', option: 'standard' }, 9, 'Silicone patch'],
    [{ type: 'screen_print', option: 'standard' }, 5, 'Screen print'],
  ])('%j → $%d flat', (deco, price, label) => {
    const r = flatDecoSell(SEED, deco, 24);
    expect(r.error).toBeUndefined();
    expect(r.sell).toBe(price);
    expect(r.rate.label).toBe(label);
  });

  test('the flat rate ignores stitches/dtf_size/colors — production metadata only', () => {
    expect(flatDecoSell(SEED, { type: 'embroidery', option: 'standard', stitches: 999999 }, 6).sell).toBe(8);
    expect(flatDecoSell(SEED, { type: 'dtf', option: 'standard', dtf_size: 1 }, 1).sell).toBe(6);
  });

  test('min_qty: screen print under 24 pieces → MIN_QTY error with the min + label', () => {
    expect(flatDecoSell(SEED, { type: 'screen_print', option: 'standard' }, 23))
      .toEqual({ error: 'MIN_QTY', min: 24, label: 'Screen print' });
    expect(flatDecoSell(SEED, { type: 'screen_print', option: 'standard' }, 24).sell).toBe(5);
  });

  test('no matching active rate → NO_RATE (callers must reject, never price $0)', () => {
    expect(flatDecoSell(SEED, { type: 'embroidery', option: 'name_number' }, 10)).toEqual({ error: 'NO_RATE' });
    expect(flatDecoSell(SEED, { type: 'laser' }, 10)).toEqual({ error: 'NO_RATE' });
  });
});

describe('fallback-to-dP path when loadRates nulls (pre-00194 deploys)', () => {
  // Drive the REAL caller: teamshop-public-price with no rates table mocked —
  // loadRates → null → the endpoint must price via decoPricing.dP exactly as
  // it did before the rate card existed.
  const TEE = { id: 'p2', sku: 'PC61', name: 'Port Tee', brand: 'Port & Company', category: 'Apparel', retail_price: 10, catalog_sell_price: null, pricing_group: null, nsa_cost: 4, is_clearance: false, clearance_cost: null };
  const fakeSb = (tables) => ({
    from(table) {
      const result = tables[table] || { data: [], error: null };
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, limit: () => chain,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  });
  const call = (lines, tables = {}) => {
    mockAdmin = fakeSb({ products: { data: [TEE], error: null }, ...tables });
    return priceFn.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ lines }) });
  };

  test('legacy types price at the dP tables when the rate card is unavailable', async () => {
    const qty = 24;
    const r = await call([{ product_id: 'p2', qty, decorations: [{ type: 'embroidery', stitches: 8000 }] }]);
    expect(r.statusCode).toBe(200);
    const json = JSON.parse(r.body);
    const expected = Math.round(DECO.dP(DECO.DEFAULTS, { type: 'embroidery', stitches: 8000 }, qty).sell * 100) / 100;
    expect(json.lines[0].unit_deco).toBe(expected);
  });

  test('the new heat kinds are rejected in fallback mode — never priced $0', async () => {
    for (const type of ['vinyl', 'silicone_patch']) {
      const r = await call([{ product_id: 'p2', qty: 12, decorations: [{ type }] }]);
      expect(r.statusCode).toBe(409);
      expect(JSON.parse(r.body).error).toMatch(/isn.t available/i);
    }
  });

  test('with the rate card mocked live, the same request prices at the flat rate instead', async () => {
    const r = await call(
      [{ product_id: 'p2', qty: 12, decorations: [{ type: 'vinyl', option: 'name_number' }] }],
      { teamshop_deco_rates: { data: SEED, error: null } },
    );
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).lines[0].unit_deco).toBe(7);
  });
});
