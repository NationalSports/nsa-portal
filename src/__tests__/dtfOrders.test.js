/* DTF transfer order lane (00235) — netlify/functions/dtf-orders.js +
 * netlify/functions/_dtfLayout.js.
 *
 * Coverage targets the load-bearing claims:
 *   * gang-sheet packing: every placement inside the usable width, no two
 *     placements overlap, count = sum(qty), tall prints rotate, prints too
 *     wide in BOTH orientations land in `unplaced` (never silently dropped);
 *   * submission validation (https-only artwork URL, sane dims/qty);
 *   * vendor auth: closed (503) with no token env, 401 on mismatch — the
 *     supplier endpoint must fail closed;
 *   * supplier email HTML escapes user-entered text;
 *   * send path refuses when no supplier email is configured;
 *   * vendor mark-shipped is a compare-and-set (already-shipped → 409). */

const { packGangSheet } = require('../../netlify/functions/_dtfLayout');
const dtf = require('../../netlify/functions/dtf-orders');

// Minimal chainable supabase fake: every chain method returns the builder;
// awaiting it (or .maybeSingle()) resolves the scripted result.
const fakeTable = (result) => {
  const b = {};
  ['select', 'update', 'insert', 'upsert', 'eq', 'neq', 'in', 'is', 'order', 'limit'].forEach((m) => { b[m] = () => b; });
  b.maybeSingle = () => Promise.resolve(result);
  b.then = (res, rej) => Promise.resolve(result).then(res, rej);
  return b;
};
const fakeAdmin = (byTable) => ({ from: (t) => fakeTable(byTable[t] || { data: null, error: null }) });

// ── Gang-sheet packing ───────────────────────────────────────────────
describe('packGangSheet', () => {
  const OPTS = { sheetWidthIn: 22, marginIn: 0.25, spacingIn: 0.5 };

  test('places every copy inside the usable width with no overlaps', () => {
    const out = packGangSheet([
      { id: 'a', width_in: 4, height_in: 4, qty: 10 },
      { id: 'b', width_in: 10, height_in: 3, qty: 4 },
      { id: 'c', width_in: 2.5, height_in: 2.5, qty: 25 },
    ], OPTS);
    expect(out.total_prints).toBe(39);
    expect(out.unplaced).toHaveLength(0);
    for (const p of out.placements) {
      expect(p.x).toBeGreaterThanOrEqual(0.25);
      expect(p.x + p.w).toBeLessThanOrEqual(22 - 0.25 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(0.25);
    }
    // No pairwise overlap.
    for (let i = 0; i < out.placements.length; i++) {
      for (let j = i + 1; j < out.placements.length; j++) {
        const a = out.placements[i]; const b = out.placements[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
    expect(out.sheet_length_in).toBeGreaterThan(0);
  });

  test('rotates tall-narrow prints to lie down (shorter sheet)', () => {
    const out = packGangSheet([{ id: 't', width_in: 3, height_in: 12, qty: 2 }], OPTS);
    expect(out.placements).toHaveLength(2);
    expect(out.placements[0].rotated).toBe(true);
    expect(out.placements[0].w).toBe(12);
    expect(out.placements[0].h).toBe(3);
  });

  test('rotates when only the rotated orientation fits the roll', () => {
    const out = packGangSheet([{ id: 'wide', width_in: 30, height_in: 10, qty: 1 }], OPTS);
    expect(out.unplaced).toHaveLength(0);
    expect(out.placements[0].rotated).toBe(true);
  });

  test('a print too wide in both orientations is reported, never dropped', () => {
    const out = packGangSheet([
      { id: 'huge', width_in: 30, height_in: 25, qty: 3 },
      { id: 'ok', width_in: 4, height_in: 4, qty: 1 },
    ], OPTS);
    expect(out.total_prints).toBe(1);
    expect(out.unplaced).toHaveLength(1);
    expect(out.unplaced[0]).toMatchObject({ request_id: 'huge', qty: 3, reason: 'wider_than_sheet' });
  });

  test('zero/invalid qty and dimensions are skipped without throwing', () => {
    const out = packGangSheet([
      { id: 'z', width_in: 4, height_in: 4, qty: 0 },
      { id: 'n', width_in: 0, height_in: 4, qty: 5 },
    ], OPTS);
    expect(out.total_prints).toBe(0);
    expect(out.sheet_length_in).toBe(0);
  });
});

// ── Submission validation ────────────────────────────────────────────
describe('validateRequestPatch', () => {
  const good = { design_name: ' Eagles Crest ', file_url: 'https://res.cloudinary.com/x/a.png', width_in: 10.333, height_in: 4, qty: '25', outline: true, notes: 'left chest' };

  test('accepts a good submission, trims and rounds', () => {
    const { patch, errors } = dtf.validateRequestPatch(good, { partial: false });
    expect(errors).toHaveLength(0);
    expect(patch.design_name).toBe('Eagles Crest');
    expect(patch.width_in).toBe(10.33);
    expect(patch.qty).toBe(25);
    expect(patch.outline).toBe(true);
  });

  test('rejects http (non-https) artwork URLs and missing name', () => {
    const { errors } = dtf.validateRequestPatch({ ...good, design_name: '', file_url: 'http://evil/a.png' }, { partial: false });
    expect(errors.join(' ')).toMatch(/design_name required/);
    expect(errors.join(' ')).toMatch(/https/);
  });

  test('rejects absurd dims and qty', () => {
    const { errors } = dtf.validateRequestPatch({ ...good, width_in: 500, qty: 99999 }, { partial: false });
    expect(errors.join(' ')).toMatch(/width_in/);
    expect(errors.join(' ')).toMatch(/qty/);
  });

  test('partial mode only validates provided fields', () => {
    const { patch, errors } = dtf.validateRequestPatch({ qty: 3 }, { partial: true });
    expect(errors).toHaveLength(0);
    expect(patch).toEqual({ qty: 3 });
  });
});

// ── Vendor auth (fail closed) ────────────────────────────────────────
describe('checkVendorAuth', () => {
  const OLD = process.env.VENDOR_DTF_TOKEN;
  afterEach(() => { if (OLD === undefined) delete process.env.VENDOR_DTF_TOKEN; else process.env.VENDOR_DTF_TOKEN = OLD; });

  test('503 (closed) when the env token is unset', () => {
    delete process.env.VENDOR_DTF_TOKEN;
    expect(dtf.checkVendorAuth({ headers: { 'x-vendor-token': 'anything' } })).toMatchObject({ ok: false, status: 503 });
  });

  test('401 on mismatch, ok on match (header or query param)', () => {
    process.env.VENDOR_DTF_TOKEN = 'sekret';
    expect(dtf.checkVendorAuth({ headers: { 'x-vendor-token': 'wrong' } })).toMatchObject({ ok: false, status: 401 });
    expect(dtf.checkVendorAuth({ headers: { 'x-vendor-token': 'sekret' } })).toMatchObject({ ok: true });
    expect(dtf.checkVendorAuth({ headers: {}, queryStringParameters: { token: 'sekret' } })).toMatchObject({ ok: true });
  });
});

// ── Supplier email ───────────────────────────────────────────────────
describe('buildBatchEmailHtml', () => {
  test('escapes user-entered text and includes specs + artwork link', () => {
    const html = dtf.buildBatchEmailHtml(
      { batch_number: 'DTF-260729', total_prints: 12, sheet_width_in: 22, sheet_length_in: 40 },
      [{ design_name: '<script>alert(1)</script>', file_url: 'https://x/a.png', file_name: 'a.png', width_in: 10, height_in: 4, qty: 12, outline: true, notes: 'b<b>old' }],
      {},
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('b&lt;b&gt;old');
    expect(html).toContain('https://x/a.png');
    expect(html).toContain('YES'); // outline column
    expect(html).toContain('DTF-260729');
  });
});

describe('batchNumberFor', () => {
  test('date-keyed with collision suffix', () => {
    expect(dtf.batchNumberFor(new Date('2026-07-29T16:00:00Z'), 1)).toBe('DTF-260729');
    expect(dtf.batchNumberFor(new Date('2026-07-29T16:00:00Z'), 2)).toBe('DTF-260729-2');
  });
});

describe('trackingUrl', () => {
  test('maps known carriers and URL-encodes the number', () => {
    expect(dtf.trackingUrl('UPS Ground', '1Z999')).toContain('ups.com');
    expect(dtf.trackingUrl('FedEx', 'F1')).toContain('fedex.com');
    expect(dtf.trackingUrl('usps', '94001')).toContain('usps.com');
    expect(dtf.trackingUrl('Other', 'AB CD')).toContain('AB%20CD');
  });
});

// ── Send / ship guard rails ──────────────────────────────────────────
describe('sendBatch', () => {
  test('refuses when no supplier email is configured (batch stays draft)', async () => {
    const admin = fakeAdmin({ dtf_settings: { data: { id: 1, supplier_email: '' }, error: null } });
    const r = await dtf.sendBatch(admin, 'batch-1', 'staff');
    expect(r).toMatchObject({ sent: false, reason: 'no_supplier_email' });
  });
});

describe('vendorMarkShipped', () => {
  test('requires a tracking number before touching the batch', async () => {
    const res = await dtf.vendorMarkShipped({}, { batch_id: 'b1', carrier: 'UPS', tracking_number: '' });
    expect(res.statusCode).toBe(400);
  });

  test('compare-and-set: an already-shipped batch is a clean 409, not a re-mark', async () => {
    const admin = fakeAdmin({ dtf_batches: { data: null, error: null } });
    const res = await dtf.vendorMarkShipped(admin, { batch_id: 'b1', carrier: 'UPS', tracking_number: '1Z1' });
    expect(res.statusCode).toBe(409);
  });
});
