// Scheduled (see netlify.toml): once a day (~2 AM PT) emails each sales rep a
// branded operations recap of the prior PT day across THEIR orders —
//   • Orders shipped (with billed value where an invoice exists)
//   • Estimates approved
//   • IFs picked (flagging any that came up short on the stock pull, with a
//     one-click "Create PO" link)
//   • Orders all checked in (every unit received / pulled)
//   • Deadlines approaching (open orders due soon, incl. overdue)
// This is the emailed twin of the in-app "My Day" tab (Sales Tools). Each email
// links straight to that page (?pg=sales_tools&st=myday) for the live, clickable
// view. Reps with no activity and no upcoming deadlines get no email; reps who
// turned the email off (team_members.ops_digest_opt_out) never do. On weekend
// mornings, deadline-only digests are suppressed (the same deadlines re-appear
// Monday) — real activity still sends.
//
// Category rules live in src/lib/opsRecap.js, shared verbatim with the My Day tab
// so the two surfaces can never drift. Because sales_orders.updated_at and pick
// pulled_at are stored as TEXT in mixed locale/ISO formats they can't be
// range-filtered in SQL, so we window in JS with new Date() (parses both) — but
// the heavy child-table loads are bounded to the working set: orders still open,
// plus closed ones whose ship/update stamp falls in the window.
const { getSupabaseAdmin } = require('./_shared');
const { soFulfillment, isShippedOut, isCheckedIn, shortOnPull, pulledGroups } = require('../../src/lib/opsRecap');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (Number(v) || 0);
const money = (n) => '$' + Math.round(num(n)).toLocaleString('en-US');
const TZ = 'America/Los_Angeles';
// Orders in one of these statuses are dead and never part of the recap. 'complete'
// is handled separately: closed orders stay in the working set only while their
// ship/update stamp is inside the window (so "shipped yesterday, closed" shows).
const DEAD_STATUS = new Set(['cancelled', 'deleted', 'void', 'archived']);

const parseDate = (d) => { if (!d) return null; const dt = new Date(d); return isNaN(dt.getTime()) ? null : dt; };

// ── PT day-that-just-ended window (same as rep-daily-digest) ──
function ptOffsetMinutes(d) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d);
  const m = {}; p.forEach((x) => { m[x.type] = x.value; });
  const hr = m.hour === '24' ? 0 : Number(m.hour);
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, hr, +m.minute, +m.second);
  return (asUTC - d.getTime()) / 60000;
}
function yesterdayPTWindow(now) {
  const todayPT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const guess = new Date(todayPT + 'T00:00:00Z');
  const end = new Date(guess.getTime() - ptOffsetMinutes(guess) * 60000);
  const start = new Date(end.getTime() - 24 * 3600 * 1000);
  const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(end.getTime() - 12 * 3600 * 1000));
  return { start, end, dayLabel };
}

// ── Load every row of a table, 1000 at a time ──
async function loadAll(admin, table, cols, apply) {
  const out = []; let from = 0; const PAGE = 1000;
  for (;;) {
    let q = admin.from(table).select(cols).range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
// Load rows where `col` ∈ ids, chunked so the IN list never gets too long.
async function loadIn(admin, table, cols, col, ids) {
  const out = []; const CH = 200;
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += CH) {
    const chunk = ids.slice(i, i + CH);
    const { data, error } = await admin.from(table).select(cols).in(col, chunk);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

exports.handler = async (event) => {
  const qs = (event && event.queryStringParameters) || {};
  const testTo = qs.test ? String(qs.test).trim() : '';
  // HTTP invocations are allowed ONLY as a single-recipient test to a known team
  // address; the unattended all-reps send runs solely from the Netlify scheduler
  // (a scheduled invocation carries no httpMethod). Belt-and-suspenders so hitting
  // the function URL can never blast the whole team.
  const isHttp = !!(event && event.httpMethod);
  const testKey = process.env.OPS_DIGEST_TEST_KEY || '';
  if (isHttp) {
    if (!testTo) return { statusCode: 400, body: 'Manual runs must pass ?test=<team email> (single-recipient test). The full send only runs on schedule.' };
    if (testKey && qs.key !== testKey) return { statusCode: 403, body: 'Missing or bad ?key.' };
  }
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
  if (!brevoKey) { console.error('[ops-digest] BREVO_API_KEY missing'); return { statusCode: 500, body: 'Not configured' }; }
  let admin;
  try { admin = getSupabaseAdmin(); } catch (e) { console.error('[ops-digest]', e.message); return { statusCode: 500, body: 'Not configured' }; }

  const now = new Date();
  const { start, end, dayLabel } = yesterdayPTWindow(now);
  const inWin = (d) => { const dt = parseDate(d); return !!dt && dt >= start && dt < end; };
  const DEADLINE_DAYS = 14;
  const deadlineCut = new Date(end.getTime() + DEADLINE_DAYS * 864e5);
  // Weekend send mornings (Sat/Sun PT): suppress deadline-only digests — the same
  // deadlines re-surface in Monday's email; real activity still goes out.
  const sendDow = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(now);
  const weekendSend = sendDow === 'Sat' || sendDow === 'Sun';

  try {
    // People + customer → rep mapping. select('*') so the opt-out flag is picked up
    // when the column exists and silently absent when the migration hasn't run yet.
    const [members, customers] = await Promise.all([
      loadAll(admin, 'team_members', '*'),
      loadAll(admin, 'customers', 'id,name,alpha_tag,primary_rep_id'),
    ]);
    const repById = {}; members.forEach((m) => { repById[m.id] = m; });
    const custById = {}; customers.forEach((c) => { custById[c.id] = c; });
    const repOf = (so) => custById[so.customer_id]?.primary_rep_id || so.created_by;
    const custName = (id) => custById[id]?.name || custById[id]?.alpha_tag || '—';

    // Estimates approved yesterday (approved_at is ISO → cheap indexed range).
    const approvedEsts = (await loadAll(admin, 'estimates', 'id,memo,customer_id,created_by,approved_by,approved_at,status,deleted_at',
      (q) => q.eq('status', 'approved').gte('approved_at', start.toISOString()).lt('approved_at', end.toISOString())))
      .filter((e) => !e.deleted_at && inWin(e.approved_at));

    // Working set: header row for every order is cheap; child tables are the heavy
    // part, so bound them to orders that can still appear in a recap — anything not
    // closed, plus closed ones stamped inside the window ("shipped yesterday").
    const headers = await loadAll(admin, 'sales_orders',
      'id,customer_id,created_by,status,expected_date,updated_at,memo,deleted_at,_shipping_status,_ship_date,ship_preference,delivered');
    const orders = headers.filter((o) => !o.deleted_at && !DEAD_STATUS.has(o.status) &&
      (o.status !== 'complete' || inWin(o._ship_date) || inWin(o.updated_at)));
    const soIds = orders.map((o) => o.id);
    // so_items via select('*') so qty_only items (est_qty) count wherever the column
    // lives, without erroring on schema drift.
    const [items, jobs] = await Promise.all([
      loadIn(admin, 'so_items', '*', 'so_id', soIds),
      loadIn(admin, 'so_jobs', 'so_id,id,prod_status', 'so_id', soIds),
    ]);
    const itemIds = items.map((it) => it.id);
    const [picks, pos] = await Promise.all([
      loadIn(admin, 'so_item_pick_lines', 'so_item_id,pick_id,sizes,status', 'so_item_id', itemIds),
      loadIn(admin, 'so_item_po_lines', 'so_item_id,sizes,received,cancelled', 'so_item_id', itemIds),
    ]);
    // Index children into the shared-module shape (flattened size maps + meta keys,
    // matching the client's pick_lines/po_lines).
    const picksByItem = {}; picks.forEach((p) => (picksByItem[p.so_item_id] || (picksByItem[p.so_item_id] = [])).push({ ...(p.sizes || {}), status: p.status, pick_id: p.pick_id }));
    const posByItem = {}; pos.forEach((p) => (posByItem[p.so_item_id] || (posByItem[p.so_item_id] = [])).push({ ...(p.sizes || {}), received: p.received || {}, cancelled: p.cancelled || {} }));
    const itemsBySo = {}; items.forEach((it) => (itemsBySo[it.so_id] || (itemsBySo[it.so_id] = [])).push({ sku: it.sku, name: it.name, sizes: it.sizes || {}, est_qty: it.est_qty, picks: picksByItem[it.id] || [], pos: posByItem[it.id] || [] }));
    const jobsBySo = {}; jobs.forEach((j) => (jobsBySo[j.so_id] || (jobsBySo[j.so_id] = [])).push({ id: j.id, prod_status: j.prod_status }));
    orders.forEach((o) => { o.items = itemsBySo[o.id] || []; o.jobs = jobsBySo[o.id] || []; });

    // ── Categorize into per-rep buckets ──
    const byRep = {}; // repId -> { shipped, approved, picked, checkedIn, deadlines }
    const cell = (id) => (byRep[id] || (byRep[id] = { shipped: [], approved: [], picked: [], checkedIn: [], deadlines: [] }));

    approvedEsts.forEach((e) => {
      const rep = e.created_by || custById[e.customer_id]?.primary_rep_id;
      if (rep) cell(rep).approved.push(e);
    });

    orders.forEach((so) => {
      const rep = repOf(so); if (!rep) return;
      const ff = soFulfillment(so);
      const shippedOut = isShippedOut(so, ff);

      if (shippedOut && inWin(so._ship_date || so.updated_at)) cell(rep).shipped.push(so);
      if (isCheckedIn(so, ff) && inWin(so.updated_at)) cell(rep).checkedIn.push(so);

      const gs = pulledGroups(so, inWin);
      if (gs.length) {
        const short = shortOnPull(so);
        gs.forEach((g) => cell(rep).picked.push({ so, pickId: g.pickId, units: g.units, skus: g.skus, latest: g.latest, short }));
      }

      if (!shippedOut) {
        const due = parseDate(so.expected_date);
        if (due && due < deadlineCut) cell(rep).deadlines.push({ so, due, daysOut: Math.ceil((due.getTime() - end.getTime()) / 864e5) });
      }
    });

    // Billed value for shipped orders (exact where an invoice exists; blank otherwise).
    const shippedIds = [...new Set(Object.values(byRep).flatMap((b) => b.shipped.map((so) => so.id)))];
    const invTotalBySo = {};
    (await loadIn(admin, 'invoices', 'so_id,total,status', 'so_id', shippedIds)).forEach((inv) => {
      if (inv.status === 'void' || !inv.so_id) return;
      invTotalBySo[inv.so_id] = (invTotalBySo[inv.so_id] || 0) + num(inv.total);
    });

    // Single-recipient test send (manual ?test=<email>[&rep=<id|name>]). Renders a
    // specific rep's own digest — exactly what they'd receive — and delivers only to
    // the test address, bypassing the skip/opt-out/weekend gates so a test always
    // sends even on a quiet day. The recipient must be a known team member OR a
    // company (@nationalsportsapparel.com) address, so the endpoint can't be used to
    // email arbitrary outsiders. Which rep's data is shown: ?rep if given, else the
    // team member whose email matches the recipient (exact, then by local-part).
    if (testTo) {
      const lc = (s) => String(s || '').toLowerCase();
      const localPart = lc(testTo).split('@')[0];
      const knownTo = members.find((m) => lc(m.email) === lc(testTo));
      if (!knownTo && !/@nationalsportsapparel\.com$/i.test(testTo)) {
        return { statusCode: 403, body: `Test recipient must be a known team member or an @nationalsportsapparel.com address (got ${testTo}).` };
      }
      const repSel = qs.rep ? lc(qs.rep) : '';
      const testRep = (repSel && members.find((m) => lc(m.id) === repSel || lc(m.name) === repSel || lc(m.name).split(/\s+/)[0] === repSel || lc(m.email) === repSel))
        || knownTo
        || members.find((m) => lc(m.email).split('@')[0] === localPart)
        || members.find((m) => lc(m.name).split(/\s+/)[0] === localPart);
      if (!testRep) return { statusCode: 404, body: `Couldn't resolve which rep's digest to render for ${testTo}. Pass &rep=<name or id>.` };
      const b = byRep[testRep.id] || { shipped: [], approved: [], picked: [], checkedIn: [], deadlines: [] };
      b.picked.sort((x, y) => parseDate(y.latest) - parseDate(x.latest));
      b.deadlines.sort((x, y) => x.due - y.due);
      const activity = b.shipped.length + b.approved.length + b.picked.length + b.checkedIn.length + b.deadlines.length;
      const html = buildOpsHtml({ rep: testRep, b, dayLabel, portal, custName, invTotalBySo,
        testNote: `Test send to ${testRep.name || testRep.email} · this is ${(testRep.name || '').split(/\s+/)[0] || 'their'}'s own recap for ${dayLabel}${activity === 0 ? ' (no activity or deadlines in this window).' : '.'}` });
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
        body: JSON.stringify({
          sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
          to: [{ email: testTo, name: testRep.name || '' }],
          subject: `[TEST] ${opsSubject(b, b.picked.filter((p) => p.short).length, dayLabel)}`,
          htmlContent: html,
        }),
      });
      const ok = res.ok; const errTxt = ok ? '' : await res.text().catch(() => '');
      console.log(`[ops-digest] TEST → ${testTo}: ${ok ? 'sent' : 'FAILED ' + res.status + ' ' + errTxt}`);
      return { statusCode: ok ? 200 : 502, body: ok ? `Test digest sent to ${testTo} (${activity} items)` : `Brevo error ${res.status}: ${errTxt}` };
    }

    // ── Send ──
    let sent = 0, skippedOptOut = 0;
    for (const [repId, b] of Object.entries(byRep)) {
      const rep = repById[repId];
      if (!rep || !rep.email || rep.is_active === false || !/.+@.+\..+/.test(rep.email)) continue;
      if (rep.ops_digest_opt_out === true) { skippedOptOut++; continue; }
      const activity = b.shipped.length + b.approved.length + b.picked.length + b.checkedIn.length;
      if (activity === 0 && (b.deadlines.length === 0 || weekendSend)) continue;
      b.picked.sort((x, y) => parseDate(y.latest) - parseDate(x.latest));
      b.deadlines.sort((x, y) => x.due - y.due);

      const html = buildOpsHtml({ rep, b, dayLabel, portal, custName, invTotalBySo });
      const shortN = b.picked.filter((p) => p.short).length;
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
        body: JSON.stringify({
          sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
          to: [{ email: rep.email, name: rep.name || '' }],
          subject: opsSubject(b, shortN, dayLabel),
          htmlContent: html,
        }),
      });
      if (res.ok) sent++; else console.error('[ops-digest] brevo', rep.email, res.status, await res.text().catch(() => ''));
    }
    console.log(`[ops-digest] ${dayLabel}: ${orders.length}/${headers.length} orders in working set, ${Object.keys(byRep).length} reps bucketed, ${sent} emailed, ${skippedOptOut} opted out`);
    return { statusCode: 200, body: `Emailed ${sent}` };
  } catch (e) {
    console.error('[ops-digest]', e);
    return { statusCode: 500, body: e.message };
  }
};

function opsSubject(b, shortN, dayLabel) {
  const bits = [];
  if (b.shipped.length) bits.push(`${b.shipped.length} shipped`);
  if (b.approved.length) bits.push(`${b.approved.length} approved`);
  if (b.picked.length) bits.push(`${b.picked.length} picked${shortN ? ` (${shortN} short)` : ''}`);
  if (b.checkedIn.length) bits.push(`${b.checkedIn.length} checked in`);
  if (!bits.length && b.deadlines.length) return `${b.deadlines.length} deadline${b.deadlines.length === 1 ? '' : 's'} coming up (${dayLabel})`;
  return `Your day: ${bits.join(' · ')} (${dayLabel})`;
}

function buildOpsHtml({ rep, b, dayLabel, portal, custName, invTotalBySo, testNote }) {
  const NAVY = '#16223F', ACCENT = '#B6985A', INK = '#2A2F3E', SUB = '#6B6256', LINE = '#E7DFD0', CREAM = '#FAF6EF';
  const nsaLogo = `${portal}/NEW%20NSA%20Logo%20on%20white.png`;
  const first = (rep.name || '').trim().split(/\s+/)[0] || 'there';
  const myDay = `${portal}/?pg=sales_tools&st=myday`;
  const soLink = (id, tab) => `${portal}/?so=${encodeURIComponent(id)}${tab ? `&so_tab=${tab}` : ''}`;
  const estLink = (id) => `${portal}/?est=${encodeURIComponent(id)}`;

  const tile = (label, value, sub) => `<td align="center" style="padding:14px 8px;background:#fff;border:1px solid ${LINE};border-radius:8px">
      <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:26px;color:${NAVY};line-height:1">${esc(value)}</div>
      <div style="font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:${SUB};margin-top:4px;font-weight:700">${esc(label)}</div>
      ${sub ? `<div style="font-size:10px;color:#B91C1C;font-weight:700;margin-top:2px">${esc(sub)}</div>` : ''}</td>`;
  const shortN = b.picked.filter((p) => p.short).length;
  const summary = `<table width="100%" style="border-collapse:separate;border-spacing:6px 0;margin:0 0 14px"><tr>
      ${tile('Shipped', String(b.shipped.length))}${tile('Approved', String(b.approved.length))}${tile('IFs Picked', String(b.picked.length), shortN ? `${shortN} short` : '')}${tile('Checked In', String(b.checkedIn.length))}${tile('Deadlines', String(b.deadlines.length))}</tr></table>`;

  const sectionHead = (t) => `<div style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:15px;letter-spacing:.4px;text-transform:uppercase;color:${NAVY};margin:18px 0 8px">${t}</div>`;
  const row = (main, sub, right, link, linkLabel) => `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #f1ece1;vertical-align:top">
        <div style="font-weight:700;color:${INK};font-size:14px">${main}</div>${sub ? `<div style="font-size:12px;color:${SUB}">${sub}</div>` : ''}</td>
      <td align="right" style="padding:8px 0;border-bottom:1px solid #f1ece1;vertical-align:top;white-space:nowrap">${right || ''}
        <a href="${link}" style="font-size:12px;color:${ACCENT};text-decoration:none;font-weight:700">${linkLabel || 'Open →'}</a></td></tr>`;
  const table = (rows) => `<table width="100%" style="border-collapse:collapse"><tbody>${rows}</tbody></table>`;

  const shippedBlock = b.shipped.length ? sectionHead('🚚 Orders Shipped') + table(b.shipped.map((so) => {
    const billed = invTotalBySo[so.id];
    const val = billed > 0 ? `<span style="font-size:13px;font-weight:800;color:${NAVY}">${money(billed)}</span> &nbsp;` : '';
    return row(esc(so.id), esc(custName(so.customer_id)) + (so.memo ? ` · ${esc(so.memo)}` : ''), val, soLink(so.id));
  }).join('')) : '';
  const approvedBlock = b.approved.length ? sectionHead('✅ Estimates Approved') + table(b.approved.map((e) =>
    row(esc(e.id), `${esc(custName(e.customer_id))}${e.approved_by ? ` · approved by ${esc(e.approved_by)}` : ''}`, '', estLink(e.id))).join('')) : '';
  const pickedBlock = b.picked.length ? sectionHead('📦 IFs Picked') + table(b.picked.map((p) => {
    const shortTag = p.short ? `<div style="font-size:12px;color:#B91C1C;font-weight:700">⚠️ Short ${p.short.units}: ${esc(p.short.detail)}</div>` : '';
    const sku = p.skus.slice(0, 3).join(', ') + (p.skus.length > 3 ? ` +${p.skus.length - 3}` : '');
    // Shorts deep-link straight to the SO's Items tab, where the Create PO flow lives.
    return row(`${esc(p.pickId || p.so.id)} <span style="color:${SUB};font-weight:600">· ${p.units} unit${p.units === 1 ? '' : 's'}</span>`,
      `${esc(custName(p.so.customer_id))} · ${esc(p.so.id)}${sku ? ` · ${esc(sku)}` : ''}${shortTag}`, '',
      soLink(p.so.id, p.short ? 'items' : ''), p.short ? 'Create PO →' : 'Open →');
  }).join('')) : '';
  const checkedBlock = b.checkedIn.length ? sectionHead('🏬 Orders All Checked In') + table(b.checkedIn.map((so) =>
    row(esc(so.id), esc(custName(so.customer_id)) + (so.memo ? ` · ${esc(so.memo)}` : '') + ' · every unit in, ready to build', '', soLink(so.id))).join('')) : '';
  const deadlineBlock = b.deadlines.length ? sectionHead('⏰ Deadlines Approaching') + table(b.deadlines.map(({ so, due, daysOut }) => {
    const overdue = daysOut < 0;
    const badge = `<span style="font-size:12px;font-weight:800;color:${overdue ? '#B91C1C' : daysOut <= 3 ? '#B45309' : '#075985'}">${overdue ? `${Math.abs(daysOut)}d overdue` : daysOut === 0 ? 'due today' : `${daysOut}d out`}</span> &nbsp;`;
    return row(esc(so.id), `${esc(custName(so.customer_id))} · due ${esc(due.toLocaleDateString('en-US', { timeZone: TZ }))}`, badge, soLink(so.id));
  }).join('')) : '';

  return `<div style="background:${CREAM};padding:0;margin:0">
  <div style="font-family:'Source Sans 3',-apple-system,Segoe UI,Roboto,sans-serif;color:${INK};max-width:600px;margin:0 auto;padding:20px 16px">
    <table width="100%" style="border-collapse:collapse;margin-bottom:14px"><tr>
      <td align="left" style="padding:12px 18px;background:#fff;border:1px solid ${LINE};border-radius:10px 0 0 10px">
        <a href="https://nationalsportsapparel.com"><img src="${nsaLogo}" alt="National Sports Apparel" height="30" style="height:30px;display:block;border:none"></a></td>
      <td align="right" style="padding:12px 18px;background:#fff;border:1px solid ${LINE};border-left:none;border-radius:0 10px 10px 0">
        <span style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:700;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:${ACCENT}">Daily Ops Recap</span></td>
    </tr></table>

    <div style="background:${NAVY};color:#fff;padding:20px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:${ACCENT};font-weight:700">${esc(dayLabel)}</div>
      <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:24px;margin-top:3px">Good morning, ${esc(first)}</div>
      <div style="font-size:14px;color:rgba(255,255,255,.82);margin-top:4px">Here's what moved on your orders yesterday.</div>
    </div>
    <div style="background:#fff;border:1px solid ${LINE};border-top:none;border-radius:0 0 10px 10px;padding:18px 18px 22px">
      ${testNote ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;font-size:12px;font-weight:700;padding:8px 12px;border-radius:6px;margin:0 0 12px">🧪 ${esc(testNote)}</div>` : ''}
      ${summary}
      <div style="text-align:center;margin:0 0 6px"><a href="${myDay}" style="display:inline-block;background:${NAVY};color:#fff;padding:11px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">Open My Day →</a></div>
      ${shippedBlock}${approvedBlock}${pickedBlock}${checkedBlock}${deadlineBlock}
      <p style="font-size:12px;color:${SUB};margin:22px 0 0;line-height:1.5">You're getting this because you're the assigned rep on these orders. Shipped/checked-in/picked reflect yesterday's activity; deadlines look ${'≤'}${14} days ahead. Turn this email off any time from Sales Tools → My Day.</p>
    </div>
    <div style="text-align:center;color:${SUB};font-size:11px;padding:16px 0 4px">National Sports Apparel · Custom team apparel</div>
  </div></div>`;
}
