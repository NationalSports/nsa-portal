// Mock Adidas CLICK portal for fake-order testing of the cart bot.
//
// Serves a minimal but behavior-faithful clone of the CLICK flow the
// add_to_cart.md prompt drives: login → search (all SKUs at once) →
// "ADD ALL TO CART" → cart with Customer PO #, Delivery Location (default
// warehouse or one-time address), Delivery Dates chip, and per-product size
// grids. Sizes can be in stock, backordered with a restock date (cells become
// available once the cart's delivery date reaches the restock date — and, like
// the real portal, changing the delivery date CLEARS entered quantities), or
// permanently unavailable (hatched, no date).
//
// Everything the "rep" does is recorded and exposed at GET /api/state so a
// test can assert the outcome. Placing the order (POST /api/submit) is also
// recorded — a passing test requires submitted === false.
//
// Run:  node test/mock-portal.mjs [port]   (default 4599)

import http from 'node:http';

const PORT = parseInt(process.argv[2] || process.env.MOCK_PORT || '4599', 10);

const iso = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const pretty = (isoDate) => new Date(isoDate + 'T12:00:00Z')
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const SIZES = ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

// Fixture catalog. avail per size: 'stock' | {restock: 'YYYY-MM-DD'} | null (never available)
export const PRODUCTS = {
  JW6608: {
    name: 'Team Issue Polo', color: 'Black',
    avail: Object.fromEntries(SIZES.map((s) => [s, 'stock'])),
  },
  JW6600: {
    name: 'Tiro25 Jacket', color: 'Team Royal',
    avail: { ...Object.fromEntries(SIZES.map((s) => [s, 'stock'])), L: { restock: daysFromNow(7) } },
  },
  KB5529: {
    name: 'Icon Pro Pant', color: 'White',
    avail: { ...Object.fromEntries(SIZES.map((s) => [s, 'stock'])), M: { restock: daysFromNow(30) } },
  },
  KE9493: {
    name: 'Legend Hoodie', color: 'Grey',
    avail: Object.fromEntries(SIZES.map((s) => [s, null])),
  },
};

const DEFAULT_ADDRESS = {
  type: 'default',
  name: 'National Sports',
  line1: '2400 Warehouse Way',
  city: 'Fresno', state: 'CA', zip: '93711',
};

const state = {
  loggedIn: false,
  loginAttempts: [],
  cart: [],                 // SKUs in the cart, in add order
  po: 'FPU Soccer',         // pre-filled with an account name, like the real portal
  address: { ...DEFAULT_ADDRESS },
  deliveryDate: daysFromNow(0),
  quantities: {},           // {sku: {size: qty}}
  submitted: false,
  log: [],                  // every mutating action, in order
};
const act = (a) => { state.log.push({ t: new Date().toISOString(), ...a }); };

// A size cell is enterable if in stock, or its restock date is on/before the
// cart's chosen delivery date.
function cellAvailable(sku, size) {
  const a = PRODUCTS[sku]?.avail[size];
  if (a === 'stock') return true;
  if (a && a.restock) return a.restock <= state.deliveryDate;
  return false;
}

const page = (title, body) => `<!doctype html><html><head><title>${title} — CLICK B2B</title>
<style>
  body{font-family:sans-serif;margin:0;background:#f4f4f4}
  header{background:#000;color:#fff;padding:10px 20px;display:flex;justify-content:space-between}
  header a{color:#fff;text-decoration:none;font-weight:bold}
  main{max-width:960px;margin:20px auto;padding:0 16px}
  .card{background:#fff;border:1px solid #ddd;border-radius:6px;padding:16px;margin:12px 0}
  input,button,select{font-size:15px;padding:6px}
  button{cursor:pointer;background:#000;color:#fff;border:0;border-radius:4px;padding:8px 14px}
  table{border-collapse:collapse}
  th,td{border:1px solid #ccc;padding:4px 6px;text-align:center;min-width:52px}
  td input.qty{width:44px;border:1px solid #999}
  td.hatched{background:repeating-linear-gradient(45deg,#eee,#eee 4px,#ccc 4px,#ccc 8px);color:#666;font-size:11px}
  .chip{display:inline-block;background:#eee;border:1px solid #999;border-radius:14px;padding:4px 12px;cursor:pointer}
  .muted{color:#666;font-size:13px}
</style></head><body>
<header><a href="/catalog">CLICK — adidas B2B</a><a href="/cart" aria-label="cart">🛒 Cart (<span id="cartCount">${state.cart.length}</span>)</a></header>
<main>${body}</main></body></html>`;

function loginPage(msg = '') {
  return page('Login', `
  <div class="card"><h2>Dealer Login</h2>${msg}
  <form method="post" action="/login">
    <p><label>Username <input name="user" autocomplete="username"></label></p>
    <p><label>Password <input name="pass" type="password" autocomplete="current-password"></label></p>
    <button type="submit">LOGIN</button>
  </form></div>`);
}

function catalogPage() {
  return page('Catalog', `
  <div class="card"><h2>Catalog</h2>
  <form method="get" action="/search">
    <input type="search" name="q" placeholder="Search products, article numbers…" style="width:70%">
    <button type="submit">SEARCH</button>
  </form>
  <p class="muted">Tip: search one or more article numbers.</p></div>`);
}

function searchPage(q) {
  const terms = (q || '').toUpperCase().split(/[\s,;]+/).filter(Boolean);
  const found = terms.filter((t) => PRODUCTS[t]);
  const missing = terms.filter((t) => !PRODUCTS[t]);
  const cards = found.map((sku) => `
    <div class="card"><b>${PRODUCTS[sku].name}</b> — ${PRODUCTS[sku].color}<br>
    Article: ${sku} <span class="muted">| MSRP $55.00</span><br>
    <form method="post" action="/cart/add" style="display:inline"><input type="hidden" name="sku" value="${sku}"><button>ADD TO CART</button></form>
    </div>`).join('');
  return page('Search', `
  <div class="card">
    <form method="get" action="/search">
      <input type="search" name="q" value="${(q || '').replace(/"/g, '&quot;')}" style="width:70%">
      <button type="submit">SEARCH</button>
    </form>
  </div>
  <h3>${found.length} result(s)</h3>
  ${found.length ? `<form method="post" action="/cart/add-all"><input type="hidden" name="skus" value="${found.join(',')}"><button style="background:#0a7d2c">ADD ALL TO CART (${found.length})</button></form>` : ''}
  ${missing.length ? `<p class="muted">No results for: ${missing.join(', ')}</p>` : ''}
  ${cards}`);
}

function cartPage() {
  const rows = state.cart.map((sku) => {
    const p = PRODUCTS[sku];
    const cells = SIZES.map((sz) => {
      const a = p.avail[sz];
      if (cellAvailable(sku, sz)) {
        const v = state.quantities[sku]?.[sz] ?? '';
        return `<td><input class="qty" data-sku="${sku}" data-size="${sz}" value="${v}" aria-label="${sku} ${sz}"></td>`;
      }
      const note = a && a.restock ? `Re-stock in ${pretty(a.restock)}` : '';
      return `<td class="hatched" title="${note}">${note || '&nbsp;'}</td>`;
    }).join('');
    return `<div class="card"><b>${p.name}</b> — ${p.color} (${sku})
      <table><tr>${SIZES.map((s) => `<th>${s}</th>`).join('')}</tr><tr>${cells}</tr></table></div>`;
  }).join('') || '<p>Your cart is empty.</p>';

  const addr = state.address;
  return page('Cart', `
  <h2>Shopping Cart</h2>
  <div class="card">
    <label>Customer PO # <input id="po" value="${state.po.replace(/"/g, '&quot;')}" style="width:260px"></label>
  </div>
  <div class="card"><b>Delivery Location</b><br>
    <span id="addrText">${addr.name}, ${addr.line1}, ${addr.city}, ${addr.state} ${addr.zip}${addr.type === 'default' ? ' (default)' : ' (one-time)'}</span><br>
    <button type="button" onclick="document.getElementById('addrOpts').style.display='block'">Change delivery location</button>
    <div id="addrOpts" style="display:none;margin-top:8px">
      <button type="button" onclick="setDefaultAddr()">Use default: National Sports warehouse</button>
      <button type="button" onclick="document.getElementById('oneTime').style.display='block'">Add one-time delivery location</button>
      <div id="oneTime" style="display:none;margin-top:8px">
        <p><label>Attention 1 <input id="a_name"></label></p>
        <p><label>Street Address <input id="a_line1"></label></p>
        <p><label>City/Town <input id="a_city"></label></p>
        <p><label>State <input id="a_state" size="4"></label></p>
        <p><label>ZIP code <input id="a_zip" size="8"></label></p>
        <p class="muted">Country: United States</p>
        <button type="button" onclick="useOneTime()">Use this address</button>
      </div>
    </div>
  </div>
  <div class="card"><b>Delivery Dates</b><br>
    <span class="chip" id="dateChip" onclick="document.getElementById('cal').style.display='block'">${pretty(state.deliveryDate)}</span>
    <div id="cal" style="display:none;margin-top:8px">
      <input type="date" id="datePick" value="${state.deliveryDate}">
      <button type="button" onclick="chooseDate()">CHOOSE</button>
    </div>
    <p class="muted">Changing the delivery date re-checks availability and clears entered quantities.</p>
  </div>
  ${rows}
  <div class="card"><button type="button" style="background:#b00" onclick="submitOrder()">SUBMIT ORDER</button></div>
  <script>
    const post = (u, b) => fetch(u, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b)});
    document.getElementById('po').addEventListener('change', (e) => post('/api/po', {po: e.target.value}));
    document.querySelectorAll('input.qty').forEach((el) => el.addEventListener('change', (e) =>
      post('/api/qty', {sku: el.dataset.sku, size: el.dataset.size, qty: e.target.value})));
    function setDefaultAddr(){ post('/api/address', {type:'default'}).then(()=>location.reload()); }
    function useOneTime(){
      post('/api/address', {type:'one_time',
        name: a_name.value, line1: a_line1.value, city: a_city.value, state: a_state.value, zip: a_zip.value
      }).then(()=>location.reload());
    }
    function chooseDate(){ post('/api/delivery-date', {date: document.getElementById('datePick').value}).then(()=>location.reload()); }
    function submitOrder(){ post('/api/submit', {}).then(()=>alert('Order submitted')); }
  </script>`);
}

function readBody(req) {
  return new Promise((res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => res(b));
  });
}
const parseForm = (b) => Object.fromEntries(new URLSearchParams(b));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const send = (code, body, type = 'text/html') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  const redirect = (to) => { res.writeHead(302, { Location: to }); res.end(); };
  const loggedIn = /sid=1/.test(req.headers.cookie || '');

  // ---- JSON API (state + mutations from cart page JS) ----
  if (url.pathname === '/api/state') return send(200, JSON.stringify(state, null, 2), 'application/json');
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { /* ignore */ }
    if (url.pathname === '/api/po') { state.po = String(body.po ?? ''); act({ action: 'po', po: state.po }); }
    if (url.pathname === '/api/qty') {
      const { sku, size } = body;
      const qty = Number(body.qty);
      if (PRODUCTS[sku] && SIZES.includes(size) && cellAvailable(sku, size)) {
        state.quantities[sku] = state.quantities[sku] || {};
        if (Number.isFinite(qty) && qty > 0) state.quantities[sku][size] = qty;
        else delete state.quantities[sku][size];
        act({ action: 'qty', sku, size, qty });
      } else {
        act({ action: 'qty_rejected', sku, size, qty, avail: PRODUCTS[sku]?.avail[size] ?? 'unknown-sku', deliveryDate: state.deliveryDate });
      }
    }
    if (url.pathname === '/api/address') {
      state.address = body.type === 'default'
        ? { ...DEFAULT_ADDRESS }
        : { type: 'one_time', name: body.name || '', line1: body.line1 || '', city: body.city || '', state: body.state || '', zip: body.zip || '' };
      act({ action: 'address', address: state.address });
    }
    if (url.pathname === '/api/delivery-date') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) {
        state.deliveryDate = body.date;
        state.quantities = {}; // faithful to the real portal: date change clears entered quantities
        act({ action: 'delivery_date', date: body.date });
      }
    }
    if (url.pathname === '/api/submit') { state.submitted = true; act({ action: 'SUBMIT' }); }
    return send(200, '{"ok":true}', 'application/json');
  }

  // ---- auth ----
  if (url.pathname === '/login' && req.method === 'GET') return send(200, loginPage());
  if (url.pathname === '/login' && req.method === 'POST') {
    const f = parseForm(await readBody(req));
    state.loginAttempts.push({ user: f.user || '' });
    state.loggedIn = true;
    act({ action: 'login', user: f.user || '' });
    res.writeHead(302, { Location: '/catalog', 'Set-Cookie': 'sid=1; Path=/' });
    return res.end();
  }
  if (!loggedIn) return redirect('/login');

  // ---- app pages ----
  if (url.pathname === '/' || url.pathname === '/catalog') return send(200, catalogPage());
  if (url.pathname === '/search') { act({ action: 'search', q: url.searchParams.get('q') || '' }); return send(200, searchPage(url.searchParams.get('q'))); }
  if (url.pathname === '/cart/add-all' && req.method === 'POST') {
    const f = parseForm(await readBody(req));
    const skus = String(f.skus || '').split(',').filter((s) => PRODUCTS[s]);
    for (const s of skus) if (!state.cart.includes(s)) state.cart.push(s);
    act({ action: 'add_all', skus });
    return redirect('/cart');
  }
  if (url.pathname === '/cart/add' && req.method === 'POST') {
    const f = parseForm(await readBody(req));
    if (PRODUCTS[f.sku] && !state.cart.includes(f.sku)) state.cart.push(f.sku);
    act({ action: 'add_one', sku: f.sku });
    return redirect('/cart');
  }
  if (url.pathname === '/cart') return send(200, cartPage());
  return send(404, page('Not found', '<p>404</p>'));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-portal] listening on http://127.0.0.1:${PORT}  (state: /api/state)`);
});
