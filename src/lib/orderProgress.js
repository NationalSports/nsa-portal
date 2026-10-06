// Phone order status: Ordered → Blanks in → Production → Shipped → Done, plus
// tracking, art approval and blanks received, in words a rep can read to a
// coach. The stage is whatever calcSOStatus says (the caller passes it in), so
// the phone always agrees with the desktop order page.
import { numericSizeKeys } from './opsRecap';

export const PROGRESS_STEPS = ['Ordered', 'Blanks in', 'Production', 'Shipped', 'Done'];

// Same carrier rule the order editor uses for tracking links.
export const trackingHref = (tn) => {
  if (/^1Z/i.test(tn)) return 'https://www.ups.com/track?tracknum=' + tn;
  if (/^(94|93|92|91)\d{18,}/.test(tn)) return 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + tn;
  return 'https://www.fedex.com/fedextrack/?trknbr=' + tn;
};

// Customer shipments only (a decoration hand-off to an outside shop isn't one).
export function orderTracking(so) {
  const out = [];
  (so?._shipments || []).forEach((s) => {
    if (!s || s.fulfillment === false || s.shipment_scope === 'deco_transfer' || !s.tracking_number) return;
    out.push({ number: String(s.tracking_number), carrier: s.carrier || '', date: s.ship_date || null, url: s.tracking_url || trackingHref(String(s.tracking_number)) });
  });
  if (!out.length && so?._tracking_number) {
    const tn = String(so._tracking_number);
    out.push({ number: tn, carrier: so._carrier || '', date: so._ship_date || null, url: so._tracking_url || trackingHref(tn) });
  }
  return out;
}

// Blank garments on purchase orders: ordered vs checked in (drop-ship lines
// never arrive at the warehouse, so they're left out).
export function blanksIn(so) {
  let ordered = 0; let received = 0; let cancelled = 0;
  (so?.items || []).forEach((it) => (it.po_lines || []).forEach((po) => {
    if (po.drop_ship) return;
    numericSizeKeys(po).forEach((sz) => {
      ordered += po[sz] || 0;
      received += (po.received || {})[sz] || 0;
      cancelled += (po.cancelled || {})[sz] || 0;
    });
  }));
  const need = Math.max(0, ordered - cancelled);
  return { ordered: need, received: Math.min(received, need) };
}

export function artStatus(so) {
  const files = (so?.art_files || []).filter(Boolean);
  const approved = files.filter((a) => a.status === 'approved' || a.status === 'art_complete').length;
  const needsApproval = files.filter((a) => a.status === 'needs_approval' || a.status === 'uploaded').length;
  const waitingForArt = files.filter((a) => a.status === 'waiting_for_art').length;
  return { total: files.length, approved, needsApproval, waitingForArt };
}

const STEP_OF = { booking: 0, need_order: 1, waiting_receive: 1, needs_pull: 1, items_received: 2, in_production: 2, ready_to_invoice: 3, complete: 5 };

export function orderProgress(so, status) {
  if (!so) return null;
  if (so.status === 'cancelled' || so.status === 'deleted') return { cancelled: true, current: -1, steps: [], headline: 'Cancelled', tracking: [], blanks: blanksIn(so), art: artStatus(so) };
  const tracking = orderTracking(so);
  const delivered = Object.keys(so.delivered || {}).length > 0;
  const blanks = blanksIn(so);
  const art = artStatus(so);
  let current = STEP_OF[status] != null ? STEP_OF[status] : 1;
  if (status === 'ready_to_invoice' && (tracking.length || delivered)) current = 4;
  const jobs = (so.jobs || []).filter((j) => j && j.prod_status !== 'draft' && j.prod_status !== 'outside');
  const jobsDone = jobs.filter((j) => j.prod_status === 'completed' || j.prod_status === 'shipped').length;
  let headline;
  switch (status) {
    case 'booking': headline = 'Booked for later' + (so.expected_ship_date ? ', ships around ' + so.expected_ship_date : ''); break;
    case 'need_order': headline = 'Blanks not ordered yet'; break;
    case 'waiting_receive': headline = blanks.ordered ? `Waiting on blanks: ${blanks.received} of ${blanks.ordered} in` : 'Waiting on blanks'; break;
    case 'needs_pull': headline = 'Pulling blanks from stock'; break;
    case 'items_received': headline = 'Blanks are in, waiting for production'; break;
    case 'in_production': headline = 'In production' + (jobs.length > 1 ? `: ${jobsDone} of ${jobs.length} jobs done` : ''); break;
    case 'ready_to_invoice': headline = delivered ? 'Delivered' : tracking.length ? 'Shipped' : 'Finished, ready to ship or deliver'; break;
    case 'complete': headline = 'Complete'; break;
    default: headline = String(status || 'Open').replace(/_/g, ' ');
  }
  const steps = PROGRESS_STEPS.map((label, i) => ({ label: i === 3 && delivered ? 'Delivered' : label, state: i < current ? 'done' : i === current ? 'current' : 'todo' }));
  return { cancelled: false, current, steps, headline, tracking, blanks, art };
}
