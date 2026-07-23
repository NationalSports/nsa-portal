// ── Shared supplier-bill anomaly rules ──
// One source of truth for "this bill looks out of line" — used by BOTH the client
// (src/appliedBillsLedger.js stamps resolution.flags at push time; src/App.js shows the
// ⚠ Review pill on pushed cards) and the emailed daily report
// (netlify/functions/bill-anomaly-digest.js). Written in CommonJS so webpack and the
// Netlify function runtime consume the exact same logic — same pattern as opsRecap.js.
//
// Why this exists (owner, 2026-07-21): with the clean class now auto-pushing, pushed ≠
// human-looked-at. These flags are the after-the-fact review net: they never block a
// push, they mark it for eyes.

const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return isNaN(n) ? 0 : n; };
const round1 = (n) => Math.round(n * 10) / 10;

// The adidas / Under Armour family, per the owner's freight rule. Agron is adidas's
// accessories licensee; Badger/Powers carry UA program goods. \bUA\b catches the
// "POWERS MANUFACTURING UA"-style suffixed names. Errs toward flagging — a false
// positive costs a glance, a false negative hides a freight overcharge.
const ADIDAS_UA_RE = /ADIDAS|AGRON|UNDER\s*ARMOUR|\bUA\b/;
const isAdidasUaVendor = (v) => ADIDAS_UA_RE.test(String(v || '').toUpperCase());

// Freight cap: adidas/UA freight above this share of merchandise cost gets flagged.
const FREIGHT_PCT_CAP = 0.10;
// A billed unit price this far off the order's cost is "way out of line" even when a
// human (or the clean gate) pushed it — mirrors billResolve.js's sharp-price demotion.
const SHARP_PRICE_PCT = 0.25;

// p: a parsed bill (same shape client-side and in applied_bills.raw_meta).
// Returns [{code, detail}] — empty when nothing looks off.
const billAnomalyFlags = (p) => {
  if (!p) return [];
  const flags = [];
  const vendor = p.vendor || p.supplier || '';
  const freight = num(p.freight);
  const merch = num(p.merchandise_total) || (num(p.doc_total) - freight - num(p.si_upcharge));
  if (isAdidasUaVendor(vendor) && freight > 0 && merch > 0 && freight > FREIGHT_PCT_CAP * merch) {
    flags.push({
      code: 'freight_gt10',
      detail: 'Freight $' + freight.toFixed(2) + ' is ' + round1((freight / merch) * 100) + '% of $' + merch.toFixed(2) + ' merchandise (adidas/UA cap ' + (FREIGHT_PCT_CAP * 100) + '%)',
    });
  }
  const sharp = (p._lineMappings || []).filter((m) => {
    const bu = num(m.bill_unit); const oc = num(m.unit_cost);
    return bu > 0 && oc > 0 && Math.abs(bu - oc) > Math.max(0.02, SHARP_PRICE_PCT * oc);
  });
  if (sharp.length) {
    const w = sharp.reduce((a, b) => (Math.abs(num(b.bill_unit) - num(b.unit_cost)) > Math.abs(num(a.bill_unit) - num(a.unit_cost)) ? b : a));
    flags.push({
      code: 'sharp_price',
      detail: sharp.length + ' line(s) billed >' + (SHARP_PRICE_PCT * 100) + '% off the order cost (worst: ' + (w.sku || '?') + ' $' + num(w.unit_cost).toFixed(2) + ' → $' + num(w.bill_unit).toFixed(2) + ')',
    });
  }
  if (p._overage_ok) {
    flags.push({ code: 'overage', detail: 'Pushed with billed quantities above the order’s open amount (overage approved on accept)' });
  }
  const docTotal = num(p.doc_total);
  if (docTotal > 0 && num(p.merchandise_total) > 0) {
    const sum = num(p.merchandise_total) + freight + num(p.si_upcharge);
    if (Math.abs(sum - docTotal) > 1) {
      flags.push({ code: 'total_mismatch', detail: 'Lines + freight + upcharge = $' + sum.toFixed(2) + ' but the document total is $' + docTotal.toFixed(2) });
    }
  }
  return flags;
};

module.exports = { billAnomalyFlags, isAdidasUaVendor, FREIGHT_PCT_CAP, SHARP_PRICE_PCT };
