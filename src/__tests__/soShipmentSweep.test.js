/* The automatic coach shipping notice: which boxes count, when the sweep
 * decides an order is ready to announce, and the guards that keep it from
 * emailing the wrong thing or the same thing twice.
 *
 * Shipment records here are copied from the shapes src/App.js actually writes
 * (Ready-to-Ship modal, pull modal, Awaiting Pickup label, Clear Shipment,
 * + Add Shipment), so the rules are tested against the real data, not a guess. */

const NOW = new Date('2026-09-23T20:00:00Z').getTime();
const MIN_AGE = 15 * 60000;
const MAX_AGE = 30 * 86400000;
const GO_LIVE = new Date('2026-09-22T00:00:00Z').getTime();
const base = { now: NOW, minAgeMs: MIN_AGE, maxAgeMs: MAX_AGE, sinceMs: GO_LIVE };

// Locale strings, the way sales_orders actually stores shipment dates.
const ago = (ms) => new Date(NOW - ms).toLocaleString('en-US');

// Ready-to-Ship modal (App.js ~21857): no shipment_scope, items {sku,name,color,sizes}.
const shipModalBox = (over = {}) => ({
  id: 'SHP-1', tracking_number: '1Z999AA10123456784', carrier: 'ups', ship_date: new Date(NOW - 3600000).toLocaleDateString('en-US'),
  tracking_url: 'https://www.ups.com/track?tracknum=1Z999AA10123456784', label_url: null, shipstation_shipment_id: null, shipping_cost: 0, weight: 5,
  items: [{ sku: 'AD-TI4287', name: 'Team Issue Pullover Hoodie', color: 'Navy / White', sizes: { S: 6, M: 12 } }],
  notes: '', created_by: 'wh-1', created_at: ago(60 * 60000), ...over,
});
// Pull modal with label bought in the modal (App.js ~20402).
const pullModalBox = (over = {}) => ({
  ...shipModalBox({ id: 'SHP-P', shipment_scope: 'customer_fulfillment', fulfillment: true, dimensions: { length: 12, width: 12, height: 8 }, ship_to: null }), ...over,
});
// Clear Shipment modal (App.js ~21982): rep/customer pickup, memo, never a label.
const clearedBox = (over = {}) => ({
  id: 'SHP-C1', tracking_number: '', carrier: '', ship_date: new Date(NOW - 3600000).toLocaleDateString('en-US'), tracking_url: '', label_url: null,
  shipstation_shipment_id: null, shipping_cost: 0, items: [{ sku: 'RCH-112', name: '112 Trucker Cap', color: 'Navy', sizes: { OSFA: 24 } }],
  notes: 'Picked up by rep', cleared: true, clear_memo: 'Picked up by rep', carrier_picked_up: true, pickup_date: ago(3600000),
  created_by: 'wh-1', created_at: ago(60 * 60000), ...over,
});
// + Add Shipment on the Tracking tab (OrderEditor ~7688) with only a cost.
const costOnlyBox = (over = {}) => ({
  id: 'SHP-M', tracking_number: '', carrier: '', ship_date: new Date(NOW - 3600000).toLocaleDateString('en-US'), tracking_url: '', items: [], shipping_cost: 22.5,
  notes: 'Added manually from the order', created_by: 'tm-1', created_at: ago(60 * 60000), manual: true, ...over,
});
const decoBox = () => pullModalBox({ id: 'SHP-D', shipment_scope: 'deco_transfer', fulfillment: false, tracking_number: '1Z000DECO' });

// _shared pulls in the Supabase SDK; the sweep's decisions need none of it.
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => { throw new Error('getSupabaseAdmin is not used in these tests'); },
  verifyUser: async () => ({ ok: false, status: 401, error: 'unused' }),
}));

// The sweep must send through the ONE shared path. Record its calls; the
// send itself is covered by soShipmentNotify.test.js. Plain function, not
// jest.fn (this project's Jest config resets mock implementations).
const mockSends = [];
jest.mock('../../netlify/functions/so-shipment-notify', () => {
  const actual = jest.requireActual('../../netlify/functions/so-shipment-notify');
  return {
    ...actual,
    sendShipmentNotice: async (admin, opts) => {
      mockSends.push(opts);
      return { status: 200, payload: { ok: true, to: 'coach@bolsa.org', boxes: (opts.shipmentIds || []).length } };
    },
  };
});

const { shipmentNoticePlan, classifyBoxes, goLiveDate, runSweep } = require('../../netlify/functions/so-shipment-notify-sweep');

beforeEach(() => { mockSends.length = 0; });

describe('which boxes count', () => {
  test('a tracked customer box is announceable, whichever modal wrote it', () => {
    const c = classifyBoxes([shipModalBox(), pullModalBox()]);
    expect(c.announceable.map((b) => b.id)).toEqual(['SHP-1', 'SHP-P']);
    expect(c.blocking).toHaveLength(0);
  });

  test('a confirmed box still waiting for its label blocks the order', () => {
    const c = classifyBoxes([shipModalBox({ tracking_number: '' })]);
    expect(c.blocking).toHaveLength(1);
  });

  test('a whitespace-only tracking number is not tracking', () => {
    expect(classifyBoxes([shipModalBox({ tracking_number: '   ' })]).blocking).toHaveLength(1);
  });

  test('boxes that will never have tracking neither block nor get announced', () => {
    const c = classifyBoxes([
      clearedBox(),                                                   // rep / customer pickup by memo
      shipModalBox({ id: 'SHP-R', tracking_number: '', carrier: 'rep_delivery' }),
      shipModalBox({ id: 'SHP-K', tracking_number: '', carrier: 'courier' }),
      costOnlyBox(),                                                  // a cost line, not a box
      decoBox(),                                                      // decorator transfer
    ]);
    expect(c.announceable).toHaveLength(0);
    expect(c.blocking).toHaveLength(0);
    expect(c.ignored).toHaveLength(5);
  });
});

describe('when an order is ready to announce', () => {
  const ledgerReady = [{ shipment_sig: 'SHP-1', first_tracked_at: new Date(NOW - 20 * 60000).toISOString(), sent_at: null }];

  test('first sighting of a fully tracked order starts the grace window, it does not send', () => {
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [shipModalBox()] }, base))
      .toMatchObject({ action: 'start_grace', shipmentIds: ['SHP-1'] });
  });

  test('sends once the grace window measured from the FIRST tracked sighting has passed', () => {
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [shipModalBox()] }, { ...base, ledgerRows: ledgerReady }))
      .toMatchObject({ action: 'send', reason: 'ready', shipmentIds: ['SHP-1'] });
  });

  test('still inside the grace window → wait', () => {
    const fresh = [{ shipment_sig: 'SHP-1', first_tracked_at: new Date(NOW - 5 * 60000).toISOString(), sent_at: null }];
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [shipModalBox()] }, { ...base, ledgerRows: fresh }))
      .toMatchObject({ action: 'skip', reason: 'inside_grace_window' });
  });

  test('the label bought DAYS after the box was confirmed still goes out — the clock is tracking, not the box', () => {
    // Box confirmed 5 days ago from Ready to Ship; label just bought on Awaiting Pickup
    // (that path updates tracking_number but not created_at/ship_date).
    const lateLabel = shipModalBox({ created_at: ago(5 * 86400000), ship_date: new Date(NOW - 5 * 86400000).toLocaleDateString('en-US') });
    const sinceBefore = { ...base, sinceMs: NOW - 10 * 86400000 };
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [lateLabel] }, sinceBefore)).toMatchObject({ action: 'start_grace' });
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [lateLabel] }, { ...sinceBefore, ledgerRows: ledgerReady })).toMatchObject({ action: 'send' });
  });

  test('holds the whole order while any box is still waiting on a label', () => {
    const plan = shipmentNoticePlan({ id: 'SO-1', _shipments: [shipModalBox(), shipModalBox({ id: 'SHP-2', tracking_number: '' })] }, base);
    expect(plan).toMatchObject({ action: 'skip', reason: 'waiting_on_tracking', untracked: 1 });
  });

  test('a rep-pickup box alongside a UPS box does not hold the UPS box back', () => {
    const plan = shipmentNoticePlan({ id: 'SO-1', _shipments: [shipModalBox(), clearedBox()] }, base);
    expect(plan).toMatchObject({ action: 'start_grace', shipmentIds: ['SHP-1'] });
  });

  test('never announces a box created before the go-live date — this is what keeps the first armed run quiet', () => {
    const old = shipModalBox({ created_at: new Date(GO_LIVE - 3600000).toLocaleString('en-US') });
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [old] }, base)).toMatchObject({ action: 'skip', reason: 'before_go_live' });
  });

  test('a box past the safety cap is left to the rep', () => {
    const stale = shipModalBox({ created_at: ago(40 * 86400000) });
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [stale] }, { ...base, sinceMs: 0 })).toMatchObject({ action: 'skip', reason: 'older_than_max_age' });
  });

  test('falls back to the ship date when a box carries no created_at', () => {
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [shipModalBox({ created_at: null })] }, base)).toMatchObject({ action: 'start_grace' });
  });

  test('a box with no readable date is held back, not sent on a guess', () => {
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [shipModalBox({ created_at: 'whenever', ship_date: '' })] }, base))
      .toMatchObject({ action: 'skip', reason: 'undated_box' });
  });

  test('a decorator transfer alone is not a coach announcement', () => {
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [decoBox()] }, base)).toMatchObject({ action: 'skip', reason: 'no_customer_boxes' });
  });

  test('an order with no shipments at all is skipped', () => {
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [] }, base)).toMatchObject({ action: 'skip', reason: 'no_customer_boxes' });
    expect(shipmentNoticePlan({ id: 'SO-1' }, base)).toMatchObject({ action: 'skip', reason: 'no_customer_boxes' });
  });

  test('the same set of boxes is never announced twice', () => {
    const sent = [{ shipment_sig: 'SHP-1', first_tracked_at: new Date(NOW - 3600000).toISOString(), sent_at: new Date(NOW - 1800000).toISOString() }];
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [shipModalBox()] }, { ...base, ledgerRows: sent })).toMatchObject({ action: 'skip', reason: 'already_sent' });
  });

  test('a later box makes a NEW announcement, it does not resend the old one', () => {
    const sent = [{ shipment_sig: 'SHP-1', first_tracked_at: new Date(NOW - 3600000).toISOString(), sent_at: new Date(NOW - 1800000).toISOString() }];
    const order = { id: 'SO-1', _shipments: [shipModalBox(), shipModalBox({ id: 'SHP-2', tracking_number: '1Z2' })] };
    expect(shipmentNoticePlan(order, { ...base, ledgerRows: sent })).toMatchObject({ action: 'start_grace', shipmentIds: ['SHP-1', 'SHP-2'] });
  });
});

describe('the go-live switch', () => {
  test('a date arms it', () => { expect(goLiveDate('2026-09-23')).toBeInstanceOf(Date); });
  test('anything else is a dry run', () => {
    expect(goLiveDate('on')).toBeNull();
    expect(goLiveDate('')).toBeNull();
    expect(goLiveDate(undefined)).toBeNull();
    expect(goLiveDate('yes please')).toBeNull();
  });
});

describe('the sweep pass', () => {
  const orders = () => [
    { id: 'SO-100', _shipments: [shipModalBox()] },                                        // first sighting → grace
    { id: 'SO-101', _shipments: [shipModalBox({ id: 'SHP-1', tracking_number: '' })] },   // waiting on a label
    { id: 'SO-102', _shipments: [shipModalBox()] },                                        // grace elapsed → send
    { id: 'SO-103', _shipments: [shipModalBox()] },                                        // already sent
  ];
  const ledger = () => [
    { so_id: 'SO-102', shipment_sig: 'SHP-1', first_tracked_at: new Date(NOW - 20 * 60000).toISOString(), sent_at: null },
    { so_id: 'SO-103', shipment_sig: 'SHP-1', first_tracked_at: new Date(NOW - 3600000).toISOString(), sent_at: new Date(NOW - 1800000).toISOString() },
  ];
  let writes;
  const admin = ({ ledgerMissing } = {}) => ({
    from(table) {
      const q = {
        _write: null,
        select: () => q, is: () => q, not: () => q, order: () => q, in: () => q,
        limit: async () => ({ data: orders(), error: null }),
        upsert(vals, opts) { q._write = { table, vals, opts }; return q; },
        then: (res, rej) => Promise.resolve(
          table === 'so_shipment_notices' && ledgerMissing ? { data: null, error: { code: '42P01', message: 'relation does not exist' } }
            : q._write ? (writes.push(q._write), { data: null, error: null })
              : { data: table === 'so_shipment_notices' ? ledger() : orders(), error: null },
        ).then(res, rej),
      };
      return q;
    },
  });
  beforeEach(() => { writes = []; });

  test('a dry run decides everything, writes nothing, sends nothing', async () => {
    const summary = await runSweep(admin(), { dryRun: true, since: new Date(GO_LIVE), now: NOW });
    expect(summary.scanned).toBe(4);
    expect(summary.sent).toBe(0);
    expect(summary.graceStarted).toBe(0);
    expect(summary.sends).toEqual([
      { so: 'SO-100', boxes: 1, would: 'start_grace', dryRun: true },
      { so: 'SO-102', boxes: 1, would: 'send', dryRun: true },
    ]);
    expect(summary.skipped).toMatchObject({ waiting_on_tracking: 1, already_sent: 1 });
    expect(summary.waitingOnTracking).toEqual([{ so: 'SO-101', boxes: 1 }]);
    expect(writes).toHaveLength(0);
    expect(mockSends).toHaveLength(0);
  });

  test('an armed run starts grace for a new sighting and sends the one whose grace has elapsed', async () => {
    const summary = await runSweep(admin(), { dryRun: false, since: new Date(GO_LIVE), now: NOW });
    expect(summary.graceStarted).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ table: 'so_shipment_notices', vals: { so_id: 'SO-100', shipment_sig: 'SHP-1', box_count: 1, source: 'sweep' }, opts: { onConflict: 'so_id,shipment_sig', ignoreDuplicates: true } });
    expect(summary.sent).toBe(1);
    expect(mockSends).toHaveLength(1);
    expect(mockSends[0]).toMatchObject({ soId: 'SO-102', shipmentIds: ['SHP-1'], requireTracking: true, requireLedger: true, source: 'sweep', sentBy: 'shipment-sweep' });
  });

  test('with the ledger not deployed, an armed run reports but neither writes nor sends', async () => {
    const summary = await runSweep(admin({ ledgerMissing: true }), { dryRun: false, since: new Date(GO_LIVE), now: NOW });
    expect(summary.note).toMatch(/20260922210000/);
    expect(summary.sent).toBe(0);
    expect(writes).toHaveLength(0);
    expect(mockSends).toHaveLength(0);
    expect(summary.sends.every((s) => s.dryRun)).toBe(true);
  });
});
