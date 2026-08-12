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
const { corsHeaders, verifyUser } = require('./_shared');

const BASE = 'https://portal.silverscreenprinting.com';

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

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i')) || tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", 'i'));
  return m ? m[1] : null;
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
    fields.push({ tag: 'input', type: (attr(t, 'type') || 'text').toLowerCase(), name, value: attr(t, 'value') || '' });
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
  if (p.po.notes) lines.push('Notes: ' + p.po.notes);
  if ((p.deco_instructions || []).length) {
    lines.push('', 'Decoration:');
    for (const d of p.deco_instructions) {
      lines.push('  ' + [d.sku, d.position, (d.type || '').replace(/_/g, ' '), d.notes].filter(Boolean).join(' — '));
    }
  }
  lines.push('', 'Items:');
  let total = 0;
  for (const it of p.items || []) {
    const sizes = Object.entries(it.sizes || {}).map(([sz, q]) => sz + ':' + q).join(' ');
    total += Number(it.qty) || 0;
    lines.push('  ' + [it.sku, it.name, it.color].filter(Boolean).join(' — ') + ' — ' + sizes + ' (' + (it.qty || 0) + ')');
  }
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
  const jobName = payload.po.po_id + (payload.customer ? ' — ' + payload.customer : '') + (payload.memo ? ' ' + payload.memo : '');
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
async function postJobSheet(jar, orderPath, sheet) {
  const pages = [orderPath];
  for (let i = 0; i < pages.length && i < 6; i++) {
    let html;
    try {
      const res = await ssFetch(jar, pages[i], { headers: { Accept: 'text/html, application/xhtml+xml' } });
      html = await res.text();
    } catch { continue; }
    for (const m of html.matchAll(/<turbo-frame\b[^>]*\bsrc="([^"]+)"/gi)) {
      if (pages.length < 6 && !pages.includes(m[1])) pages.push(m[1]);
    }
    for (const fm of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)) {
      if (!/<textarea\b/i.test(fm[0])) continue;
      const f = parseFormTag(fm[0]);
      if (!f.action) continue;
      const params = new URLSearchParams();
      for (const fld of f.fields) params.set(fld.name, fld.tag === 'textarea' ? sheet : (fld.value || ''));
      try {
        const resp = await ssFetch(jar, f.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });
        if (resp.status < 400) return true;
      } catch { /* try the next form */ }
    }
  }
  return false;
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
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, dry_run: true, action: form.action, assigned: filled.assigned, unmapped: filled.unmapped, would_post: Object.fromEntries(filled.params), job_sheet: filled.sheet }) };
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
      let sheetPosted = filled.sheetIncluded;
      if (!sheetPosted && idMatch) sheetPosted = await postJobSheet(jar, '/orders/' + idMatch[1], filled.sheet);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, order_id: idMatch ? idMatch[1] : '', order_url: loc.startsWith('http') ? loc : BASE + loc, sheet_posted: sheetPosted, assigned: filled.assigned, unmapped: filled.unmapped,
          ...(sheetPosted ? {} : { warning: 'Job created, but the item list could not be attached to it — open the job on the Silver Screen portal and paste the item breakdown (it\'s on the printed PO).' }) })
      };
    }

    // 200/422 — rails re-rendered the form with validation errors. Surface them.
    const back = await resp.text();
    const errs = [...back.matchAll(/<(?:div|li)[^>]*class="[^"]*(?:alert|error|invalid-feedback)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|li)>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8);
    return {
      statusCode: 422, headers,
      body: JSON.stringify({ ok: false, error: 'Silver Screen rejected the order (HTTP ' + resp.status + ')' + (errs.length ? ': ' + errs.join(' | ') : ' — run action:"discover" to inspect the form.'), unmapped: filled.unmapped })
    };
  } catch (e) {
    return { statusCode: e.statusCode || 502, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
