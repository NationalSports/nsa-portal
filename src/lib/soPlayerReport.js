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

// Sale code out of an OMG SO memo ("OMG Store: … (V7ESK)") — fallback linkage for
// older SOs saved before webstore_id was stamped at creation.
export function omgCodeFromMemo(memo) {
  const m = (memo || '').match(/^\s*OMG Store:.*?\(([A-Z0-9]{4,8})\)/i);
  return m ? m[1] : '';
}

// Map every store line to the SO item that covers it today.
//  1. sku match (case-insensitive)  — item unchanged (name/color edits still show).
//  2. product_id match              — SKU edited on the same product.
//  3. leftover pairing              — store products with no match paired, in order,
//     with SO items no line claimed: the in-place swap case. Marked "substituted".
//  Anything still unmatched keeps its original data and is flagged for review.
export function mapLinesToSoItems(lines, soItems) {
  const items = (soItems || []).map((it, idx) => ({ idx, sku: it.sku || '', name: it.name || it.custom_desc || '', color: it.color || '', product_id: it.product_id || null }));
  const bySku = {}; const byPid = {};
  items.forEach((it) => {
    const k = it.sku.trim().toLowerCase();
    if (k && bySku[k] === undefined) bySku[k] = it.idx;
    if (it.product_id && byPid[it.product_id] === undefined) byPid[it.product_id] = it.idx;
  });
  // Group lines by their store product identity so a swap maps the whole group at once.
  const groups = {}; const order = [];
  lines.forEach((l) => {
    const k = (l.sku || '').trim().toLowerCase() + '|' + (l.product_id || '') + '|' + (l.name || '').trim().toLowerCase();
    if (!groups[k]) { groups[k] = { lines: [], sku: l.sku || '', product_id: l.product_id || null, name: l.name || '' }; order.push(k); }
    groups[k].lines.push(l);
  });
  const claimed = new Set();
  order.forEach((k) => {
    const g = groups[k];
    let idx = bySku[g.sku.trim().toLowerCase()];
    if (idx === undefined && g.product_id) idx = byPid[g.product_id];
    if (idx !== undefined) { g.item = items[idx]; g.matched = 'direct'; claimed.add(idx); }
  });
  // Leftovers: unmatched groups ↔ unclaimed SO items, paired in order. One-to-one is
  // the confident swap case; with several on both sides the pairing is a guess, so
  // those lines carry verify:true and the report says so out loud.
  const looseGroups = order.map((k) => groups[k]).filter((g) => !g.item);
  const looseItems = items.filter((it) => !claimed.has(it.idx));
  const ambiguous = looseGroups.length > 1 && looseItems.length > 1;
  looseGroups.forEach((g, i) => {
    if (looseItems[i]) { g.item = looseItems[i]; g.matched = 'swap'; g.verify = ambiguous; }
  });
  const substitutions = []; const unmatched = [];
  const out = [];
  order.forEach((k) => {
    const g = groups[k];
    g.lines.forEach((l) => {
      if (!g.item) { out.push({ ...l, _unmatched: true }); return; }
      const changed = g.matched === 'swap' || (g.item.sku.trim().toLowerCase() !== (l.sku || '').trim().toLowerCase());
      out.push({ ...l, _sku: g.item.sku, _name: g.item.name || l.name || '', _color: g.item.color, _wasSku: changed ? (l.sku || '') : '', _verify: !!g.verify });
    });
    if (g.item && g.matched === 'swap') substitutions.push({ from: g.sku || g.name, to: g.item.sku || g.item.name, verify: !!g.verify });
    if (!g.item) unmatched.push(g.sku || g.name);
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
export async function downloadSoPlayerReport({ so, soItems, supabase, nf }) {
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
    // Scope to this SO when the store batches into several; an OMG store whose orders
    // never got so_id stamped is all one SO, so everything counts.
    const mine = (orders || []).filter((o) => o.so_id === so.id);
    const scoped = mine.length > 0 ? mine : (orders || []);
    if (scoped.length === 0) { toast('No store orders imported yet for ' + (ws.name || so.id) + '.', 'error'); return false; }
    const rawLines = await fetchLines(supabase, scoped.map((o) => o.id));
    const orderById = {}; scoped.forEach((o) => { orderById[o.id] = o; });
    const { lines, substitutions, unmatched } = mapLinesToSoItems(rawLines.filter((l) => orderById[l.order_id]), soItems);
    renderReport({ so, storeName: ws.name || '', lines, orderById, substitutions, unmatched });
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
    p.items.push({
      name: l._unmatched ? (l.name || l.sku || 'Item') : (l._name || 'Item'),
      sku: l._unmatched ? (l.sku || '') : (l._sku || ''),
      color: l._color || '', size: l.size || '', qty: l.qty || 1,
      wasSku: l._wasSku || '', verify: !!l._verify, unmatched: !!l._unmatched,
      buyer: o.buyer_name || '',
    });
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
