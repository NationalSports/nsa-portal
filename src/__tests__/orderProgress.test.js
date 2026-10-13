/**
 * Phone order status line: the step comes from calcSOStatus; this checks the
 * words, blanks count, art state and tracking links built around it.
 */
import { orderProgress, orderTracking, blanksIn, artStatus } from '../lib/orderProgress';

const states = (p) => p.steps.map((s) => s.state[0]).join('');

describe('orderProgress', () => {
  test('waiting on blanks counts checked-in units and leaves drop-ship and cancelled units out', () => {
    const so = { id: 'SO-1', items: [{ po_lines: [
      { S: 10, M: 10, received: { S: 10, M: 2 }, cancelled: { M: 2 } },
      { L: 50, drop_ship: true, received: {} },
    ] }] };
    expect(blanksIn(so)).toEqual({ ordered: 18, received: 12 });
    const p = orderProgress(so, 'waiting_receive');
    expect(p.headline).toBe('Waiting on blanks: 12 of 18 in');
    expect(states(p)).toBe('dcttt');
  });

  test('production, finished, shipped and complete move along the steps', () => {
    const jobs = [{ prod_status: 'completed' }, { prod_status: 'in_process' }, { prod_status: 'draft' }];
    expect(orderProgress({ jobs }, 'in_production')).toMatchObject({ headline: 'In production: 1 of 2 jobs done' });
    expect(states(orderProgress({ jobs }, 'in_production'))).toBe('ddctt');
    const ready = orderProgress({}, 'ready_to_invoice');
    expect([ready.headline, states(ready)]).toEqual(['Finished, ready to ship or deliver', 'dddct']);
    const shipped = orderProgress({ _shipments: [{ tracking_number: '1Z999', carrier: 'UPS', ship_date: '2026-10-03' }] }, 'ready_to_invoice');
    expect([shipped.headline, states(shipped)]).toEqual(['Shipped', 'ddddc']);
    const delivered = orderProgress({ delivered: { 'job|J1': { at: 'x' } } }, 'ready_to_invoice');
    expect(delivered.headline).toBe('Delivered');
    expect(delivered.steps[3].label).toBe('Delivered');
    expect(states(orderProgress({}, 'complete'))).toBe('ddddd');
    expect(orderProgress({ status: 'cancelled' }, 'need_order')).toMatchObject({ cancelled: true, headline: 'Cancelled' });
  });
});

describe('orderTracking', () => {
  test('lists customer shipments with carrier links and skips decoration hand-offs', () => {
    const t = orderTracking({ _shipments: [
      { tracking_number: '1ZABC', carrier: 'UPS' },
      { tracking_number: '9400111111111111111111', carrier: 'USPS' },
      { tracking_number: '7777', shipment_scope: 'deco_transfer' },
      { tracking_number: '8888', fulfillment: false },
      { tracking_number: '123456789012', tracking_url: 'https://example.com/t/1' },
    ] });
    expect(t.map((x) => x.url)).toEqual([
      'https://www.ups.com/track?tracknum=1ZABC',
      'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111111111111111111',
      'https://example.com/t/1',
    ]);
  });

  test('falls back to the single tracking number older orders carry', () => {
    expect(orderTracking({ _tracking_number: '61290000000000', _carrier: 'FedEx' })).toEqual([
      { number: '61290000000000', carrier: 'FedEx', date: null, url: 'https://www.fedex.com/fedextrack/?trknbr=61290000000000' },
    ]);
  });
});

test('artStatus treats approved and art complete as approved', () => {
  expect(artStatus({ art_files: [{ status: 'approved' }, { status: 'art_complete' }, { status: 'uploaded' }, { status: 'waiting_for_art' }] }))
    .toEqual({ total: 4, approved: 2, needsApproval: 1, waitingForArt: 1 });
});
