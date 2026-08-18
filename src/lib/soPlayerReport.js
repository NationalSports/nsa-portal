// Player report generated FROM the sales order — every player and exactly what they
// get, with each line resolved through the SO's CURRENT items. The OMG/webstore
// report shows what parents ordered; when the rep swaps an item on the SO (stock or
// speed), that report goes stale. This one is what gets sent to Silver Screen, so it
// must say what we are actually buying: lines whose product was changed on the SO
// print the SO's replacement item, marked "was <old sku>", and anything that can't
// be mapped confidently is flagged for a human instead of silently guessed.
//
// Data: the SO's shadow webstore (webstore_orders / webstore_order_items in
// Supabase). Orders are scoped to this SO when any carry so_id; otherwise the whole
// store is one SO (the OMG flow) and every order counts.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Same popup-print pattern as the Webstores reports — the rep prints or saves as PDF.
function printHtml(html) {
  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up blocked — allow pop-ups to print.'); return; }
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => { try { w.print(); } catch {} }, 350);
}

// RFC4180 quoting: wrap only when needed, double any embedded quote. Player and buyer names
// routinely carry commas ("Smith, Jr.") and the odd quote, and an unquoted one silently
// shifts every later column — a wrong size against a name is the failure mode here.
const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  // Leading BOM: without it Excel reads the file as ANSI and mangles accented names.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 1000);
}

// The item as it should be REPORTED — the SO's replacement when the rep swapped the product,
// the store's own data when nothing on the SO covers it. Shared by both outputs so the PDF
// and the CSV can never disagree about what a line says.
function lineFields(l) {
  return {
    name: l._unmatched ? (l.name || l.sku || 'Item') : (l._name || 'Item'),
    sku: l._unmatched ? (l.sku || '') : (l._sku || ''),
    color: l._color || '',
    size: l.size || '',
    qty: l.qty || 1,
    wasSku: l._wasSku || '',
    verify: !!l._verify,
    unmatched: !!l._unmatched,
  };
}

// Human order number for a store order. order_number is the webstore's own counter; OMG
// orders carry their number instead; the uuid is the last resort so a row is never anonymous.
const orderNo = (o) => String((o && (o.order_number || o.omg_order_number)) || (o && o.id) || '');

// One row per line item, ordered by order number — the CSV the warehouse sorts and bags from.
// Every row repeats its order's ship-to so a single line can be read on its own (the whole
// point of the flat file: filter to one player, still know where the box goes).
function renderCsv({ so, storeName, lines, orderById }) {
  const header = [
    'Order #', 'Order Date', 'Player', 'Player #', 'Buyer', 'Buyer Email', 'Buyer Phone',
    'Item', 'SKU', 'Color', 'Size', 'Qty', 'Was SKU', 'Flag',
    'Ship Method', 'Ship Name', 'Address 1', 'Address 2', 'City', 'State', 'Zip', 'Country',
  ];
  const rows = lines.map((l) => {
    const o = orderById[l.order_id] || {};
    const a = o.ship_address || {};
    const f = lineFields(l);
    return {
      // Sort keys: numeric order number when it is one, so 1010525 < 1010654 (a string sort
      // would put "1010654" before "99"); then player, so one order's rows stay together.
      _num: Number(orderNo(o)) || 0,
      _str: orderNo(o),
      _player: (l.player_name || '').trim().toLowerCase(),
      cells: [
        orderNo(o),
        o.created_at ? String(o.created_at).slice(0, 10) : '',
        (l.player_name || '').trim(),
        l.player_number != null ? String(l.player_number) : '',
        o.buyer_name || '', o.buyer_email || '', o.buyer_phone || '',
        f.name, f.sku, f.color, f.size, f.qty,
        f.wasSku,
        f.unmatched ? 'NOT ON SO — verify' : f.wasSku ? (f.verify ? 'substituted — verify' : 'substituted') : '',
        o.ship_method || '',
        a.name || o.buyer_name || '', a.street1 || '', a.street2 || '',
        a.city || '', a.state || '', a.zip || '', a.country || '',
      ],
    };
  });
  rows.sort((x, y) => (x._num - y._num) || x._str.localeCompare(y._str) || x._player.localeCompare(y._player));
  const stamp = new Date().toISOString().slice(0, 10);
  const safeStore = String(storeName || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  downloadCsv(['player-report', so.id, safeStore, stamp].filter(Boolean).join('_') + '.csv',
    [header, ...rows.map((r) => r.cells)]);
}

// Sale code out of an OMG SO memo ("OMG Store: … (V7ESK)") — fallback linkage for
// older SOs saved before webstore_id was stamped at creation.
export function omgCodeFromMemo(memo) {
  const m = (memo || '').match(/^\s*OMG Store:.*?\(([A-Z0-9]{4,8})\)/i);
  return m ? m[1] : '';
}

// Normalized size profile of a set of rows: {SIZE: qty}. The size curve is the
// strongest identity a product keeps through a swap — the rep changes WHAT we buy,
// not who ordered which size.
const norm = (s) => String(s || 'OS').trim().toUpperCase();
function sizeProfile(rows, get) {
  const p = {};
  rows.forEach((r) => { const { size, qty } = get(r); p[norm(size)] = (p[norm(size)] || 0) + (Number(qty) || 0); });
  return p;
}
// Overlap score in [0,1]: shared units / the larger side's units. 1 = identical curve.
function profileScore(a, b) {
  let shared = 0, ta = 0, tb = 0;
  Object.entries(a).forEach(([s, q]) => { ta += q; shared += Math.min(q, b[s] || 0); });
  Object.values(b).forEach((q) => { tb += q; });
  const denom = Math.max(ta, tb);
  return denom > 0 ? shared / denom : 0;
}

// Map every store line to the SO item that covers it today.
//  1. sku match (case-insensitive)  — product unchanged (SO rows grouped by sku, so a
//     product split across size-run/colorway rows still matches).
//  2. product_id match              — SKU edited on the same product row.
//     A match from 1 or 2 only holds while the SO line still carries some of the
//     sizes that were ordered; zeroed out, it is released to 3 (the swap-by-adding-
//     a-new-line case), and taken back if 3 finds nothing.
//  3. size-curve pairing            — store products with no match paired with SO
//     sku+colorway groups no line claimed, best size-profile overlap first: the
//     in-place swap case (verified live against St. Francis XC: HR8470/HR8472 →
//     AT203 black/red resolve by curve, JW6620 → AT216, 5144381 → 5160078).
//     A pairing whose curves don't fully agree carries verify:true.
//  Anything still unmatched keeps its original data and is flagged for review.
export function mapLinesToSoItems(lines, soItems) {
  // SO side, grouped by sku (blank-sku customs key by name), with per-colorway subgroups.
  const soGroups = {}; const soOrder = [];
  (soItems || []).forEach((it) => {
    const sku = (it.sku || '').trim();
    const key = (sku || (it.name || it.custom_desc || '')).toLowerCase();
    if (!key) return;
    const g = soGroups[key] || (soGroups[key] = { sku, name: it.name || it.custom_desc || '', pids: new Set(), colorways: [] });
    if (!soGroups[key]._seen) { soOrder.push(key); soGroups[key]._seen = true; }
    if (it.product_id) g.pids.add(it.product_id);
    if (!g.name) g.name = it.name || it.custom_desc || '';
    const color = (it.color || '').trim();
    let cw = g.colorways.find((c) => c.color.toLowerCase() === color.toLowerCase());
    if (!cw) { cw = { color, profile: {} }; g.colorways.push(cw); }
    Object.entries(it.sizes || {}).forEach(([s, q]) => { cw.profile[norm(s)] = (cw.profile[norm(s)] || 0) + (Number(q) || 0); });
  });
  // Store side, grouped by sku (or product id / name when sku is blank).
  const groups = {}; const order = [];
  lines.forEach((l) => {
    const k = ((l.sku || '').trim() || l.product_id || (l.name || '').trim()).toLowerCase();
    if (!groups[k]) { groups[k] = { lines: [], sku: l.sku || '', product_id: l.product_id || null, name: l.name || '' }; order.push(k); }
    groups[k].lines.push(l);
    if (!groups[k].name && l.name) groups[k].name = l.name;
  });
  order.forEach((k) => {
    const g = groups[k];
    let key = (g.sku || '').trim().toLowerCase();
    if (!soGroups[key] && g.product_id) key = soOrder.find((sk) => soGroups[sk].pids.has(g.product_id)) || '';
    if (soGroups[key]) { g.so = soGroups[key]; g.soKey = key; g.matched = 'direct'; }
  });
  // A surviving sku is not proof the SO still buys it. Reps swap an item by zeroing
  // the old line's sizes and adding the replacement, so the old sku sits on the SO
  // covering nothing that was ordered (live: St. Francis Tennis SO-2035 — 1203.080
  // left at L:1 while all 36 S + 12 M moved to a new 1202 line). When the matched SO
  // line has none of the ordered sizes left, re-open the group for the swap pairing
  // below; unpaired groups get this match back, so a size-label difference between
  // store and SO can never turn into a false "not on the SO" flag.
  order.forEach((k) => {
    const g = groups[k];
    if (!g.so) return;
    const covered = {};
    g.so.colorways.forEach((cw) => Object.entries(cw.profile).forEach(([s, q]) => { covered[s] = (covered[s] || 0) + q; }));
    if (profileScore(sizeProfile(g.lines, (l) => ({ size: l.size, qty: l.qty || 1 })), covered) === 0) { g.released = true; g.so = null; g.matched = null; }
  });
  const claimed = new Set();
  order.forEach((k) => { if (groups[k].so) claimed.add(groups[k].soKey); });
  // Swap pairing: every unmatched store product scored against every unclaimed SO
  // colorway by size-curve overlap, best pair claimed first. Colorways are the unit
  // (two store hoodies can both become one SKU in two colors); each is claimed once.
  const looseGroups = order.map((k) => groups[k]).filter((g) => !g.so);
  const looseCws = [];
  soOrder.forEach((k) => { if (!claimed.has(k)) soGroups[k].colorways.forEach((cw) => looseCws.push({ key: k, g: soGroups[k], cw })); });
  const cands = [];
  looseGroups.forEach((g, gi) => {
    const prof = sizeProfile(g.lines, (l) => ({ size: l.size, qty: l.qty || 1 }));
    // A released group still has its own line on the SO, so re-homing it is the
    // stronger claim: it needs a curve that mostly agrees, not just any overlap.
    looseCws.forEach((t, ti) => { const s = profileScore(prof, t.cw.profile); if (g.released ? s >= 0.5 : s > 0) cands.push({ gi, ti, s }); });
  });
  cands.sort((a, b) => b.s - a.s || a.gi - b.gi);
  const gDone = new Set(); const tDone = new Set();
  cands.forEach((c) => {
    if (gDone.has(c.gi) || tDone.has(c.ti)) return;
    gDone.add(c.gi); tDone.add(c.ti);
    const g = looseGroups[c.gi]; const t = looseCws[c.ti];
    g.so = t.g; g.soColor = t.cw.color; g.matched = 'swap'; g.verify = c.s < 1;
  });
  // Nothing to swap to — the sku match stands, exactly as it did before the release.
  order.forEach((k) => { const g = groups[k]; if (g.released && !g.so) { g.so = soGroups[g.soKey]; g.matched = 'direct'; } });
  const substitutions = []; const unmatched = [];
  const out = [];
  order.forEach((k) => {
    const g = groups[k];
    g.lines.forEach((l) => {
      if (!g.so) { out.push({ ...l, _unmatched: true }); return; }
      const changed = g.matched === 'swap' || (g.so.sku.trim().toLowerCase() !== (l.sku || '').trim().toLowerCase());
      // Color: the paired colorway on a swap; a direct match keeps the line's own color
      // unless the SO group has exactly one (covers a color correction on the SO).
      const color = g.matched === 'swap' ? (g.soColor || '')
        : (g.so.colorways.length === 1 ? (g.so.colorways[0].color || l.color || '') : (l.color || ''));
      out.push({ ...l, _sku: g.so.sku, _name: g.so.name || l.name || '', _color: color, _wasSku: changed ? (l.sku || '') : '', _verify: !!g.verify });
    });
    if (g.so && g.matched === 'swap') substitutions.push({ from: g.sku || g.name, to: (g.so.sku || g.so.name) + (g.soColor ? ' ' + g.soColor : ''), verify: !!g.verify });
    if (!g.so) unmatched.push(g.sku || g.name);
  });
  return { lines: out, substitutions, unmatched };
}

// Chunked fetch of all line items for a set of order ids (id lists too long for one
// `in()` are split — same reason Webstores chunks this).
async function fetchLines(supabase, orderIds) {
  const all = [];
  for (let i = 0; i < orderIds.length; i += 100) {
    const { data, error } = await supabase.from('webstore_order_items').select('*').in('order_id', orderIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    all.push(...(data || []));
  }
  return all.filter((l) => !l.is_bundle_parent);
}

// Fetch → remap → print. so: the live editor's order object (its items are the truth,
// unsaved edits included). Returns true when a report was produced.
// format: 'pdf' (default — the printable per-player sheet) | 'csv' (flat one-row-per-line
// file, ordered by order number, ship-to repeated on every row).
export async function downloadSoPlayerReport({ so, soItems, supabase, nf, format = 'pdf' }) {
  const toast = nf || ((m) => alert(m));
  if (!supabase) { toast('No database connection — player report needs the store orders.', 'error'); return false; }
  try {
    let ws = null;
    if (so.webstore_id) {
      const { data } = await supabase.from('webstores').select('id,name,omg_sale_code').eq('id', so.webstore_id).maybeSingle();
      ws = data || null;
    }
    if (!ws) {
      const code = omgCodeFromMemo(so.memo);
      if (code) {
        const { data } = await supabase.from('webstores').select('id,name,omg_sale_code').eq('omg_sale_code', code).maybeSingle();
        ws = data || null;
      }
    }
    if (!ws) { toast('No linked store found for ' + so.id + ' — import the player report on the OMG page first.', 'error'); return false; }
    const { data: orders, error: oErr } = await supabase.from('webstore_orders').select('*').eq('store_id', ws.id);
    if (oErr) throw new Error(oErr.message);
    // Cancelled and never-paid orders don't ship, so they never print (seen live:
    // St. Francis XC carries 2 cancelled + 3 pending_payment beside its 23 real orders).
    const live = (orders || []).filter((o) => !/^(cancelled|canceled|pending_payment|refunded)$/i.test(o.status || ''));
    // Scope to this SO when the store batches into several; an OMG store whose orders
    // never got so_id stamped — or a store whose so_id links went stale (also seen
    // live: orders pointing at a renumbered SO) — is all one SO, so everything counts.
    const mine = live.filter((o) => o.so_id === so.id);
    const scoped = mine.length > 0 ? mine : live;
    if (scoped.length === 0) { toast('No store orders imported yet for ' + (ws.name || so.id) + '.', 'error'); return false; }
    const rawLines = await fetchLines(supabase, scoped.map((o) => o.id));
    const orderById = {}; scoped.forEach((o) => { orderById[o.id] = o; });
    const { lines, substitutions, unmatched } = mapLinesToSoItems(rawLines.filter((l) => orderById[l.order_id]), soItems);
    if (format === 'csv') renderCsv({ so, storeName: ws.name || '', lines, orderById });
    else renderReport({ so, storeName: ws.name || '', lines, orderById, substitutions, unmatched });
    return true;
  } catch (e) {
    toast('Player report failed: ' + (e?.message || 'unknown error'), 'error');
    return false;
  }
}

// One block per player — same layout language as the Webstores player report, plus
// the substitution banner and per-line "was <sku>" markers.
function renderReport({ so, storeName, lines, orderById, substitutions, unmatched }) {
  const players = {};
  lines.forEach((l) => {
    const o = orderById[l.order_id] || {};
    const nm = (l.player_name || '').trim();
    const num = (l.player_number != null ? String(l.player_number) : '').trim();
    const key = (nm || num) ? (nm.toLowerCase() + '|' + num) : ('buyer:' + (o.buyer_email || o.buyer_name || l.order_id));
    const p = players[key] || (players[key] = { label: nm || (o.buyer_name ? o.buyer_name + ' (buyer)' : 'Unassigned'), number: num, units: 0, items: [] });
    p.units += (l.qty || 1);
    p.items.push({ ...lineFields(l), buyer: o.buyer_name || '' });
  });
  const list = Object.values(players).sort((a, b) => a.label.localeCompare(b.label));
  const totalUnits = list.reduce((a, p) => a + p.units, 0);
  const chip = (n, l) => `<div class="chip"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const row = (it) => `<tr${it.unmatched ? ' class="warnrow"' : ''}><td>${esc(it.name)}${it.sku ? `<div class="sub">${esc(it.sku)}${it.color ? ' · ' + esc(it.color) : ''}</div>` : ''}${it.wasSku ? `<div class="was">↺ was ${esc(it.wasSku)}${it.verify ? ' — verify' : ''}</div>` : ''}${it.unmatched ? '<div class="was">⚠ not on the SO — verify</div>' : ''}</td><td class="c">${esc(it.size)}</td><td class="c b">${it.qty}</td><td>${esc(it.buyer)}</td></tr>`;
  const block = (p) => `<div class="ord"><div class="oh">${esc(p.label)}${p.number ? ` <span class="num">#${esc(p.number)}</span>` : ''}<span class="dt">${p.units} item${p.units === 1 ? '' : 's'}</span></div>
    <table class="grid"><thead><tr><th>Item</th><th class="c">Size</th><th class="c">Qty</th><th>Buyer</th></tr></thead><tbody>${p.items.map(row).join('')}</tbody></table></div>`;
  const subBanner = substitutions.length || unmatched.length ? `<div class="warn"><b>Item changes on ${esc(so.id)}:</b><br>${
    substitutions.map((s) => `↺ ${esc(s.from)} → <b>${esc(s.to)}</b>${s.verify ? ' <i>(best guess — verify)</i>' : ''}`).join('<br>')
  }${unmatched.length ? (substitutions.length ? '<br>' : '') + unmatched.map((u) => `⚠ ${esc(u)} — ordered in the store but not on the SO`).join('<br>') : ''}</div>` : '';
  printHtml(`<!doctype html><html><head><title>Player report — ${esc(so.id)}</title><style>
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220;max-width:760px;margin:32px auto;padding:0 24px}
    h1{font-size:21px;margin:0 0 2px}.meta{color:#64748b;font-size:13px;margin-bottom:16px}
    .chips{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 4px}
    .chip{flex:1;min-width:96px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
    .chip .n{font-size:22px;font-weight:900}.chip .l{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.3px;margin-top:2px}
    table.grid{width:100%;border-collapse:collapse;font-size:13px}
    .grid th{text-align:left;border-bottom:1px solid #cbd5e1;padding:6px 8px;color:#64748b;font-size:11px;text-transform:uppercase}
    .grid td{padding:7px 8px;border-bottom:1px solid #f1f5f9}.grid td.c{text-align:center}.grid td.b{font-weight:800}
    .sub{font-size:11px;color:#94a3b8}.was{font-size:11px;color:#b45309;font-weight:700}
    .warnrow td{background:#fffbeb}
    .ord{border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;margin-bottom:10px;break-inside:avoid}
    .oh{font-weight:800;font-size:14px;margin-bottom:6px}.oh .num{color:#2563eb}.oh .dt{float:right;color:#94a3b8;font-weight:600;font-size:12px}
    .warn{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:13px;line-height:1.7;margin:0 0 14px}
  </style></head><body>
    <h1>Player Report</h1>
    <div class="meta">${esc(storeName)} · ${esc(so.id)} — items as on the sales order · ${new Date().toLocaleString()}</div>
    <div class="chips">${chip(list.length, 'Players')}${chip(totalUnits, 'Items')}${substitutions.length ? chip(substitutions.length, 'Items changed') : ''}</div>
    ${subBanner}
    ${list.map(block).join('') || '<div class="meta">No orders.</div>'}
  </body></html>`);
}
