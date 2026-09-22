/* The automatic coach shipping notice: when the sweep decides an order is ready
 * to announce, and the guards that keep it from emailing the wrong thing. */

const NOW = new Date('2026-09-21T20:00:00Z').getTime();
const MIN_AGE = 15 * 60000;
const MAX_AGE = 2 * 86400000;
const opts = { now: NOW, minAgeMs: MIN_AGE, maxAgeMs: MAX_AGE };

// Locale strings, the way sales_orders actually stores shipment dates.
const ago = (ms) => new Date(NOW - ms).toLocaleString('en-US');

const box = (over = {}) => ({
  id: 'SHP-1', tracking_number: '1Z999AA10123456784', carrier: 'ups',
  created_at: ago(60 * 60000), items: [{ sku: 'A', name: 'Hoodie', color: 'Navy', sizes: { M: 4 } }],
  ...over,
});

// _shared pulls in the Supabase SDK; the sweep's decisions need none of it.
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => { throw new Error('getSupabaseAdmin is not used in these tests'); },
  verifyUser: async () => ({ ok: false, status: 401, error: 'unused' }),
}));

const { shipmentNoticePlan, runSweep } = require('../../netlify/functions/so-shipment-notify-sweep');

describe('when an order is ready to announce', () => {
  test('every box tracked and past the grace window', () => {
    const plan = shipmentNoticePlan({ id: 'SO-1', _shipments: [box(), box({ id: 'SHP-2', tracking_number: '1Z999AA10123456793' })] }, opts);
    expect(plan).toMatchObject({ action: 'send', reason: 'ready' });
    expect(plan.shipmentIds).toEqual(['SHP-1', 'SHP-2']);
  });

  test('holds the whole order while any box is still waiting on a label', () => {
    const plan = shipmentNoticePlan({ id: 'SO-1', _shipments: [box(), box({ id: 'SHP-2', tracking_number: '' })] }, opts);
    expect(plan).toMatchObject({ action: 'skip', reason: 'waiting_on_tracking', untracked: 1 });
  });

  test('a whitespace-only tracking number is not tracking', () => {
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [box({ tracking_number: '   ' })] }, opts))
      .toMatchObject({ action: 'skip', reason: 'waiting_on_tracking' });
  });

  test('waits out the grace window so a mistyped number can be fixed', () => {
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [box({ created_at: ago(5 * 60000) })] }, opts))
      .toMatchObject({ action: 'skip', reason: 'inside_grace_window' });
  });

  test('the grace window runs from the NEWEST box, not the first', () => {
    const order = { id: 'SO-1', _shipments: [box(), box({ id: 'SHP-2', tracking_number: '1Z2', created_at: ago(60000) })] };
    expect(shipmentNoticePlan(order, opts)).toMatchObject({ action: 'skip', reason: 'inside_grace_window' });
  });

  test('never announces an old shipment — this is what keeps the first run quiet', () => {
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [box({ created_at: ago(5 * 86400000) })] }, opts))
      .toMatchObject({ action: 'skip', reason: 'older_than_max_age' });
  });

  test('falls back to the ship date when a box carries no created_at', () => {
    const shipDate = new Date(NOW - 3 * 3600000).toLocaleDateString('en-US');
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [box({ created_at: null, ship_date: shipDate })] }, opts))
      .toMatchObject({ action: 'send' });
  });

  test('a box with no readable date is held back, not sent on a guess', () => {
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [box({ created_at: 'whenever', ship_date: '' })] }, opts))
      .toMatchObject({ action: 'skip', reason: 'undated_box' });
  });

  test('a decorator transfer is not a coach announcement', () => {
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [box({ shipment_scope: 'deco_transfer' })] }, opts))
      .toMatchObject({ action: 'skip', reason: 'no_customer_boxes' });
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [box({ fulfillment: false })] }, opts))
      .toMatchObject({ action: 'skip', reason: 'no_customer_boxes' });
  });

  test('an order with no shipments at all is skipped', () => {
    expect(shipmentNoticePlan({ id: 'SO-1', _shipments: [] }, opts)).toMatchObject({ action: 'skip', reason: 'no_customer_boxes' });
    expect(shipmentNoticePlan({ id: 'SO-1' }, opts)).toMatchObject({ action: 'skip', reason: 'no_customer_boxes' });
  });

  test('the same set of boxes is never announced twice', () => {
    const order = { id: 'SO-1', _shipments: [box()], sent_history: [{ type: 'shipment', shipment_sig: 'SHP-1' }] };
    expect(shipmentNoticePlan(order, opts)).toMatchObject({ action: 'skip', reason: 'already_sent' });
  });

  test('a later box makes a new announcement, it does not resend the old one', () => {
    const order = {
      id: 'SO-1',
      _shipments: [box(), box({ id: 'SHP-2', tracking_number: '1Z2' })],
      sent_history: [{ type: 'shipment', shipment_sig: 'SHP-1' }],
    };
    expect(shipmentNoticePlan(order, opts)).toMatchObject({ action: 'send' });
  });

  test('an order-document email in the history is not a shipment notice', () => {
    const order = { id: 'SO-1', _shipments: [box()], sent_history: [{ type: 'so', to: 'coach@x.org' }] };
    expect(shipmentNoticePlan(order, opts)).toMatchObject({ action: 'send' });
  });
});

describe('the sweep pass', () => {
  const orders = [
    { id: 'SO-100', _shipments: [box()] },                                               // ready
    { id: 'SO-101', _shipments: [box({ tracking_number: '' })] },                        // waiting on a label
    { id: 'SO-102', _shipments: [box()], sent_history: [{ type: 'shipment', shipment_sig: 'SHP-1' }] }, // done already
  ];
  const admin = () => ({
    from: () => {
      const q = { select: () => q, is: () => q, not: () => q, order: () => q, limit: async () => ({ data: orders, error: null }) };
      return q;
    },
  });

  test('a dry run decides everything and sends nothing', async () => {
    const summary = await runSweep(admin(), { dryRun: true });
    expect(summary.scanned).toBe(3);
    expect(summary.sent).toBe(0);
    expect(summary.sends).toEqual([{ so: 'SO-100', boxes: 1, dryRun: true }]);
    expect(summary.skipped).toMatchObject({ waiting_on_tracking: 1, already_sent: 1 });
    expect(summary.waitingOnTracking).toEqual([{ so: 'SO-101', boxes: 1 }]);
  });
});
