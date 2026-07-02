// Scheduled (see netlify.toml): once a day (~2 AM PT) emails each sales rep a
// branded recap of the prior PT day's activity across their club webstores —
// every new order on every store, with per-store and overall totals, plus a
// recap of any of their stores that closed in that window. Reps with no
// activity get no email. Rep-only (CSRs already get close alerts separately).
const { getSupabaseAdmin } = require('./_shared');

const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'America/Los_Angeles';
const LIVE_EXCLUDE = new Set(['cancelled', 'pending', 'pending_payment']);

// Minutes the given instant's PT wall-clock leads UTC (negative; −420 PDT / −480 PST).
function ptOffsetMinutes(d) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d);
  const m = {}; p.forEach((x) => { m[x.type] = x.value; });
  const hr = m.hour === '24' ? 0 : Number(m.hour);
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, hr, +m.minute, +m.second);
  return (asUTC - d.getTime()) / 60000;
}
// The PT calendar day that just ended relative to a ~2 AM run = "yesterday".
function yesterdayPTWindow(now) {
  const todayPT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); // YYYY-MM-DD
  const guess = new Date(todayPT + 'T00:00:00Z');
  const end = new Date(guess.getTime() - ptOffsetMinutes(guess) * 60000); // today 00:00 PT, in UTC
  const start = new Date(end.getTime() - 24 * 3600 * 1000);               // ~yesterday 00:00 PT
  const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(end.getTime() - 12 * 3600 * 1000));
  return { start, end, dayLabel };
}
const ptTime = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

exports.handler = async () => {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
  if (!brevoKey) { console.error('[rep-digest] BREVO_API_KEY missing'); return { statusCode: 500, body: 'Not configured' }; }
  let admin;
  try { admin = getSupabaseAdmin(); } catch (e) { console.error('[rep-digest]', e.message); return { statusCode: 500, body: 'Not configured' }; }

  const { start, end, dayLabel } = yesterdayPTWindow(new Date());

  try {
    // Prior-day orders (real demand only).
    const { data: orders } = await admin.from('webstore_orders')
      .select('id,store_id,buyer_name,buyer_email,total,fundraise_amt,status,created_at')
      .gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
    const live = (orders || []).filter((o) => !LIVE_EXCLUDE.has(o.status));

    // Stores referenced by those orders + any of a rep's stores that closed in the window.
    const storeIds = [...new Set(live.map((o) => o.store_id).filter(Boolean))];
    let stores = [];
    if (storeIds.length) {
      const { data } = await admin.from('webstores').select('id,name,slug,rep_id,primary_color,accent_color,logo_url').in('id', storeIds);
      stores = data || [];
    }
    const storeById = {}; stores.forEach((s) => { storeById[s.id] = s; });
    const { data: closedStores } = await admin.from('webstores')
      .select('id,name,slug,rep_id,close_at,closed_notified_at')
      .gte('closed_notified_at', start.toISOString()).lt('closed_notified_at', end.toISOString());

    // Group everything by rep.
    const byRep = {}; // repId -> { stores: {storeId:{store,orders}}, closed: [] }
    const cell = (repId) => (byRep[repId] || (byRep[repId] = { stores: {}, closed: [] }));
    for (const o of live) { const s = storeById[o.store_id]; if (!s || !s.rep_id) continue; const r = cell(s.rep_id); (r.stores[s.id] || (r.stores[s.id] = { store: s, orders: [] })).orders.push(o); }
    for (const cs of (closedStores || [])) { if (cs.rep_id) cell(cs.rep_id).closed.push(cs); }

    const repIds = Object.keys(byRep);
    if (!repIds.length) { console.log('[rep-digest] no activity for', dayLabel); return { statusCode: 200, body: 'No activity' }; }

    const { data: members } = await admin.from('team_members').select('id,name,email').in('id', repIds);
    const repById = {}; (members || []).forEach((m) => { repById[m.id] = m; });

    let sent = 0;
    for (const repId of repIds) {
      const rep = repById[repId];
      if (!rep || !rep.email || !/.+@.+\..+/.test(rep.email)) continue;
      const bundle = byRep[repId];
      const storesArr = Object.values(bundle.stores)
        .map((c) => ({ ...c, sales: c.orders.reduce((a, o) => a + (Number(o.total) || 0), 0) }))
        .sort((a, b) => b.sales - a.sales);
      if (!storesArr.length && !bundle.closed.length) continue;

      const html = buildDigestHtml({ rep, storesArr, closed: bundle.closed, dayLabel, portal });
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
        body: JSON.stringify({
          sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
          to: [{ email: rep.email, name: rep.name || '' }],
          subject: digestSubject(storesArr, bundle.closed, dayLabel),
          htmlContent: html,
        }),
      });
      if (res.ok) sent++; else console.error('[rep-digest] brevo', rep.email, res.status, await res.text().catch(() => ''));
    }
    console.log(`[rep-digest] ${dayLabel}: ${repIds.length} reps with activity, ${sent} emailed`);
    return { statusCode: 200, body: `Emailed ${sent}` };
  } catch (e) {
    console.error('[rep-digest]', e);
    return { statusCode: 500, body: e.message };
  }
};

function digestSubject(storesArr, closed, dayLabel) {
  const nOrders = storesArr.reduce((a, s) => a + s.orders.length, 0);
  if (!nOrders && closed.length) return `Store activity — ${closed.length} store${closed.length === 1 ? '' : 's'} closed (${dayLabel})`;
  const sales = storesArr.reduce((a, s) => a + s.sales, 0);
  return `Your store activity — ${nOrders} order${nOrders === 1 ? '' : 's'}, ${money(sales)} (${dayLabel})`;
}

function buildDigestHtml({ rep, storesArr, closed, dayLabel, portal }) {
  const NAVY = '#16223F', ACCENT = '#B6985A', INK = '#2A2F3E', SUB = '#6B6256', LINE = '#E7DFD0', CREAM = '#FAF6EF';
  const nsaLogo = `${portal}/NEW%20NSA%20Logo%20on%20white.png`;
  const first = (rep.name || '').trim().split(/\s+/)[0] || 'there';
  const allOrders = storesArr.flatMap((s) => s.orders);
  const totOrders = allOrders.length;
  const totSales = allOrders.reduce((a, o) => a + (Number(o.total) || 0), 0);
  const totFund = allOrders.reduce((a, o) => a + (Number(o.fundraise_amt) || 0), 0);

  const tile = (label, value) => `<td align="center" style="padding:14px 10px;background:#fff;border:1px solid ${LINE};border-radius:8px">
      <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:26px;color:${NAVY};line-height:1">${esc(value)}</div>
      <div style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:${SUB};margin-top:4px;font-weight:700">${esc(label)}</div></td>`;
  const summary = totOrders ? `<table width="100%" style="border-collapse:separate;border-spacing:8px 0;margin:0 0 8px"><tr>
      ${tile('Orders', String(totOrders))}${tile('Sales', money(totSales))}${totFund > 0 ? tile('Fundraising', money(totFund)) : ''}</tr></table>` : '';

  const storeBlocks = storesArr.map(({ store, orders, sales }) => {
    const link = `${portal}/shop/${esc(store.slug)}`;
    const rows = orders.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((o) => {
      const oLink = `${portal}/shop/${esc(store.slug)}/order/${esc(o.id)}`;
      const fund = Number(o.fundraise_amt) || 0;
      return `<tr>
        <td style="padding:9px 0;border-bottom:1px solid #f1ece1;vertical-align:top">
          <div style="font-weight:700;color:${INK};font-size:14px">${esc(o.buyer_name || o.buyer_email || 'Customer')}</div>
          <div style="font-size:12px;color:${SUB}">${esc(ptTime(o.created_at))}${fund > 0 ? ` · ${money(fund)} to team` : ''}</div>
        </td>
        <td align="right" style="padding:9px 0;border-bottom:1px solid #f1ece1;vertical-align:top;white-space:nowrap">
          <div style="font-weight:800;color:${NAVY};font-size:14px">${money(o.total)}</div>
          <a href="${oLink}" style="font-size:12px;color:${ACCENT};text-decoration:none;font-weight:700">View →</a>
        </td></tr>`;
    }).join('');
    return `<div style="border:1px solid ${LINE};border-radius:10px;overflow:hidden;margin:0 0 14px">
      <div style="background:${store.primary_color || NAVY};padding:12px 16px;display:block">
        <a href="${link}" style="color:#fff;text-decoration:none;font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:18px;letter-spacing:.3px;text-transform:uppercase">${esc(store.name)}</a>
        <span style="color:rgba(255,255,255,.78);font-size:12px;font-weight:700"> &nbsp;·&nbsp; ${orders.length} order${orders.length === 1 ? '' : 's'} · ${money(sales)}</span>
      </div>
      <table width="100%" style="border-collapse:collapse;padding:0 16px"><tbody>
        <tr><td colspan="2" style="height:4px"></td></tr>
        ${rows}
      </tbody></table>
      <div style="padding:2px 16px 12px"></div>
    </div>`;
  }).join('');

  const closedBlock = closed.length ? `<div style="margin-top:18px">
      <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:15px;letter-spacing:.4px;text-transform:uppercase;color:${NAVY};margin-bottom:8px">Stores closed</div>
      ${closed.map((c) => `<div style="font-size:14px;color:${INK};padding:6px 0;border-bottom:1px solid #f1ece1">
        <strong>${esc(c.name)}</strong> <span style="color:${SUB};font-size:12px">· closed &amp; ready to process</span>
        <a href="${portal}/shop/${esc(c.slug)}" style="color:${ACCENT};text-decoration:none;font-weight:700;font-size:12px"> open →</a></div>`).join('')}
    </div>` : '';

  const empty = (!storesArr.length) ? `<p style="margin:0;color:${SUB};font-size:14px">No new orders yesterday — but here's what changed above.</p>` : '';

  return `<div style="background:${CREAM};padding:0;margin:0">
  <div style="font-family:'Source Sans 3',-apple-system,Segoe UI,Roboto,sans-serif;color:${INK};max-width:600px;margin:0 auto;padding:20px 16px">
    <table width="100%" style="border-collapse:collapse;margin-bottom:14px"><tr>
      <td align="left" style="padding:12px 18px;background:#fff;border:1px solid ${LINE};border-radius:10px 0 0 10px">
        <a href="https://nationalsportsapparel.com"><img src="${nsaLogo}" alt="National Sports Apparel" height="30" style="height:30px;display:block;border:none"></a></td>
      <td align="right" style="padding:12px 18px;background:#fff;border:1px solid ${LINE};border-left:none;border-radius:0 10px 10px 0">
        <span style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:700;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:${ACCENT}">Daily Store Activity</span></td>
    </tr></table>

    <div style="background:${NAVY};color:#fff;padding:20px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:${ACCENT};font-weight:700">${esc(dayLabel)}</div>
      <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:24px;margin-top:3px">Good morning, ${esc(first)}</div>
      <div style="font-size:14px;color:rgba(255,255,255,.82);margin-top:4px">Here's yesterday's activity across your team stores.</div>
    </div>
    <div style="background:#fff;border:1px solid ${LINE};border-top:none;border-radius:0 0 10px 10px;padding:18px 18px 22px">
      ${summary}
      ${storeBlocks}
      ${empty}
      ${closedBlock}
      <p style="font-size:12px;color:${SUB};margin:20px 0 0;line-height:1.5">You're getting this because you're the assigned rep on these stores. Totals exclude unpaid/abandoned carts.</p>
    </div>
    <div style="text-align:center;color:${SUB};font-size:11px;padding:16px 0 4px">National Sports Apparel · Custom team apparel</div>
  </div></div>`;
}

