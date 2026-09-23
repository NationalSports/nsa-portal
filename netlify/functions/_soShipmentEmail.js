// Coach-facing "your order shipped" email for a sales order.
//
// The ONE builder behind so-shipment-notify.js. Everything here is PURE — it
// takes plain data and returns { subject, html } — so the layout can be tested
// without Supabase or Brevo (src/__tests__/soShipmentEmail.test.js). All of the
// IO (who the coach is, which shipments went out, what the mockups are) lives in
// the endpoint, which resolves it server-side from the order so the browser can
// never dictate the recipient or the content.
//
// Table-based, inline-styled, 600px: this is an EMAIL, not a page. Flexbox, grid
// and <style> rules other than the one media query below are unreliable across
// Outlook/Gmail, so don't reach for them here.
//
// Design source: the Claude Design handoff "NSA Shipment Email" (navy #192853 /
// red #962C32, Arial Narrow display type, star tagline, per-box tracking list).

// ── Brand tokens (NSA design system — navy dominant, red as accent only) ──
const NAVY = '#192853';
const RED = '#962C32';
const RED_LIGHT = '#D94A52';
const FOOTER_NAVY = '#0F1A38';
const PANEL = '#F7F8FB';
const HAIRLINE = '#EEF1F6';
const BODY_TEXT = '#6B7487';
const MUTED = '#8A93A6';
const DISPLAY = "'Arial Narrow',Arial,Helvetica,sans-serif";
const BODY_FONT = 'Arial,Helvetica,sans-serif';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Only ever emit http(s) in href/src. A javascript: or data: URL reaching an
// email client is the one way a merged-in string can turn into an attack.
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');

const DOT = ' &nbsp;&#183;&nbsp; ';

// ── Size ordering ──
// Mirror of src/constants.js SZ_ORD for the labels a team order actually
// carries (functions are CommonJS and can't import the CRA module — same
// caveat _baggingShip.js notes for estimateWeightOz). Unknown labels keep
// their original order at the end rather than being dropped.
const SZ_ORD = ['YXS', 'YS', 'YM', 'YL', 'YXL', 'YOUTH', 'XXS', 'XS', 'S', 'M', 'L', 'XL',
  '2XL', '3XL', '4XL', '5XL', '6XL', 'ST', 'MT', 'LT', 'XLT', '2XLT', '3XLT', '4XLT', '5XLT', 'OSFA'];

function orderedSizes(sizes) {
  const entries = Object.entries(sizes || {})
    .map(([label, qty]) => ({ label: String(label), qty: Math.max(0, Number(qty) || 0) }))
    .filter((s) => s.qty > 0);
  return entries.sort((a, b) => {
    const ai = SZ_ORD.indexOf(a.label.toUpperCase());
    const bi = SZ_ORD.indexOf(b.label.toUpperCase());
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// ── Mockup images ──
// Art lives on Cloudinary (src/utils.js fileUpload), so every stored mockup is
// already a public https URL an email client can load. Two transforms are worth
// applying on the way out:
//   • a PDF proof can't render in an inbox — swap in Cloudinary's first-page PNG
//     (mirror of _cloudinaryPdfThumb);
//   • resize to ~300px so a 12-item email isn't 20MB of full-res artwork.
// No f_auto: content-negotiated formats (webp/avif) are fine in a browser but
// an email client's image proxy may not send an Accept header Cloudinary can
// act on. The stored format (PNG/JPG) is what every inbox renders.
const isPdfUrl = (u) => /\.pdf(?:$|\?)/i.test(String(u || ''));

function emailImageUrl(rawUrl, width = 300) {
  const url = safeUrl(typeof rawUrl === 'string' ? rawUrl : (rawUrl && rawUrl.url));
  if (!url) return '';
  if (!url.includes('cloudinary.com')) return isPdfUrl(url) ? '' : url;
  const asImage = url.replace('/raw/upload/', '/image/upload/').replace('/video/upload/', '/image/upload/');
  const transform = isPdfUrl(url) ? `pg_1,f_png,w_${width},c_limit` : `q_auto,w_${width},c_limit`;
  return asImage.replace('/image/upload/', `/image/upload/${transform}/`);
}

// ── Which mockups belong to a garment line ──
// Port of safeHelpers.js garmentMockKey / itemMockFiles, narrowed to the READ
// the email needs. Keep in sync with that module: it is the canonical key
// builder every other surface (rep view, artist modal, coach portal, floor
// sheet, approval gate) goes through.
const PLACEHOLDER_SKU = /^(?:cust[-_ ]?supplied|custom|tbd|n\/a|none)?$/i;
const mockSkuOf = (it) => {
  const sku = String((it && it.sku) || '');
  if (!PLACEHOLDER_SKU.test(sku.trim())) return sku;
  const nm = String((it && it.name) || '').trim().replace(/\|/g, '/');
  return nm || sku;
};
const garmentMockKey = (it) => mockSkuOf(it) + '|' + ((it && it.color) || '');

// First usable mockup for a garment: its own per-item bucket (any sub-slot —
// color ways, back proofs), then the art file's generic mockups. Names/numbers
// proof slots are excluded: a back proof is not the garment's mockup.
const NN_SLOT_RE = /\|(?:numbers|names)(?:_\d+)?(?:_b)?$/;

function pickMockupUrl(artFiles, item) {
  const base = garmentMockKey(item);
  const candidates = [];
  (artFiles || []).forEach((art) => {
    if (!art) return;
    const mocks = (art.item_mockups && typeof art.item_mockups === 'object') ? art.item_mockups : {};
    Object.keys(mocks).forEach((key) => {
      if (NN_SLOT_RE.test(key)) return;
      if (key !== base && !key.startsWith(base + '|')) return;
      (Array.isArray(mocks[key]) ? mocks[key] : []).forEach((f) => { if (f) candidates.push(f); });
    });
  });
  (artFiles || []).forEach((art) => {
    if (!art) return;
    const generic = Array.isArray(art.mockup_files) ? art.mockup_files
      : (Array.isArray(art.files) ? art.files : []);
    generic.forEach((f) => { if (f) candidates.push(f); });
  });
  for (const f of candidates) {
    const url = emailImageUrl(f);
    if (url) return url;
  }
  return '';
}

// ── Decoration summary ──
// One short, coach-readable phrase per garment ("2-color screen print, Left
// Chest"), not the internal production label. Deduped and capped: the email
// describes the gear, the portal holds the detail.
function decorationSummary(decorations) {
  const phrases = [];
  (decorations || []).forEach((d) => {
    if (!d) return;
    if (d.kind === 'names' || d.kind === 'numbers') { phrases.push(d.kind === 'names' ? 'Names' : 'Numbers'); return; }
    const method = String(d.deco_type || d.art_tbd_type || d.type || '').replace(/_/g, ' ').trim();
    if (!method) return;
    const colors = Number(d.colors) || 0;
    const where = String(d.position || d.placement || '').trim();
    phrases.push([colors > 0 ? `${colors}-color ${method}` : method, where].filter(Boolean).join(', '));
  });
  const seen = new Set();
  return phrases.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 3).join(DOT);
}

// ── Product names ──
// Catalog names arrive as "Sport-Tek Sport-Tek PosiCharge Competitor Tee. ST350":
// the vendor import doubles the brand and appends the style number. The brand
// and SKU each get their own line in the email, so the coach's copy drops a
// leading brand (once or twice) and a trailing SKU. Anything else is left alone.
function cleanProductName(name, brand, sku) {
  const original = String(name || '').trim();
  const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = original;
  const b = String(brand || '').trim();
  if (b) out = out.replace(new RegExp('^(?:' + escape(b) + '\\s+)+', 'i'), '');
  const s = String(sku || '').trim();
  if (s) out = out.replace(new RegExp('[\\s.,\\-–—]*' + escape(s) + '\\s*$', 'i'), '');
  out = out.replace(/[.\s]+$/, '').trim();
  // A name that was ONLY brand + style number ("Richardson PTS20") has nothing
  // descriptive left — show it as it was rather than an empty line or a bare SKU.
  return out || original;
}

// ── Line assembly ──
// What actually went in the boxes, rolled up per garment. The shipment records
// (so._shipments[].items) are the authority on quantities — an order line can be
// partially shipped, and the coach must see the box contents, not the order.
// so_items only supplies the descriptive fields (brand, proper name, SKU).
function buildShipmentLines({ packages, soItems, decorationsByItemId, artFiles }) {
  const byKey = new Map();
  (packages || []).forEach((pkg) => {
    (pkg.items || []).forEach((it) => {
      if (!it) return;
      const key = garmentMockKey(it);
      if (!byKey.has(key)) byKey.set(key, { sku: it.sku || '', name: it.name || '', color: it.color || '', sizes: {} });
      const line = byKey.get(key);
      Object.entries(it.sizes || {}).forEach(([size, qty]) => {
        const n = Math.max(0, Number(qty) || 0);
        if (n > 0) line.sizes[size] = (line.sizes[size] || 0) + n;
      });
    });
  });

  const soByKey = new Map();
  (soItems || []).forEach((it) => { if (it && !soByKey.has(garmentMockKey(it))) soByKey.set(garmentMockKey(it), it); });

  return [...byKey.entries()].map(([key, line]) => {
    const soItem = soByKey.get(key) || null;
    const sizes = orderedSizes(line.sizes);
    const brand = (soItem && soItem.brand) || '';
    const sku = line.sku || (soItem && soItem.sku) || '';
    return {
      brand,
      name: cleanProductName((soItem && soItem.name) || line.name || line.sku || 'Item', brand, sku),
      color: line.color || (soItem && soItem.color) || '',
      sku,
      decoration: soItem ? decorationSummary((decorationsByItemId || {})[soItem.id]) : '',
      mockupUrl: pickMockupUrl(artFiles, soItem || line),
      sizes,
      totalQty: sizes.reduce((a, s) => a + s.qty, 0),
    };
  }).filter((line) => line.totalQty > 0);
}

// ── What hasn't shipped yet ──
// Ordered units minus everything in ANY customer box on the order (not only the
// boxes this email covers), per garment. Only lines with a size run count — a
// service line (digitizing, a logo) has no sizes and is not a "piece" the coach
// is waiting on. Lets the email say plainly when it is a partial shipment.
function remainingUnits({ soItems, allPackages }) {
  const shipped = new Map();
  (allPackages || []).forEach((pkg) => (pkg.items || []).forEach((it) => {
    if (!it) return;
    const key = garmentMockKey(it);
    shipped.set(key, (shipped.get(key) || 0) + orderedSizes(it.sizes).reduce((a, s) => a + s.qty, 0));
  }));
  const ordered = new Map();
  (soItems || []).forEach((it) => {
    if (!it) return;
    const units = orderedSizes(it.sizes).reduce((a, s) => a + s.qty, 0);
    if (!units) return;
    const key = garmentMockKey(it);
    ordered.set(key, (ordered.get(key) || 0) + units);
  });
  let remaining = 0;
  ordered.forEach((units, key) => { remaining += Math.max(0, units - (shipped.get(key) || 0)); });
  return remaining;
}

// ── Carrier / tracking ──
const CARRIER_LABELS = { ups: 'UPS', fedex: 'FedEx', usps: 'USPS', stamps_com: 'USPS', rep_delivery: 'Rep Delivery', courier: 'Courier' };
const carrierLabel = (c) => CARRIER_LABELS[String(c || '').toLowerCase()] || String(c || '').toUpperCase();

// Mirror of the trackUrl in the order editors — a saved shipment usually carries
// tracking_url already; this covers the ones recorded before it was stored.
function trackingUrlFor(trackingNumber, carrier) {
  const tn = String(trackingNumber || '').trim();
  if (!tn) return '';
  if (/^1Z/i.test(tn)) return 'https://www.ups.com/track?tracknum=' + encodeURIComponent(tn);
  if (/^(94|93|92|91)\d{18,}/.test(tn)) return 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + encodeURIComponent(tn);
  if (String(carrier || '').toLowerCase() === 'ups') return 'https://www.ups.com/track?tracknum=' + encodeURIComponent(tn);
  return 'https://www.fedex.com/fedextrack/?trknbr=' + encodeURIComponent(tn);
}

// "Track all boxes" — UPS and FedEx both accept several numbers in one lookup,
// so a multi-box UPS shipment gets ONE link showing every box. Anything else
// falls back to the first box's own link.
function trackAllUrl(packages) {
  const tracked = (packages || []).filter((p) => p.trackingNumber);
  if (!tracked.length) return '';
  const carriers = new Set(tracked.map((p) => String(p.carrier || '').toLowerCase()));
  const numbers = tracked.map((p) => p.trackingNumber);
  if (tracked.length > 1 && carriers.size === 1) {
    const only = [...carriers][0];
    if (only === 'ups' || numbers.every((n) => /^1Z/i.test(n))) {
      return 'https://www.ups.com/track?tracknum=' + encodeURIComponent(numbers.join(','));
    }
    if (only === 'fedex') {
      return 'https://www.fedex.com/fedextrack/?trknbr=' + encodeURIComponent(numbers.join(','));
    }
  }
  return tracked[0].trackingUrl || trackingUrlFor(tracked[0].trackingNumber, tracked[0].carrier);
}

// ── Layout pieces ──
const wrap = (bg, inner, pad) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background-color:${bg};">
  <tr><td class="pad" style="padding:${pad};">${inner}</td></tr>
</table>`;

const rule = (w, h, color) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="${w}" height="${h}" style="width:${w}px;height:${h}px;background-color:${color};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;

function buttonHtml(url, label, { fill, outline } = {}) {
  const href = safeUrl(url);
  if (!href) return '';
  if (outline) {
    return `<td style="border:2px solid ${NAVY};border-radius:4px;">
      <a href="${esc(href)}" style="display:block;padding:11px 24px;font-family:${DISPLAY};font-weight:bold;font-size:14px;line-height:18px;mso-line-height-rule:exactly;letter-spacing:2px;color:${NAVY};text-decoration:none;text-transform:uppercase;">${esc(label)}</a></td>`;
  }
  return `<td bgcolor="${fill}" style="background-color:${fill};border-radius:4px;">
    <a href="${esc(href)}" style="display:block;padding:13px 26px;font-family:${DISPLAY};font-weight:bold;font-size:14px;line-height:18px;mso-line-height-rule:exactly;letter-spacing:2px;color:#ffffff;text-decoration:none;text-transform:uppercase;">${esc(label)}</a></td>`;
}

function itemRowHtml(line) {
  const sizeCount = line.sizes.length || 1;
  const sizeCells = line.sizes.map((s, i) => `<td align="center" width="${Math.round(100 / sizeCount)}%" style="width:${Math.round(100 / sizeCount)}%;padding:6px 0;background-color:${PANEL};${i < sizeCount - 1 ? 'border-right:2px solid #ffffff;' : ''}font-family:${BODY_FONT};font-size:12px;line-height:16px;mso-line-height-rule:exactly;color:${NAVY};">
      <strong style="font-family:${DISPLAY};letter-spacing:1px;">${esc(s.label)}</strong><br><span style="font-size:14px;font-weight:bold;">${s.qty}</span></td>`).join('');

  // No mockup on file → the design's gray placeholder panel, never a broken image.
  // The mockup stays beside the details at every width (no "stackcell"): on a phone
  // the card scales down as one piece, which reads better than a full-width image
  // over a full-width size run.
  const mockCell = line.mockupUrl
    ? `<td width="150" valign="top" style="width:150px;padding:0;background-color:${PANEL};">
        <img src="${esc(line.mockupUrl)}" width="150" alt="Mockup of ${esc(line.name)}" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;background-color:${PANEL};"></td>`
    : `<td width="150" valign="middle" align="center" height="170" style="width:150px;height:170px;padding:10px;background-color:${PANEL};font-family:${DISPLAY};font-size:11px;line-height:15px;mso-line-height-rule:exactly;letter-spacing:1.5px;color:#9AA3B5;text-transform:uppercase;">Mockup<br>Image</td>`;

  const details = [line.color, line.sku ? 'SKU ' + line.sku : '', line.decoration].filter(Boolean).map(esc).join(DOT);

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background-color:#ffffff;">
  <tr><td class="pad" style="padding:14px 40px 0 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border:1px solid ${HAIRLINE};background-color:#ffffff;">
      <tr>
        ${mockCell}
        <td valign="top" style="padding:18px 20px;">
          ${line.brand ? `<div style="font-family:${DISPLAY};font-weight:bold;font-size:11px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:2px;color:${RED};text-transform:uppercase;">${esc(line.brand)}</div>` : ''}
          <div style="font-family:${DISPLAY};font-weight:bold;font-size:19px;line-height:23px;mso-line-height-rule:exactly;color:${NAVY};text-transform:uppercase;padding-top:4px;">${esc(line.name)}</div>
          ${details ? `<div style="font-family:${BODY_FONT};font-size:13px;line-height:20px;mso-line-height-rule:exactly;color:${BODY_TEXT};padding-top:4px;">${details}</div>` : ''}
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin-top:12px;"><tr>${sizeCells}</tr></table>
          <div style="font-family:${DISPLAY};font-weight:bold;font-size:13px;line-height:18px;mso-line-height-rule:exactly;letter-spacing:1.5px;color:${NAVY};text-transform:uppercase;padding-top:12px;">Total ${line.totalQty} pcs</div>
        </td>
      </tr>
    </table>
  </td></tr>
</table>`;
}

// What's physically in one box, for the per-box tracking row: each garment with
// its color, count and size run, so a coach can match a box to what came out of
// it. `nameFor` maps a box item to the cleaned name its card uses.
function boxContents(items, nameFor) {
  return (items || []).map((it) => {
    if (!it) return null;
    const sizes = orderedSizes(it.sizes);
    const totalQty = sizes.reduce((a, s) => a + s.qty, 0);
    if (!totalQty) return null;
    return {
      name: String((nameFor && nameFor(it)) || it.name || it.sku || 'Item').trim(),
      color: String(it.color || '').trim(),
      sizes,
      totalQty,
    };
  }).filter(Boolean);
}

function boxContentsHtml(pkg) {
  const items = Array.isArray(pkg.contentsItems) ? pkg.contentsItems : [];
  if (!items.length) {
    return pkg.contents ? `<div style="font-size:12px;line-height:17px;font-weight:normal;color:${BODY_TEXT};">${esc(pkg.contents)}</div>` : '';
  }
  return items.map((it) => `<div style="font-size:12px;line-height:17px;font-weight:normal;color:${BODY_TEXT};padding-top:3px;">${esc(it.name)}${it.color ? ' &#8212; ' + esc(it.color) : ''} &#183; ${it.totalQty} pcs</div>
      <div style="font-size:11px;line-height:16px;font-weight:normal;color:${NAVY};letter-spacing:.3px;">${it.sizes.map((s) => `${esc(s.label)}&nbsp;<strong>${s.qty}</strong>`).join(' &nbsp; ')}</div>`).join('');
}

function boxRowHtml(pkg, boxCount) {
  const link = safeUrl(pkg.trackingUrl || trackingUrlFor(pkg.trackingNumber, pkg.carrier));
  const label = pkg.trackingNumber ? esc(pkg.trackingNumber) : 'No tracking number';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#ffffff;border:1px solid ${HAIRLINE};border-bottom:0;">
  <tr>
    <td width="74" valign="top" style="width:74px;padding:12px 0 12px 14px;font-family:${DISPLAY};font-weight:bold;font-size:12px;line-height:18px;mso-line-height-rule:exactly;letter-spacing:1.5px;color:${RED};text-transform:uppercase;">Box ${pkg.index}/${boxCount}</td>
    <td valign="top" style="padding:12px 10px;font-family:${BODY_FONT};font-size:14px;line-height:20px;mso-line-height-rule:exactly;font-weight:bold;color:${NAVY};">${label}${boxContentsHtml(pkg)}</td>
    <td width="70" valign="top" align="right" style="width:70px;padding:12px 14px 12px 0;">${link ? `<a href="${esc(link)}" style="font-family:${DISPLAY};font-weight:bold;font-size:12px;line-height:20px;letter-spacing:1.5px;color:${RED};text-decoration:none;text-transform:uppercase;">Track &#8594;</a>` : ''}</td>
  </tr>
</table>`;
}

/**
 * Build the shipment email.
 *
 * Every field is optional except `order.id` — a real order is routinely missing
 * an ETA, a rep phone, or tracking on a rep-delivered box, and the email has to
 * degrade section by section rather than print "undefined" at a coach.
 */
function buildSoShipmentEmail({
  order = {},
  teamName = '',
  shipTo = null,
  rep = null,
  lines = [],
  packages = [],
  remainingUnits = 0,
  shipDate = '',
  eta = '',
  carrier = '',
  serviceLevel = '',
  portalUrl = '',
  reorderUrl = '',
  reviewUrl = '',
  logoUrl = '',
} = {}) {
  const boxCount = packages.length;
  const totalPieces = lines.reduce((a, l) => a + l.totalQty, 0);
  const styleCount = lines.length;
  const team = teamName || 'your team';
  const trackAll = trackAllUrl(packages);

  const preheader = `${totalPieces} piece${totalPieces === 1 ? '' : 's'} for ${team} ${boxCount > 1 ? `in ${boxCount} boxes ` : ''}— tracking inside.`;

  const carrierLine = [carrierLabel(carrier), serviceLevel, boxCount ? `${boxCount} Box${boxCount === 1 ? '' : 'es'}` : '']
    .filter(Boolean).map(esc).join(DOT);

  const shipToBlock = shipTo ? `<td class="stackcell" width="260" valign="top" style="width:260px;padding-bottom:14px;">
      <div style="font-family:${DISPLAY};font-weight:bold;font-size:11px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:2px;color:${MUTED};text-transform:uppercase;">Shipping To</div>
      <div style="font-family:${BODY_FONT};font-size:14px;line-height:21px;mso-line-height-rule:exactly;color:${NAVY};padding-top:6px;">${[shipTo.name, shipTo.line1, [shipTo.city, shipTo.state].filter(Boolean).join(', ') + (shipTo.zip ? ' ' + shipTo.zip : '')].filter((l) => String(l || '').trim()).map(esc).join('<br>')}</div>
    </td>` : '';

  const repBlock = rep ? `<td class="stackcell" width="240" valign="top" style="width:240px;padding-bottom:14px;">
      <div style="font-family:${DISPLAY};font-weight:bold;font-size:11px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:2px;color:${MUTED};text-transform:uppercase;">Your Rep</div>
      <div style="font-family:${BODY_FONT};font-size:14px;line-height:21px;mso-line-height-rule:exactly;color:${NAVY};padding-top:6px;">${esc(rep.name || '')}${rep.phone ? `<br><a href="tel:${esc(String(rep.phone).replace(/[^\d+]/g, ''))}" style="color:${RED};text-decoration:none;">${esc(rep.phone)}</a>` : ''}${rep.email ? `<br><a href="mailto:${esc(rep.email)}" style="color:${RED};text-decoration:none;">${esc(rep.email)}</a>` : ''}</div>
    </td>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your National Sports Apparel order has shipped</title>
<!--[if mso]>
<style>body,table,td,a{font-family:Arial,Helvetica,sans-serif !important;}</style>
<![endif]-->
<style>
  @media only screen and (max-width:620px){
    .stackcell{display:block !important;width:100% !important;max-width:100% !important}
    .h1{font-size:30px !important}
    .pad{padding-left:20px !important;padding-right:20px !important}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${PANEL};">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</span>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${PANEL};">
<tr><td align="center" style="padding:0;">

<!-- top rule -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background-color:#ffffff;">
  <tr>
    <td width="300" height="5" style="width:300px;height:5px;background-color:${NAVY};font-size:0;line-height:0;">&nbsp;</td>
    <td width="300" height="5" style="width:300px;height:5px;background-color:${RED};font-size:0;line-height:0;">&nbsp;</td>
  </tr>
</table>

<!-- masthead -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background-color:#ffffff;">
  <tr>
    <td align="center" style="padding:26px 30px 8px 30px;">
      ${logoUrl ? `<img src="${esc(safeUrl(logoUrl))}" width="170" alt="National Sports Apparel" style="display:block;width:170px;max-width:170px;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto;">`
    : `<div style="font-family:${DISPLAY};font-weight:bold;font-size:24px;letter-spacing:1.5px;color:${NAVY};text-transform:uppercase;">National Sports Apparel</div>`}
      <div style="font-family:${BODY_FONT};font-size:11px;line-height:16px;mso-line-height-rule:exactly;letter-spacing:2px;color:${RED};text-transform:uppercase;padding-top:8px;">&#9733;&nbsp; California's Largest Independent Team Dealer &nbsp;&#9733;</div>
    </td>
  </tr>
  <tr><td height="24" style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>
</table>

<!-- hero -->
${wrap(NAVY, `<div style="font-family:${DISPLAY};font-size:12px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:3px;color:${RED_LIGHT};text-transform:uppercase;font-weight:bold;">Order ${esc(order.id || '')}${shipDate ? DOT + 'Shipped ' + esc(shipDate) : ''}</div>
      ${rule(60, 4, RED)}
      <div class="h1" style="font-family:${DISPLAY};font-weight:bold;font-size:38px;line-height:40px;mso-line-height-rule:exactly;color:#ffffff;text-transform:uppercase;letter-spacing:0.5px;padding-top:14px;">Your Gear Is<br><em style="color:${RED_LIGHT};font-style:italic;">On The Way</em></div>
      <div style="font-family:${BODY_FONT};font-size:15px;line-height:24px;mso-line-height-rule:exactly;color:#D8DDE9;padding-top:14px;">${styleCount} style${styleCount === 1 ? '' : 's'} for ${esc(team)} left our shop in Orange, CA.${remainingUnits > 0 ? ' This is part of your order — the rest follows separately.' : ''} Everything below matches your approved mockups.</div>`, '34px 40px')}

<!-- carrier / ETA card -->
${wrap('#ffffff', `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:${PANEL};border:1px solid ${HAIRLINE};">
        <tr><td style="padding:22px 24px 20px 24px;">
          ${carrierLine ? `<div style="font-family:${DISPLAY};font-weight:bold;font-size:12px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:2px;color:${NAVY};text-transform:uppercase;">${carrierLine}</div>` : ''}
          ${eta ? `<div style="font-family:${BODY_FONT};font-size:14px;line-height:22px;mso-line-height-rule:exactly;color:#4A5468;padding-top:4px;">Estimated delivery <strong style="color:${NAVY};">${esc(eta)}</strong></div>` : ''}
          ${trackAll ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;"><tr>
            <td bgcolor="${RED}" style="background-color:${RED};border-radius:4px;">
              <a href="${esc(trackAll)}" style="display:block;padding:14px 30px;font-family:${DISPLAY};font-weight:bold;font-size:15px;line-height:18px;mso-line-height-rule:exactly;letter-spacing:2px;color:#ffffff;text-decoration:none;text-transform:uppercase;">Track ${boxCount > 1 ? 'All Boxes' : 'Your Box'}</a>
            </td></tr></table>` : ''}
        </td></tr>
      </table>`, '28px 40px 4px')}

${(shipToBlock || repBlock) ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background-color:#ffffff;">
  <tr><td class="pad" style="padding:24px 40px 0 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;"><tr>${shipToBlock}${repBlock}</tr></table>
  </td></tr>
  <tr><td class="pad" style="padding:8px 40px 0 40px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td height="1" style="height:1px;background-color:${HAIRLINE};font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
</table>` : ''}

<!-- items -->
${wrap('#ffffff', `<div style="font-family:${DISPLAY};font-weight:bold;font-size:22px;line-height:24px;mso-line-height-rule:exactly;letter-spacing:1px;color:${NAVY};text-transform:uppercase;">In This Shipment</div>
      ${rule(60, 4, RED)}`, '26px 40px 6px')}

${lines.map(itemRowHtml).join('\n')}

<!-- totals + per-box tracking -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background-color:#ffffff;">
  <tr>
    <td class="pad" style="padding:22px 40px 0 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:${NAVY};">
        <tr><td style="padding:18px 24px;font-family:${DISPLAY};font-weight:bold;font-size:16px;line-height:20px;mso-line-height-rule:exactly;letter-spacing:1.5px;color:#ffffff;text-transform:uppercase;">
          ${styleCount} style${styleCount === 1 ? '' : 's'}${DOT}${totalPieces} piece${totalPieces === 1 ? '' : 's'}${DOT}${boxCount} box${boxCount === 1 ? '' : 'es'}
        </td></tr>
      </table>
      ${remainingUnits > 0 ? `<div style="font-family:${BODY_FONT};font-size:13px;line-height:20px;mso-line-height-rule:exactly;color:${BODY_TEXT};padding-top:12px;"><strong style="color:${NAVY};">Still to come:</strong> ${remainingUnits} more piece${remainingUnits === 1 ? '' : 's'} from this order will ship separately — we'll email tracking when they do.</div>` : ''}
      ${boxCount ? `<div style="font-family:${DISPLAY};font-weight:bold;font-size:13px;line-height:16px;mso-line-height-rule:exactly;letter-spacing:2px;color:${MUTED};text-transform:uppercase;padding-top:22px;padding-bottom:8px;">Tracking By Box</div>
      ${packages.map((p) => boxRowHtml(p, boxCount)).join('\n')}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;"><tr><td height="1" style="height:1px;background-color:${HAIRLINE};font-size:0;line-height:0;">&nbsp;</td></tr></table>` : ''}
    </td>
  </tr>
  ${(portalUrl || reorderUrl) ? `<tr>
    <td class="pad" align="left" style="padding:22px 40px 0 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        ${buttonHtml(portalUrl, 'View Order In Portal', { fill: NAVY })}
        ${portalUrl && reorderUrl ? '<td width="12" style="width:12px;font-size:0;line-height:0;">&nbsp;</td>' : ''}
        ${buttonHtml(reorderUrl, 'Reorder', { outline: true })}
      </tr></table>
    </td>
  </tr>` : ''}
  ${(reviewUrl && remainingUnits <= 0) ? `<tr>
    <td class="pad" style="padding:24px 40px 0 40px;">
      <!-- Google review ask — only once the WHOLE order has shipped; a coach still
           waiting on half their gear is not the one to ask. -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:${PANEL};border:1px solid ${HAIRLINE};">
        <tr><td align="center" style="padding:20px 24px 22px 24px;">
          <div style="font-family:${DISPLAY};font-weight:bold;font-size:15px;line-height:19px;mso-line-height-rule:exactly;letter-spacing:1px;color:${NAVY};text-transform:uppercase;">Happy with how we did?</div>
          <div style="font-family:${BODY_FONT};font-size:13px;line-height:20px;mso-line-height-rule:exactly;color:${BODY_TEXT};padding-top:6px;">A quick Google review means a lot to our team &#8212; and helps other coaches find us.</div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:14px;"><tr>${buttonHtml(reviewUrl, '★ Leave us a Google review', { fill: RED })}</tr></table>
        </td></tr>
      </table>
    </td>
  </tr>` : ''}
  <tr>
    <td class="pad" style="padding:20px 40px 30px 40px;">
      <div style="font-family:${BODY_FONT};font-size:13px;line-height:21px;mso-line-height-rule:exactly;color:${BODY_TEXT};">Short a size or something not right? Reply to this email or call <a href="tel:+17142798777" style="color:${RED};text-decoration:none;">(714) 279-8777</a> — we respond within 24 hours.</div>
    </td>
  </tr>
</table>

<!-- footer -->
${wrap(FOOTER_NAVY, `<div style="font-family:${DISPLAY};font-weight:bold;font-size:16px;line-height:20px;mso-line-height-rule:exactly;letter-spacing:1.5px;color:#ffffff;text-transform:uppercase;">National Sports Apparel</div>
      ${rule(30, 3, RED)}
      <div style="font-family:${BODY_FONT};font-size:12px;line-height:20px;mso-line-height-rule:exactly;color:#A9B2C6;padding-top:12px;">2238 N Glassell St Ste E, Orange, CA 92865<br>Mon&#8211;Fri 7:00 AM&#8211;3:00 PM PT &#183; English &amp; Spanish<br><a href="mailto:hello@nationalsportsapparel.com" style="color:${RED_LIGHT};text-decoration:none;">hello@nationalsportsapparel.com</a></div>
      <div style="font-family:${BODY_FONT};font-size:11px;line-height:18px;mso-line-height-rule:exactly;color:#7A849B;padding-top:16px;">You're receiving this shipping notice because an order was placed for ${esc(team)}.${portalUrl ? ` <a href="${esc(safeUrl(portalUrl))}" style="color:#A9B2C6;text-decoration:underline;">Open your team portal</a>` : ''}</div>`, '30px 40px 28px')}

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;"><tr><td height="30" style="height:30px;font-size:0;line-height:0;">&nbsp;</td></tr></table>

</td></tr>
</table>
</body>
</html>`;

  return {
    subject: `Your ${team} order has shipped${order.id ? ` — ${order.id}` : ''}`,
    preheader,
    html,
  };
}

// A note for the REP, put above the coach's email in the rep's own copy — never
// in what the coach receives. `tone` 'info' is the routine "here's who got it"
// copy; 'warn' is the "this did NOT go out" alert. `lines` are plain text,
// escaped here; `strong` marks the one line to read first.
function repBannerHtml({ tone = 'info', title = '', lines = [] } = {}) {
  const warn = tone === 'warn';
  const bg = warn ? '#FDF2F2' : '#EEF3FB';
  const edge = warn ? RED : NAVY;
  const body = lines.filter((l) => String(l || '').trim()).map((l) => `<div style="padding-top:4px;">${esc(l)}</div>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${PANEL};">
<tr><td align="center" style="padding:16px 12px 0 12px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background-color:${bg};border-left:4px solid ${edge};">
    <tr><td style="padding:14px 18px;font-family:${BODY_FONT};font-size:13px;line-height:19px;mso-line-height-rule:exactly;color:${NAVY};">
      <div style="font-family:${DISPLAY};font-weight:bold;font-size:12px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;color:${edge};">${esc(title)}</div>
      ${body}
    </td></tr>
  </table>
</td></tr>
</table>`;
}

// The rep's copy: the coach's email, unchanged, with the rep banner on top.
function withRepBanner(html, banner) {
  const s = String(html || '');
  const m = s.match(/<body[^>]*>/i);
  return m ? s.replace(m[0], m[0] + '\n' + banner) : banner + s;
}

module.exports = {
  repBannerHtml,
  withRepBanner,
  buildSoShipmentEmail,
  buildShipmentLines,
  boxContents,
  remainingUnits,
  cleanProductName,
  pickMockupUrl,
  emailImageUrl,
  garmentMockKey,
  decorationSummary,
  orderedSizes,
  carrierLabel,
  trackingUrlFor,
  trackAllUrl,
};
