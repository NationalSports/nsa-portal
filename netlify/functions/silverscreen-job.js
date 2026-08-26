// Silver Screen portal job creation — logs into the Silver Screen Printing account
// portal (portal.silverscreenprinting.com, Rails/Turbo + devise) and creates an order
// ("job") for an NSA deco PO, carrying the PO number VERBATIM. Silver Screen echoes
// that string on their invoice's P.O. NUMBER cell, and the bill parser
// (_parseSilverScreenBill in src/App.js) matches invoices back to deco POs by it —
// so the po_id must never be reformatted here.
//
// Called from the Deco PO full page ("Send to Silver Screen" button). The client
// sends the covered items itself (the editor may hold unsaved edits, so the DB copy
// can be stale — the on-screen numbers are the truth the rep confirmed).
//
// Env: SILVERSCREEN_USERNAME, SILVERSCREEN_PASSWORD, SILVERSCREEN_SALES_REP_ID
// (defaults to 2322 — Steve's rep id on their portal).
//
// The order form lives behind the login, so its exact field names have never been
// observed. Strategy: fetch the live form, keep every hidden field it carries
// (CSRF token, rails nested defaults), then assign our values to visible fields by
// name pattern. Anything we can't place structurally (item lines, art notes) goes
// into the first textarea as a formatted job sheet, so ALL item data reaches Silver
// Screen even before the field map is confirmed. POST { action:'discover' } returns
// the parsed form schema; { dry_run:true } on create returns exactly what would be
// posted without posting.
const { corsHeaders, verifyUser, getSupabaseAdmin } = require('./_shared');

const BASE = 'https://portal.silverscreenprinting.com';

// Send Silver Screen the number that is actually ON the garment.
//
// We buy adidas Team goods through S&S under S&S style numbers (AT101-50), and S&S
// ships them without re-tagging — the piece that lands at the decorator carries
// adidas' own article number (JX4452). Sending our purchase style meant their
// packing slip never matched the tag, so nobody could confirm a piece was right
// (Trinity Lyle, 2026-08-25). We swap in the adidas article and keep the S&S style
// alongside it, so the paperwork matches the tag AND still ties back to our PO.
//
// rank = 1 is the article we are most likely shipping (the one we hold most of in
// stock). Styles with no adidas counterpart catalogued, and non-adidas goods, keep
// their own SKU untouched. A lookup failure is never fatal: the job still goes out
// with S&S numbers, exactly as it did before, and the reason lands in the diag.
async function applyAdidasArticles(body, diag) {
  const rows = [...(body.items || []), ...(body.deco_instructions || [])];
  const skus = [...new Set(rows.map((r) => String(r && r.sku || '').trim()).filter(Boolean))];
  if (!skus.length) return;

  let map = new Map();
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from('adidas_ss_sku_xref')
      .select('ss_sku, adidas_article').eq('rank', 1).in('ss_sku', skus);
    if (error) throw new Error(error.message);
    for (const r of data || []) if (r.adidas_article) map.set(r.ss_sku, r.adidas_article);
  } catch (e) {
    diag.skuXref = 'adidas article lookup failed (' + (e && e.message || e) + ') — sent S&S style numbers';
    return;
  }
  if (!map.size) return;

  const swapped = [];
  for (const r of rows) {
    const article = map.get(String(r && r.sku || '').trim());
    if (!article || article === r.sku) continue;
    r.ss_sku = r.sku;   // kept for the job sheet's cross-reference
    r.sku = article;
    swapped.push(r.ss_sku + '→' + article);
  }
  if (swapped.length) diag.skuXref = 'adidas articles applied: ' + [...new Set(swapped)].join(', ');
}

function makeJar() {
  const jar = {};
  return {
    store(res) {
      const cookies = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
      for (const c of cookies) {
        const kv = c.split(';')[0];
        const i = kv.indexOf('=');
        if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1);
      }
    },
    header() { return Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '); }
  };
}

async function ssFetch(jar, path, opts = {}) {
  const res = await fetch(path.startsWith('http') ? path : BASE + path, {
    redirect: 'manual',
    ...opts,
    headers: { 'User-Agent': 'Mozilla/5.0 (NSA Portal)', Cookie: jar.header(), ...(opts.headers || {}) }
  });
  jar.store(res);
  return res;
}

// The attribute must start at a tag/whitespace boundary: an unanchored match reads
// data-action="turbo:submit-start->…" as the form's action (observed live — the notes post
// then went to that string as a URL and threw).
function attr(tag, name) {
  const m = tag.match(new RegExp('(?:^|[\\s<])' + name + '\\s*=\\s*"([^"]*)"', 'i'))
    || tag.match(new RegExp('(?:^|[\\s<])' + name + "\\s*=\\s*'([^']*)'", 'i'));
  return m ? m[1] : null;
}

// Rails/Turbo error text out of a re-rendered form (used for both create and update failures).
function railsErrors(html) {
  return [...html.matchAll(/<(?:div|li|p)[^>]*class="[^"]*(?:alert|error|invalid-feedback)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|li|p)>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6);
}

// Human-readable text for a checkbox/radio whose name/value is opaque (their VAS boxes are all
// line_item[option_price_ids][] with numeric values — the meaning is only in the markup around
// them). Tries <label for=its-id>, then the text trailing the input (covers a wrapping label).
function inputLabel(body, idx, tag) {
  const clean = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
  const id = attr(tag, 'id');
  if (id) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lm = body.match(new RegExp('<label\\b[^>]*\\bfor\\s*=\\s*["\']' + esc + '["\'][^>]*>([\\s\\S]*?)<\\/label>', 'i'));
    if (lm) { const s = clean(lm[1]); if (s) return s.slice(0, 80); }
  }
  const after = body.slice(idx + tag.length, idx + tag.length + 300);
  const s = clean(after.split(/<\/label>|<input\b|<select\b|<textarea\b|<\/(?:div|td|li|tr|p)>/i)[0]);
  return s.slice(0, 80);
}

// Parse one whole <form>…</form> string into { action, fields:[{tag,type,name,value,options?}] }.
function parseFormTag(formHtml) {
  const action = attr(formHtml.slice(0, formHtml.indexOf('>') + 1), 'action') || '';
  const body = formHtml.slice(formHtml.indexOf('>') + 1);
  const fields = [];
  for (const m of body.matchAll(/<input\b[^>]*>/gi)) {
    const t = m[0];
    const name = attr(t, 'name');
    if (!name) continue;
    // `checked` matters: a generic re-post of every radio/checkbox would flip the order's
    // shipping mode (e.g. "Ship to customer" → "Hold for pickup").
    const type = (attr(t, 'type') || 'text').toLowerCase();
    const field = { tag: 'input', type, name, value: attr(t, 'value') || '', checked: /\bchecked\b/i.test(t) };
    if (type === 'checkbox' || type === 'radio') {
      const label = inputLabel(body, m.index, t);
      if (label) field.label = label;
    }
    fields.push(field);
  }
  for (const m of body.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/gi)) {
    const name = attr(m[0], 'name');
    if (name) fields.push({ tag: 'textarea', type: 'textarea', name, value: (m[1] || '').trim() });
  }
  for (const m of body.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/gi)) {
    const name = attr(m[0], 'name');
    if (!name) continue;
    const options = [];
    let selected = '';
    for (const om of m[1].matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)) {
      const val = attr(om[0], 'value');
      const label = om[1].replace(/<[^>]+>/g, '').trim();
      options.push({ value: val != null ? val : label, label });
      if (/\bselected\b/i.test(om[0])) selected = val != null ? val : label;
    }
    fields.push({ tag: 'select', type: 'select', name, value: selected, options });
  }
  return { action, fields };
}

// The first <form> whose action targets /orders (the new-order form), else the first form at all.
function parseOrderForm(html) {
  const formMatch = html.match(/<form\b[^>]*action="[^"]*\/orders[^"]*"[^>]*>[\s\S]*?<\/form>/i)
    || html.match(/<form\b[^>]*>[\s\S]*?<\/form>/i);
  if (!formMatch) return null;
  const form = parseFormTag(formMatch[0]);
  if (!form.action) form.action = '/orders';
  return form;
}

// Log in with devise (GET /login for the CSRF token + cookie, POST credentials).
// Returns the jar on success, or throws with a user-facing message.
async function login() {
  const user = process.env.SILVERSCREEN_USERNAME;
  const pass = process.env.SILVERSCREEN_PASSWORD;
  if (!user || !pass) {
    const err = new Error('Silver Screen credentials not configured — set SILVERSCREEN_USERNAME and SILVERSCREEN_PASSWORD in the Netlify environment.');
    err.statusCode = 501;
    throw err;
  }
  const jar = makeJar();
  const loginPage = await ssFetch(jar, '/login');
  const html = await loginPage.text();
  const tokenMatch = html.match(/name="authenticity_token"\s+value="([^"]+)"/);
  if (!tokenMatch) throw new Error('Silver Screen login page did not present a sign-in form (got HTTP ' + loginPage.status + ').');
  const form = new URLSearchParams();
  form.set('authenticity_token', tokenMatch[1]);
  form.set('user[username]', user);
  form.set('user[password]', pass);
  form.set('user[remember_me]', '0');
  form.set('commit', 'Sign In');
  const resp = await ssFetch(jar, '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  // devise: 302/303 on success; 200 re-renders the sign-in form on bad credentials.
  if (resp.status === 200) {
    const back = await resp.text();
    if (/name="user\[password\]"/.test(back)) throw new Error('Silver Screen rejected the login — check SILVERSCREEN_USERNAME / SILVERSCREEN_PASSWORD.');
  }
  return jar;
}

async function fetchOrderForm(jar) {
  const repId = process.env.SILVERSCREEN_SALES_REP_ID || '2322';
  const res = await ssFetch(jar, '/orders/new?order%5Bsales_rep_id%5D=' + encodeURIComponent(repId));
  if (res.status >= 300 && res.status < 400) throw new Error('Silver Screen bounced /orders/new to ' + res.headers.get('location') + ' — session not accepted.');
  const html = await res.text();
  let form = parseOrderForm(html);
  // Turbo apps often render the real order form inside a lazy <turbo-frame src="...">; the shell
  // page then only carries nav/search forms with no textarea (seen live 2026-08-12: the create
  // refused with "no notes/instructions field"). When the parsed form has no textarea, follow the
  // frames and prefer a form that does.
  const hasTextarea = (f) => !!f && f.fields.some((x) => x.tag === 'textarea');
  if (!hasTextarea(form)) {
    const frameSrcs = [...html.matchAll(/<turbo-frame\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]).slice(0, 4);
    for (const src of frameSrcs) {
      try {
        const fres = await ssFetch(jar, src, { headers: { Accept: 'text/html, application/xhtml+xml' } });
        const ff = parseOrderForm(await fres.text());
        if (hasTextarea(ff)) { form = ff; break; }
        if (!form && ff) form = ff;
      } catch { /* dead frame — try the next one */ }
    }
  }
  if (!form) throw new Error('Could not find the order form on /orders/new — the portal layout may have changed. Run action:"discover" and inspect.');
  return form;
}

// The formatted job sheet — the guaranteed-delivery channel for all item data.
function buildJobSheet(p) {
  const lines = [];
  lines.push('NSA Deco PO: ' + p.po.po_id);
  if (p.customer) lines.push('Customer: ' + p.customer);
  if (p.memo) lines.push('Order: ' + p.so_id + (p.memo ? ' — ' + p.memo : ''));
  const svc = (p.po.deco_type || '').replace(/_/g, ' ');
  lines.push('Service: ' + (svc || 'decoration') + ' — ' + (p.po.qty || 0) + ' pcs');
  if (p.po.expected_date) lines.push('Needed by: ' + p.po.expected_date);
  if (p.po.drop_ship) lines.push('Garments drop-ship to Silver Screen from our supplier.');
  // Finished goods go to the CUSTOMER, not back to NSA — their create form carries no ship-to
  // field (it defaults to the third-party NSA address on the account), so state it here too.
  if (p.ship_to && (p.ship_to.line1 || p.ship_to.city)) {
    lines.push('SHIP FINISHED GOODS TO (not NSA): ' + [p.ship_to.name,
      p.ship_to.attention ? 'Attn: ' + p.ship_to.attention : '', p.ship_to.line1, p.ship_to.line2,
      [p.ship_to.city, p.ship_to.state, p.ship_to.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      + ' — UPS Ground');
  }
  if (p.wearer_bag_prep) lines.push('VAS: Wearer Bag Prep on EVERY item.');
  if (p.po.notes) lines.push('Notes: ' + p.po.notes);
  if ((p.deco_instructions || []).length) {
    lines.push('', 'Decoration:');
    for (const d of p.deco_instructions) {
      lines.push('  ' + [d.sku, d.position, (d.type || '').replace(/_/g, ' '), d.notes].filter(Boolean).join(' — '));
    }
  }
  lines.push('', 'Items:');
  let total = 0;
  let anyXref = false;
  for (const it of p.items || []) {
    const sizes = Object.entries(it.sizes || {}).map(([sz, q]) => sz + ':' + q).join(' ');
    total += Number(it.qty) || 0;
    // it.sku is the adidas article on the tag; it.ss_sku is the S&S style we bought
    // under, shown so the line still ties back to our PO and their invoice.
    if (it.ss_sku) anyXref = true;
    const sku = it.sku + (it.ss_sku ? ' (S&S ' + it.ss_sku + ')' : '');
    lines.push('  ' + [sku, it.name, it.color].filter(Boolean).join(' — ') + ' — ' + sizes + ' (' + (it.qty || 0) + ')');
  }
  if (anyXref) lines.push('', 'SKUs above are the adidas article numbers printed on the garment tags; '
    + 'the S&S style we ordered under is in brackets. Both describe the same piece.');
  lines.push('', 'Total pieces: ' + total);
  return lines.join('\n');
}

// Assign our payload onto the live form's fields. Hidden fields pass through untouched
// (CSRF, rails defaults). The exact field names were observed live on 2026-08-12 (via the
// fields-seen error): order[customer_po], order[customer_name], order[job_name],
// order[requested_ship_date], order[firm_ship_date], select order[sales_rep_id],
// select order[ccd_sales_rep_id]. The form has NO notes/textarea — the item list is
// delivered to the created order's notes form afterwards (postJobSheet). The name-pattern
// fallback below only runs when the known names are absent (portal layout change).
function fillForm(form, payload) {
  const params = new URLSearchParams();
  const used = new Set();
  for (const f of form.fields) {
    if (f.type === 'hidden' || f.type === 'submit') { params.set(f.name, f.value || ''); used.add(f.name); }
  }
  const visible = form.fields.filter(f => !used.has(f.name) && f.type !== 'checkbox' && f.type !== 'radio');
  const assigned = {};
  // Job name is customer + memo only — the PO number has its own field right above it on their
  // form, so repeating it here just truncates the part that identifies the job.
  // Store SOs carry a memo like "OMG Store: Mountain House HS Football 2026 (V7ESK) (DPO …)" —
  // the store name repeats the customer and the DPO repeats the customer_po field, so the job
  // name compresses to "<Customer> OMG <sale code>". The full memo still goes in the job sheet.
  const omgCode = ((payload.memo || '').match(/^\s*OMG Store:.*?\(([A-Z0-9]{4,8})\)/i) || [])[1];
  const jobName = omgCode
    ? [payload.customer, 'OMG', omgCode].filter(Boolean).join(' ')
    : [payload.customer, payload.memo].filter(Boolean).join(' ').trim() || payload.po.po_id;
  // customer_po carries the PO number VERBATIM — the bill parser matches their invoice by it.
  // The sales-rep selects keep the form's own pre-selected value (seeded by ?order[sales_rep_id]=…).
  const KNOWN = {
    'order[customer_po]': payload.po.po_id,
    'order[customer_name]': (payload.customer || '').slice(0, 80),
    'order[job_name]': jobName.slice(0, 120),
    'order[requested_ship_date]': payload.po.expected_date || '',
  };
  let knownMapped = false;
  for (const f of visible) {
    if (KNOWN[f.name] !== undefined && KNOWN[f.name] !== '') {
      params.set(f.name, KNOWN[f.name]); used.add(f.name); assigned[f.name] = KNOWN[f.name];
      if (f.name === 'order[customer_po]') knownMapped = true;
    }
  }
  const take = (re) => { const f = visible.find(x => re.test(x.name) && !used.has(x.name)); if (f) used.add(f.name); return f; };
  if (!knownMapped) {
    const poField = take(/\b(po|p_o|purchase)/i);
    if (poField) { params.set(poField.name, payload.po.po_id); assigned.po_number = poField.name; }
    const nameField = take(/(job|order)?\[?(name|title)\]?$/i);
    if (nameField) { params.set(nameField.name, jobName.slice(0, 120)); assigned.job_name = nameField.name; }
    if (payload.po.expected_date) {
      const dueField = take(/due|need|ship.?date|date.?needed/i);
      if (dueField) { params.set(dueField.name, payload.po.expected_date); assigned.due_date = dueField.name; }
    }
  }
  const sheet = buildJobSheet(payload);
  const notesField = visible.find(f => f.tag === 'textarea' && !used.has(f.name))
    || take(/note|instruction|description|comment|detail/i);
  if (notesField) { used.add(notesField.name); params.set(notesField.name, sheet); assigned.job_sheet = notesField.name; }

  // Anything visible we didn't map keeps its default so rails validations that
  // require it still see a value.
  const unmapped = [];
  for (const f of visible) {
    if (used.has(f.name)) continue;
    params.set(f.name, f.value || '');
    unmapped.push({ name: f.name, tag: f.tag, options: f.options ? f.options.slice(0, 12) : undefined });
  }
  return { params, assigned, unmapped, knownMapped, sheetIncluded: !!notesField, sheet };
}

// Deliver the job sheet AFTER order creation: the create form carries no notes field, so
// find a form with a textarea (notes/comment) on the created order's page — following
// lazily-loaded turbo-frames — keep its hidden defaults, put the sheet in the textarea,
// and post it. Best-effort: returns true when a post succeeded.
// Their product modal has its own size columns; ours are SO size keys. Anything unrecognized
// (OSFA, youth, numeric) accumulates into their catch-all "OTH" column so no pieces are lost.
const SS_SIZE_COL = { XS: 'XS', S: 'SM', SM: 'SM', M: 'MD', MD: 'MD', L: 'LG', LG: 'LG', XL: 'XL',
  '2XL': '2XL', XXL: '2XL', '3XL': '3XL', XXXL: '3XL', '4XL': '4XL', XXXXL: '4XL' };
const ssSizeCol = (sz) => SS_SIZE_COL[String(sz || '').toUpperCase().replace(/\s+/g, '')] || 'OTH';
// Their product modal's size boxes, left to right (confirmed from the live modal). Used to place
// quantities by position when the inputs carry no size labels in their names.
const SS_SIZE_ORDER = ['XS', 'SM', 'MD', 'LG', 'XL', '2XL', '3XL', '4XL', 'OTH'];

// Baseline params for a discovered form: hidden/submit defaults, selects at their selected
// option, and radios/checkboxes ONLY when already checked (so the form's own choices survive).
//
// Emitted in DOCUMENT ORDER with append, never set: Rails nested attributes repeat one name for
// every row (their size boxes are nine × line_item[product_sizes_attributes][][quantity]), and
// set() would collapse all nine into a single value — which is exactly how a full size breakdown
// became one lump in the catch-all column. `overrides` is keyed by FIELD INDEX for the same
// reason: keying by name can't address the 4th of nine identical names.
function buildParams(form, overrides = new Map()) {
  const params = new URLSearchParams();
  form.fields.forEach((f, i) => {
    if (f.type === 'radio' || f.type === 'checkbox') {
      if (overrides.has(i)) { const v = overrides.get(i); if (v !== null && v !== '') params.append(f.name, String(v)); return; }
      if (f.checked) params.append(f.name, f.value || 'on');
      return;
    }
    params.append(f.name, overrides.has(i) ? String(overrides.get(i)) : (f.value || ''));
  });
  return params;
}

// The first field whose NAME matches re (skipping any already claimed).
function pick(form, re, claimed) {
  const f = form.fields.find((x) => re.test(x.name) && !claimed.has(x.name)
    && x.type !== 'hidden' && x.type !== 'submit' && x.type !== 'radio' && x.type !== 'checkbox');
  if (f) claimed.add(f.name);
  return f;
}

// Index-addressed variant of pick: returns the field's INDEX so repeated Rails names stay
// distinguishable (see buildParams). claimedIdx holds indices, not names.
function pickIdx(form, re, claimedIdx) {
  const i = form.fields.findIndex((x, ix) => !claimedIdx.has(ix) && re.test(x.name)
    && x.type !== 'hidden' && x.type !== 'submit' && x.type !== 'radio' && x.type !== 'checkbox');
  if (i >= 0) claimedIdx.add(i);
  return i;
}

// Their per-size quantity inputs: nine repeats of line_item[product_sizes_attributes][][quantity]
// (observed live). Fall back to any group of >= 9 same-named quantity-ish inputs so a rename
// doesn't silently put every piece back in the catch-all column.
function sizeQtyIndices(form) {
  const direct = [];
  form.fields.forEach((f, i) => {
    if (f.type === 'hidden') return;
    if (/product_sizes?_attributes/i.test(f.name) && /\[quantity\]|\[qty\]/i.test(f.name)) direct.push(i);
  });
  if (direct.length >= SS_SIZE_ORDER.length) return direct;
  const byName = new Map();
  form.fields.forEach((f, i) => {
    if (f.type === 'hidden' || f.tag !== 'input') return;
    if (!/quantity|qty/i.test(f.name)) return;
    if (!byName.has(f.name)) byName.set(f.name, []);
    byName.get(f.name).push(i);
  });
  for (const idxs of byName.values()) if (idxs.length >= SS_SIZE_ORDER.length) return idxs;
  return direct;
}

// Every <form> on a page, parsed.
function allForms(html) {
  return [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map((m) => parseFormTag(m[0])).filter((f) => f.action);
}

// Set the order's Ship To Location to the customer (their create form has no ship-to fields —
// it defaults to the third-party NSA account address, which would send finished goods to us).
// Drives the order's own edit form, so CSRF/hidden defaults and the already-selected
// "Ship to customer" radio are preserved.
async function postShipTo(jar, orderPath, shipTo, diag) {
  if (!shipTo || !(shipTo.line1 || shipTo.city)) return false;
  const paths = [orderPath + '/edit', orderPath];
  for (const p of paths) {
    let html;
    try { const res = await ssFetch(jar, p, { headers: { Accept: 'text/html, application/xhtml+xml' } }); html = await res.text(); }
    catch { continue; }
    for (const form of allForms(html)) {
      const claimedIdx = new Set();
      const a1 = pickIdx(form, /address_?1|address_?line_?1|street/i, claimedIdx);
      const city = pickIdx(form, /city/i, claimedIdx);
      if (a1 < 0 || city < 0) continue;
      // Index-addressed like the product write: this form can carry Rails arrays (line items), and
      // a by-name set() would collapse them.
      const overrides = new Map([[a1, shipTo.line1 || ''], [city, shipTo.city || '']]);
      const put = (re, val) => { const i = pickIdx(form, re, claimedIdx); if (i >= 0 && val) overrides.set(i, val); return i; };
      // Company = the school; Attention = the sport/program (NOT the deco PO — that belongs on the
      // blanks shipment to the decorator, not on the finished-goods label to the school). Their
      // update requires a non-blank attention, so it falls back to the company name.
      put(/company|ship.*name/i, shipTo.name || '');
      put(/attention|attn/i, shipTo.attention || shipTo.name || 'Receiving');
      put(/address_?2|address_?line_?2|suite/i, shipTo.line2 || '');
      put(/state|region|province/i, shipTo.state || '');
      put(/zip|postal/i, shipTo.zip || '');
      put(/phone/i, shipTo.phone || '');
      // Ship method: pick UPS Ground from their dropdown (it defaults to blank).
      const smIdx = form.fields.findIndex((x, ix) => !claimedIdx.has(ix) && x.tag === 'select' && /ship.?(method|via)|shipping_method|carrier/i.test(x.name));
      if (smIdx >= 0) {
        const opts = form.fields[smIdx].options || [];
        const want = opts.find((op) => /ups\s*ground/i.test(op.label) || /ups\s*ground/i.test(op.value))
          || opts.find((op) => /ground/i.test(op.label));
        if (want) { overrides.set(smIdx, want.value); claimedIdx.add(smIdx); diag.shipMethod = want.label || want.value; }
        else diag.shipMethod = 'no UPS Ground option (' + opts.map((op) => op.label).slice(0, 8).join(', ') + ')';
      }
      try {
        const resp = await ssFetch(jar, form.action, { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/vnd.turbo-stream.html, text/html' },
          body: buildParams(form, overrides).toString() });
        if (resp.status < 400) return true;
        // Carry their validation text — a bare 422 hid "duplicate PO" (their update re-validates
        // the PO number, which collides with any other draft still holding it).
        const errs = railsErrors(await resp.text().catch(() => ''));
        diag.shipTo = 'POST ' + form.action + ' → ' + resp.status + (errs.length ? ': ' + errs.join(' | ') : '');
      } catch { diag.shipTo = 'POST ' + form.action + ' threw'; }
    }
  }
  if (!diag.shipTo) diag.shipTo = 'no ship-to form found';
  return false;
}

// Add each item as a product line via the order's product form (the "Add Additional Product"
// modal). Posts to a form discovered on the page — never a guessed endpoint. Returns the count
// added so a partial result is reportable rather than silently wrong.
async function postProducts(jar, orderPath, items, diag, opts = {}) {
  // The "Add Additional Product" modal is JS-driven, so its form isn't in the order page HTML.
  // Start from the paths their Rails app would use, then add any product-ish URL the page
  // itself advertises (href / data-*-url / data-*-src / turbo-frame src), which is how the
  // modal's real endpoint gets found without guessing.
  const paths = [orderPath + '/order_products/new', orderPath + '/products/new',
    orderPath + '/order_items/new', orderPath + '/line_items/new', orderPath + '/items/new'];
  try {
    const res = await ssFetch(jar, orderPath, { headers: { Accept: 'text/html, application/xhtml+xml' } });
    const html = await res.text();
    for (const m of html.matchAll(/(?:href|src|data-[a-z-]*(?:url|src|path))\s*=\s*"([^"]*)"/gi)) {
      const u = m[1];
      if (/product|item|garment/i.test(u) && /^[/.]/.test(u) && !paths.includes(u)) paths.push(u);
    }
  } catch { /* fall through to the standard paths */ }
  let form = null;
  const seen = [];
  for (const p of paths.slice(0, 14)) {
    let html;
    try { const res = await ssFetch(jar, p, { headers: { Accept: 'text/html, application/xhtml+xml' } }); html = await res.text(); }
    catch { continue; }
    for (const f of allForms(html)) {
      const names = f.fields.map((x) => x.name).join(' ');
      seen.push(p + ' → ' + f.action + ' [' + names.slice(0, 120) + ']');
      // Their modal's signature: a style field plus per-size quantity columns.
      if (/style/i.test(names) && /(size|xs\b|qty|quantity)/i.test(names)) { form = f; break; }
    }
    if (form) break;
  }
  if (!form) { diag.products = 'no product form found; tried ' + paths.slice(0, 8).join(', ') + (seen.length ? '; saw ' + seen.slice(0, 4).join(' · ') : ''); return 0; }
  const qIdx = sizeQtyIndices(form);
  let added = 0;
  const fails = [];         // per-item failures, with their validation text
  diag.failedSkus = [];     // named in the to-do so the rep knows WHICH lines to add by hand
  for (const it of items) {
    const claimedIdx = new Set(qIdx);// the size boxes are spoken for — no header pattern may claim one
    const overrides = new Map();
    const put = (re, val) => { const i = pickIdx(form, re, claimedIdx); if (i >= 0 && val !== '') overrides.set(i, String(val)); return i >= 0; };
    // Claim the modal's header fields in ITS order (Supplier, Description, Style, Colour), most
    // specific first: a generic /name/ pattern would otherwise swallow a supplier_name field.
    // Supplier = the garment's actual vendor (the blanks ship to Silver Screen from them, not
    // from NSA); the client resolves it per item. Old fixed string stays as the fallback.
    put(/supplier|vendor|brand/i, it.vendor || 'NSA (drop ship)');
    // Wearer Bag Prep VAS (store orders): tick their checkbox on this product line. Their VAS
    // boxes are all named line_item[option_price_ids][] with numeric values (seen live, job
    // 58545), so the field name/value alone can never identify one — the adjacent <label> text
    // is what distinguishes Wearer Bag Prep from Fold/Bag/Sticker. Match name, value, AND label;
    // if none carries "wearer"/"bag prep", report it as a to-do with the labels we saw.
    if (opts.wearerBagPrep) {
      const vasRe = /wearer|bag.?prep/i;
      const vi = form.fields.findIndex((x) => x.type === 'checkbox'
        && (vasRe.test(x.name) || vasRe.test(x.value || '') || vasRe.test(x.label || '')));
      if (vi >= 0) {
        overrides.set(vi, form.fields[vi].value || '1');
        diag.vasInfo = 'Wearer Bag Prep ticked via ' + form.fields[vi].name + '=' + form.fields[vi].value
          + (form.fields[vi].label ? ' ("' + form.fields[vi].label + '")' : '');
      } else if (!diag.vas) diag.vas = 'no Wearer Bag Prep checkbox identified — checkboxes seen: ['
        + form.fields.filter((x) => x.type === 'checkbox')
          .map((x) => x.name + '=' + x.value + (x.label ? ' "' + x.label + '"' : '')).slice(0, 12).join(', ') + ']';
    }
    put(/desc|title|product_?name/i, it.name || '');
    put(/style|sku|item_?number/i, it.sku || '');
    put(/colou?r/i, it.color || '');
    // Per-size quantities. Their nine boxes all share ONE name
    // (line_item[product_sizes_attributes][][quantity]) — a Rails nested-attributes array — so they
    // are addressed by INDEX and every one of the nine is emitted in order, blanks included. The
    // previous by-name write collapsed all nine into a single value, which is why a full breakdown
    // arrived as one lump in the catch-all column (A520: 2 in OTH).
    const cols = {};
    for (const [sz, q] of Object.entries(it.sizes || {})) { const c = ssSizeCol(sz); cols[c] = (cols[c] || 0) + (Number(q) || 0); }
    let placed = 0;
    if (qIdx.length >= SS_SIZE_ORDER.length) {
      SS_SIZE_ORDER.forEach((col, i) => { const q = cols[col] || 0; overrides.set(qIdx[i], q > 0 ? String(q) : ''); placed += q; });
      const spare = Object.entries(cols).filter(([c]) => !SS_SIZE_ORDER.includes(c));
      diag.sizesInfo = 'sizes placed per column via ' + form.fields[qIdx[0]].name + ' ×' + qIdx.length
        + ' (' + SS_SIZE_ORDER.map((c) => c + ':' + (cols[c] || 0)).filter((s) => !/:0$/.test(s)).join(' ') + ')'
        + (spare.length ? ' — unmapped: ' + spare.map(([c, q]) => c + ':' + q).join(' ') : '');
    } else {
      // No per-size array found: fall back to the single quantity box (pieces right, sizes wrong)
      // and report the field names, which is what identifies their inputs.
      const qi = form.fields.findIndex((x) => /qty|quantity/i.test(x.name) && x.type !== 'hidden');
      if (qi >= 0) overrides.set(qi, String(it.qty || 0));
      diag.sizes = 'no per-size input array found (' + qIdx.length + ' quantity fields) — the total went to a single box, so sizes need entering by hand. Product-form fields: ['
        + form.fields.filter((x) => x.type !== 'hidden' && x.type !== 'submit').map((x) => x.tag + ':' + x.name).slice(0, 24).join(', ') + ']';
    }
    void placed;
    // A rejected line must say WHICH item and WHY (a bare "→ 422" left the rep hunting
    // through 13 lines — seen live on DPO 57349, job 58505). Carry the portal's own
    // validation text, and when the colour was blank retry once with a placeholder —
    // a required-Colour rule is the one validation we can heal without guessing wrong.
    const postLine = async (ov) => ssFetch(jar, form.action, { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/vnd.turbo-stream.html, text/html' },
      body: buildParams(form, ov).toString() });
    try {
      let resp = await postLine(overrides);
      if (resp.status >= 400 && !(it.color || '').trim()) {
        const retryClaimed = new Set(qIdx);
        const ci = pickIdx(form, /colou?r/i, retryClaimed);
        if (ci >= 0) { const o2 = new Map(overrides); o2.set(ci, 'N/A'); resp = await postLine(o2); }
      }
      if (resp.status < 400) added++;
      else {
        const errs = railsErrors(await resp.text().catch(() => ''));
        fails.push((it.sku || it.name || '?') + ' → ' + resp.status + (errs.length ? ': ' + errs.join(' | ') : ''));
        diag.failedSkus.push(it.sku || it.name || '?');
      }
    } catch { fails.push((it.sku || it.name || '?') + ' → POST threw'); diag.failedSkus.push(it.sku || it.name || '?'); }
  }
  if (fails.length) diag.products = 'POST ' + form.action + ' rejected: ' + fails.slice(0, 6).join(' · ');
  return added;
}

// Returns { posted, diag } — diag names the forms/frames actually found on the order page so
// a failure is self-describing (the same trick that identified the create form's fields),
// instead of just "couldn't attach it".
async function postJobSheet(jar, orderPath, sheet) {
  const pages = [orderPath];
  const diag = { pages: [], forms: [] };
  for (let i = 0; i < pages.length && i < 6; i++) {
    let html;
    try {
      const res = await ssFetch(jar, pages[i], { headers: { Accept: 'text/html, application/xhtml+xml' } });
      html = await res.text();
      diag.pages.push(pages[i] + ' (' + res.status + ')');
    } catch { diag.pages.push(pages[i] + ' (fetch failed)'); continue; }
    for (const m of html.matchAll(/<turbo-frame\b[^>]*\bsrc="([^"]+)"/gi)) {
      if (pages.length < 6 && !pages.includes(m[1])) pages.push(m[1]);
    }
    // Every form on the page, with its field names — recorded whether or not we post to it.
    const candidates = [];
    for (const fm of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)) {
      const f = parseFormTag(fm[0]);
      const named = f.fields.filter((x) => x.type !== 'hidden' && x.type !== 'submit');
      diag.forms.push((f.action || '(no action)') + ' [' + named.map((x) => x.tag + ':' + x.name).join(', ') + ']');
      // A notes/message target: has a textarea, or a field named like a message/comment/note.
      const target = f.fields.find((x) => x.tag === 'textarea')
        || f.fields.find((x) => /message|comment|note|instruction|description/i.test(x.name) && x.type !== 'hidden');
      if (f.action && target) candidates.push({ f, target });
    }
    for (const { f, target } of candidates) {
      const params = buildParams(f, new Map([[f.fields.indexOf(target), sheet]]));
      try {
        const resp = await ssFetch(jar, f.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/vnd.turbo-stream.html, text/html' },
          body: params.toString()
        });
        if (resp.status < 400) return { posted: true, diag };
        diag.forms.push('→ POST ' + f.action + ' returned ' + resp.status);
      } catch { diag.forms.push('→ POST ' + f.action + ' threw'); }
    }
  }
  return { posted: false, diag };
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const auth = await verifyUser(event);
  if (!auth.ok) return { statusCode: auth.status, headers, body: JSON.stringify({ error: auth.error }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad JSON' }) }; }

  try {
    const jar = await login();
    const form = await fetchOrderForm(jar);

    if (body.action === 'discover') {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, form }) };
    }

    if (body.action !== 'create') return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
    if (!body.po || !body.po.po_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing po.po_id' }) };
    if (!Array.isArray(body.items) || body.items.length === 0) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No items to send' }) };

    // Swap our S&S purchase styles for the adidas article numbers printed on the
    // tags BEFORE anything is built from body — the job sheet, the product lines and
    // the decoration notes all read body.items, and they must not disagree.
    const xrefDiag = {};
    await applyAdidasArticles(body, xrefDiag);

    const filled = fillForm(form, body);
    if (!filled.sheetIncluded && !filled.knownMapped) {
      // Neither the known field map nor a notes/textarea target matched — this isn't the
      // order form we know, and the item breakdown would be silently lost. Refuse, naming
      // the fields we DID see (a screenshot of this error is enough to fix the map).
      const seen = form.fields.filter((f) => f.type !== 'hidden' && f.type !== 'submit')
        .map((f) => f.tag + ':' + f.name).slice(0, 20).join(', ');
      return { statusCode: 422, headers, body: JSON.stringify({ ok: false, error: 'The order form matched neither the known Silver Screen field map nor a notes/instructions field to carry the item list. Fields seen: [' + (seen || 'none') + ']. Update the field map in silverscreen-job.js to match.', form }) };
    }

    if (body.dry_run) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, dry_run: true, action: form.action, assigned: filled.assigned, unmapped: filled.unmapped, would_post: Object.fromEntries(filled.params), job_sheet: filled.sheet, sku_xref: xrefDiag.skuXref || 'no adidas articles applied' }) };
    }

    const resp = await ssFetch(jar, form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: filled.params.toString()
    });

    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location') || '';
      const idMatch = loc.match(/\/orders\/(\d+)/);
      // The create form had no notes field — deliver the item list to the created order's
      // notes/comment form now. If that also finds nowhere to post, the job still exists;
      // tell the rep so they paste the breakdown (it's on the printed PO) instead of the
      // decorator quietly receiving a job with no items.
      // The create form carries only the header — products, ship-to and notes are separate
      // sections on the order itself, so fill them in now against forms discovered on the page.
      const orderPath = idMatch ? '/orders/' + idMatch[1] : '';
      let sheetPosted = filled.sheetIncluded;
      let sheetDiag = null;
      let shipToSet = false;
      let productsAdded = 0;
      if (orderPath) {
        const r2 = await postJobSheet(jar, orderPath, filled.sheet);
        if (!sheetPosted) sheetPosted = r2.posted;
        sheetDiag = r2.diag;
        shipToSet = await postShipTo(jar, orderPath, body.ship_to, sheetDiag);
        productsAdded = await postProducts(jar, orderPath, body.items, sheetDiag, { wearerBagPrep: !!body.wearer_bag_prep });
      }
      // Anything left undone is named explicitly (with the forms we saw), so the rep knows what
      // to finish by hand and the field map can be corrected from the message alone.
      const todo = [];
      if (!productsAdded) todo.push('add the ' + body.items.length + ' product line' + (body.items.length !== 1 ? 's' : '') + ' (breakdown is on the printed PO)');
      else if (productsAdded < body.items.length) {
        // Name the rejected lines — "only 12 of 13" without which one left the rep
        // diffing the job against the PO by hand (DPO 57349 / job 58505).
        const who = (sheetDiag && sheetDiag.failedSkus && sheetDiag.failedSkus.length) ? ' — add by hand: ' + sheetDiag.failedSkus.join(', ') : '';
        todo.push('check product lines — only ' + productsAdded + ' of ' + body.items.length + ' were added' + who);
      }
      // Product lines exist but every piece landed in the catch-all column — pieces right, sizes
      // wrong. That's silently shippable garbage if unreported (the decorator would run 35 "OTH"),
      // so it's a to-do of its own.
      if (productsAdded && sheetDiag && sheetDiag.sizes) todo.push('enter the size breakdown on each product line — the quantities went into the catch-all column, not per size');
      // Wearer Bag Prep was requested but the checkbox couldn't be identified on their modal —
      // the pieces would ship un-prepped if nobody ticks it by hand.
      if (body.wearer_bag_prep && sheetDiag && sheetDiag.vas) todo.push('tick the Wearer Bag Prep VAS checkbox on each product line');
      // The job sheet lands in their Notifications message thread, which carries the address as
      // TEXT only — it is not the order's Ship To Location, and the warehouse ships off the
      // structured field. So a posted sheet never counts as ship-to being handled.
      if (!shipToSet && body.ship_to && (body.ship_to.line1 || body.ship_to.city)) todo.push('set the Ship To Location boxes to the customer — it still defaults to the third-party NSA address (the address in the notes message is text only, not the shipping field)');
      if (!sheetPosted) todo.push('paste the job sheet into the order notes');
      const diagStr = sheetDiag ? ' [forms: ' + (sheetDiag.forms.slice(0, 8).join(' · ') || 'none')
        + (sheetDiag.shipTo ? ' | ship-to: ' + sheetDiag.shipTo : '') + (sheetDiag.products ? ' | products: ' + sheetDiag.products : '')
        + (sheetDiag.sizes ? ' | sizes: ' + sheetDiag.sizes : '') + (sheetDiag.sizesInfo ? ' | sizes: ' + sheetDiag.sizesInfo : '')
        + (sheetDiag.vas ? ' | vas: ' + sheetDiag.vas : '') + ']' : '';
      const xrefStr = xrefDiag.skuXref ? ' [' + xrefDiag.skuXref + ']' : '';
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, order_id: idMatch ? idMatch[1] : '', order_url: loc.startsWith('http') ? loc : BASE + loc,
          sheet_posted: sheetPosted, ship_to_set: shipToSet, products_added: productsAdded, sheet_diag: sheetDiag,
          sku_xref: xrefDiag.skuXref || '',
          assigned: filled.assigned, unmapped: filled.unmapped,
          ...(todo.length ? { warning: 'Job ' + (idMatch ? '#' + idMatch[1] + ' ' : '') + 'created, but finish it on the Silver Screen portal — ' + todo.join('; ') + '.' + diagStr + xrefStr } : {}) })
      };
    }

    // 200/422 — rails re-rendered the form with validation errors. Surface them.
    const back = await resp.text();
    const errs = railsErrors(back);
    // Their portal rejects a second order carrying a PO number it already has. That's a real
    // guard (it stops the same job being run twice), so say what it means and what to do rather
    // than echoing "duplicate PO | PO #".
    if (errs.some((e) => /duplicate/i.test(e))) {
      return {
        statusCode: 422, headers,
        body: JSON.stringify({ ok: false, duplicate_po: true,
          error: 'Silver Screen already has an order with PO ' + body.po.po_id + '. Open their portal, delete (or reuse) that draft, then send again — or give this deco PO a different number if both jobs are real.' })
      };
    }
    return {
      statusCode: 422, headers,
      body: JSON.stringify({ ok: false, error: 'Silver Screen rejected the order (HTTP ' + resp.status + ')' + (errs.length ? ': ' + errs.join(' | ') : ' — run action:"discover" to inspect the form.'), unmapped: filled.unmapped })
    };
  } catch (e) {
    return { statusCode: e.statusCode || 502, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
