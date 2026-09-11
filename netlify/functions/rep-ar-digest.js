// Scheduled (see netlify.toml): every Friday morning (PT) emails each rep a
// branded A/R recap dedicated to their PAST-DUE invoices — every open, overdue
// invoice for their customers, aged into 1-30 / 31-60 / 61-90 / 90+
// buckets with a total, grouped by account with the largest overdue account
// balances first. This is the weekly collections
// companion to the daily rep-ops-digest (which only flags invoices the day they
// newly cross 10 days past due). Reps with nothing past due get no email.
//
// TWO A/R streams, deliberately merged into one account view:
//   • portal invoices        — balance = total - paid, due_date stored on the row
//   • customer_invoices      — the NetSuite import. Balance is the exported
//                              "Amount Remaining" (open_balance); NetSuite carries
//                              no due date, so it is derived from invoice_date +
//                              the customer's payment terms, matching
//                              create_past_due_invoice_todos() so the emailed list
//                              and the in-app rep todo can't disagree.
// A NetSuite row is collectable ONLY when it carries an explicit open_balance.
// Rows without one are history, not a subledger: status alone can't prove what is
// still owed, and the invoice screen already excludes them (see the balanceBasis
// 'missing_authoritative' path in src/lib/historicalInvoiceAr.js). Chasing those
// would mean emailing a customer over an invoice NetSuite no longer reports.
//
// Manual single-recipient test (same guard as rep-ops-digest — the unattended
// all-reps send only runs from the scheduler, which carries no httpMethod):
//   GET /.netlify/functions/rep-ar-digest?test=<email>[&rep=<id|name>][&key=<k>]
const { getSupabaseAdmin } = require('./_shared');
const { isOpenInvoice, invoiceBalance, invoiceDaysPastDue, agingBucket, AGING_BUCKETS, groupOverdueInvoicesByAccount } = require('../../src/lib/opsRecap');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (Number(v) || 0);
const money = (n) => '$' + Math.round(num(n)).toLocaleString('en-US');
const TZ = 'America/Los_Angeles';

// NetSuite invoices carry no due date, so it is derived from the customer's terms.
// Same mapping (and same net30 default) as create_past_due_invoice_todos(), so the
// emailed A/R and the in-app rep todo age every invoice identically.
const TERM_DAYS = { prepay: 0, net15: 15, net30: 30, net60: 60 };
const termDays = (terms) => {
  const d = TERM_DAYS[String(terms || 'net30').toLowerCase()];
  return d == null ? 30 : d;
};
const addDays = (ymd, n) => {
  const s = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
};
// Open per NetSuite. 'partial' isn't a NetSuite status — a part-paid invoice stays
// Open with a reduced Amount Remaining — but the portal writes 'partial' when a
// payment is recorded against a historical invoice, so both are accepted.
const HIST_OPEN_STATUSES = new Set(['open', 'partial', 'partially_paid']);

// Extra recipients: an account-team member who should also receive a given rep's
// weekly A/R recap. Keyed by rep team_member id → [extra team_member ids].
const WEEKLY_EXTRA_RECIPIENTS = {
  '00000000-0000-0000-0000-000000000022': ['00000000-0000-0000-0000-000000000031'], // Mike "Merc" Mercuriali → Rachel Najara
  '00000000-0000-0000-0000-000000000025': ['00000000-0000-0000-0000-000000000030'], // Kelly Bean → Sharon Day-Monroe
};

async function loadAll(admin, table, cols, apply) {
  const out = []; let from = 0; const PAGE = 1000;
  for (;;) {
    // Order by id so .range() pages are deterministic — unordered paging over ties can skip/duplicate rows.
    let q = admin.from(table).select(cols).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

exports.handler = async (event) => {
  const qs = (event && event.queryStringParameters) || {};
  const testTo = qs.test ? String(qs.test).trim() : '';
  // Netlify invokes scheduled functions via an internal POST whose body is
  // {"next_run": "..."} — so event.httpMethod is set on the CRON run too. Detect the
  // schedule POSITIVELY by that body and never block it (keying off httpMethod would
  // silently 400 the cron and send nothing); only a genuine manual call (no next_run)
  // must carry ?test= (or ?dry=1 to preview recipients).
  const isScheduled = (() => { try { return !!(event && event.body && JSON.parse(event.body).next_run); } catch (_) { return false; } })();
  const dryRun = qs.dry === '1' || qs.dry === 'true';
  const testKey = process.env.OPS_DIGEST_TEST_KEY || '';
  if (!isScheduled) {
    if (!testTo && !dryRun) return { statusCode: 400, body: 'Manual runs must pass ?test=<team email> (single-recipient test), or ?dry=1 to preview recipients. The full send only runs on schedule.' };
    if (testKey && qs.key !== testKey) return { statusCode: 403, body: 'Missing or bad ?key.' };
  }
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
  const portal = (process.env.PORTAL_PUBLIC_URL || 'https://connect.nationalsportsapparel.com').replace(/\/+$/, '');
  if (!brevoKey) { console.error('[ar-digest] BREVO_API_KEY missing'); return { statusCode: 500, body: 'Not configured' }; }
  let admin;
  try { admin = getSupabaseAdmin(); } catch (e) { console.error('[ar-digest]', e.message); return { statusCode: 500, body: 'Not configured' }; }

  const now = new Date();
  const todayPTYmd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(now);

  try {
    const [members, customers, invoices, histInvoices] = await Promise.all([
      loadAll(admin, 'team_members', '*'),
      loadAll(admin, 'customers', 'id,name,alpha_tag,primary_rep_id,payment_terms'),
      loadAll(admin, 'invoices', 'id,customer_id,so_id,date,due_date,total,paid,status,type,memo,created_by,rep_id,deleted_at', (q) => q.is('deleted_at', null)),
      // NetSuite history. The open_balance filter is the collectable test from the
      // header comment, applied server-side so this stays a few hundred rows rather
      // than the full ~9k archive.
      loadAll(admin, 'customer_invoices', 'id,document_number,customer_id,invoice_date,total,open_balance,status,type,memo',
        (q) => q.not('open_balance', 'is', null).gt('open_balance', 0)),
    ]);
    const repById = {}; members.forEach((m) => { repById[m.id] = m; });
    const custById = {}; customers.forEach((c) => { custById[c.id] = c; });
    const custName = (id) => custById[id]?.name || custById[id]?.alpha_tag || '—';

    // Bucket past-due open invoices by rep.
    const byRep = {}; // repId -> [{inv, balance, dpd, bucket}]
    invoices.forEach((inv) => {
      if (!isOpenInvoice(inv)) return;
      const dpd = invoiceDaysPastDue(inv, todayPTYmd);
      if (dpd == null || dpd < 1) return;
      // invoices.rep_id is the per-invoice override (see commissionRepId in src/businessLogic.js);
      // it must win here too or an overridden invoice chases the wrong rep for the money.
      const rep = inv.rep_id || custById[inv.customer_id]?.primary_rep_id || inv.created_by;
      if (!rep) return;
      (byRep[rep] || (byRep[rep] = [])).push({ inv, balance: invoiceBalance(inv), dpd, bucket: agingBucket(dpd) });
    });

    // NetSuite history, same buckets and the same byRep map so an account's two
    // streams land in one block. These rows carry no rep of their own — the account
    // rep owns them, and an unlinked invoice (customer_id never matched on import)
    // has no rep and is skipped rather than guessed at.
    histInvoices.forEach((ci) => {
      if (String(ci.type || 'invoice').toLowerCase() !== 'invoice') return;
      if (!HIST_OPEN_STATUSES.has(String(ci.status || '').trim().toLowerCase())) return;
      const balance = num(ci.open_balance);
      if (!(balance > 0.005)) return;
      const cust = custById[ci.customer_id];
      const rep = cust?.primary_rep_id;
      if (!rep) return;
      const due = addDays(ci.invoice_date, termDays(cust.payment_terms));
      if (!due) return;
      const dpd = invoiceDaysPastDue({ due_date: due }, todayPTYmd);
      if (dpd == null || dpd < 1) return;
      (byRep[rep] || (byRep[rep] = [])).push({
        // Shaped like a portal invoice for the renderer. id is the document number
        // (INV#####) — what the rep and the customer both recognise.
        inv: { id: ci.document_number || ci.id, customer_id: ci.customer_id, memo: ci.memo, due_date: due },
        balance,
        dpd,
        bucket: agingBucket(dpd),
        hist: true,
      });
    });

    // ── Test send (single recipient, rep-dependent) ──
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
      if (!testRep) return { statusCode: 404, body: `Couldn't resolve which rep's A/R to render for ${testTo}. Pass &rep=<name or id>.` };
      const rows = (byRep[testRep.id] || []).slice().sort((a, b) => b.dpd - a.dpd);
      const live = qs.live === '1' || qs.live === 'true';
      const isCc = String(testTo).toLowerCase() !== String(testRep.email || '').toLowerCase();
      const html = buildArHtml({ rep: testRep, rows, dateLabel, portal, custName,
        ccFor: isCc ? testRep.name : null,
        testNote: live ? null : `Test send to ${testTo} · ${(testRep.name || '').split(/\s+/)[0] || 'this rep'}'s past-due A/R as of ${dateLabel}${rows.length ? '.' : ' (nothing past due right now).'}` });
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
        body: JSON.stringify({
          sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
          to: [{ email: testTo, name: testRep.name || '' }],
          subject: `${live ? '' : '[TEST] '}${isCc ? testRep.name + ': ' : ''}${arSubject(rows)}`,
          htmlContent: html,
        }),
      });
      const ok = res.ok; const errTxt = ok ? '' : await res.text().catch(() => '');
      console.log(`[ar-digest] ${live ? 'LIVE' : 'TEST'} → ${testTo} (${testRep.name}): ${ok ? 'sent' : 'FAILED ' + res.status + ' ' + errTxt}`);
      return { statusCode: ok ? 200 : 502, body: ok ? `${live ? 'Live' : 'Test'} A/R digest sent to ${testTo} — ${testRep.name}'s A/R (${rows.length} past-due)` : `Brevo error ${res.status}: ${errTxt}` };
    }

    // ── Scheduled all-reps send ──
    let sent = 0; const dryList = [];
    for (const [repId, rowsRaw] of Object.entries(byRep)) {
      const rep = repById[repId];
      if (!rep || !rep.email || rep.is_active === false || !/.+@.+\..+/.test(rep.email)) continue;
      if (rep.ar_digest_opt_out === true) continue;
      const rows = rowsRaw.slice().sort((a, b) => b.dpd - a.dpd);
      if (!rows.length) continue;
      if (dryRun) { dryList.push(`${rep.name} <${rep.email}> — ${rows.length} past-due`); }
      else {
      const html = buildArHtml({ rep, rows, dateLabel, portal, custName });
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
        body: JSON.stringify({
          sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
          to: [{ email: rep.email, name: rep.name || '' }],
          subject: arSubject(rows),
          htmlContent: html,
        }),
      });
      if (res.ok) sent++; else console.error('[ar-digest] brevo', rep.email, res.status, await res.text().catch(() => ''));
      }

      // Copy this rep's A/R recap to any configured account-team members.
      for (const extraId of (WEEKLY_EXTRA_RECIPIENTS[repId] || [])) {
        const ex = repById[extraId];
        if (!ex || !ex.email || ex.is_active === false || ex.ar_digest_opt_out === true || !/.+@.+\..+/.test(ex.email)) continue;
        if (dryRun) { dryList.push(`${ex.name} <${ex.email}> ← ${rep.name}'s A/R`); continue; }
        const exRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
          body: JSON.stringify({
            sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
            to: [{ email: ex.email, name: ex.name || '' }],
            subject: `${rep.name}: ${arSubject(rows)}`,
            htmlContent: buildArHtml({ rep, rows, dateLabel, portal, custName, ccFor: rep.name }),
          }),
        });
        if (exRes.ok) sent++; else console.error('[ar-digest] brevo(cc)', ex.email, exRes.status, await exRes.text().catch(() => ''));
      }
    }
    if (dryRun) return { statusCode: 200, body: `DRY RUN — ${dateLabel} — would email ${dryList.length}:\n` + dryList.join('\n') };
    console.log(`[ar-digest] ${dateLabel}: ${Object.keys(byRep).length} reps with past-due, ${sent} emailed`);
    return { statusCode: 200, body: `Emailed ${sent}` };
  } catch (e) {
    console.error('[ar-digest]', e);
    return { statusCode: 500, body: e.message };
  }
};

function arSubject(rows) {
  const total = rows.reduce((a, r) => a + r.balance, 0);
  return `Past-due A/R — ${money(total)} across ${rows.length} invoice${rows.length === 1 ? '' : 's'}`;
}

function buildArHtml({ rep, rows, dateLabel, portal, custName, testNote, ccFor }) {
  const NAVY = '#16223F', ACCENT = '#B6985A', INK = '#2A2F3E', SUB = '#6B6256', LINE = '#E7DFD0', CREAM = '#FAF6EF', RED = '#B91C1C';
  const nsaLogo = `${portal}/NEW%20NSA%20Logo%20on%20white.png`;
  const first = (rep.name || '').trim().split(/\s+/)[0] || 'there';
  const invLink = (id) => `${portal}/?inv=${encodeURIComponent(id)}`;
  // Same portal deep-link plus &dl=1, which auto-downloads the invoice PDF once the
  // invoice opens (see InvoicesPage.js). Opens in the rep's browser like any other link.
  const dlLink = (id) => `${portal}/?inv=${encodeURIComponent(id)}&dl=1`;
  // NetSuite rows are not in the portal's own invoice list, so ?inv= can't resolve
  // them (App.js resolves that param against `invs` only) and there is no portal
  // PDF to download. Link the account instead — for a collections call that is the
  // more useful destination anyway, and it's a link that actually works.
  const custLink = (cid) => `${portal}/?cust=${encodeURIComponent(cid)}`;
  const total = rows.reduce((a, r) => a + r.balance, 0);

  // Aging summary tiles.
  const byBucket = {}; AGING_BUCKETS.forEach((k) => { byBucket[k] = { n: 0, amt: 0 }; });
  rows.forEach((r) => { const b = byBucket[r.bucket] || (byBucket[r.bucket] = { n: 0, amt: 0 }); b.n++; b.amt += r.balance; });
  const tile = (label, b) => `<td align="center" style="padding:12px 8px;background:#fff;border:1px solid ${LINE};border-radius:8px">
      <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:20px;color:${b.amt > 0 ? RED : NAVY};line-height:1">${money(b.amt)}</div>
      <div style="font-size:10px;letter-spacing:.4px;text-transform:uppercase;color:${SUB};margin-top:4px;font-weight:700">${esc(label)}</div>
      <div style="font-size:10px;color:${SUB};margin-top:1px">${b.n} inv</div></td>`;
  const summary = `<table width="100%" style="border-collapse:separate;border-spacing:6px 0;margin:0 0 14px"><tr>
      ${AGING_BUCKETS.map((k) => tile(k === '90+' ? '90+ days' : k + ' days', byBucket[k])).join('')}</tr></table>`;

  const groups = groupOverdueInvoicesByAccount(rows, custName);

  // Gmail clips a body over ~102 KB behind a "[Message clipped]" link, silently
  // hiding the tail. Folding the NetSuite stream in roughly doubled the row count
  // (the largest rep went 51 -> 114 invoices, 78 KB -> 161 KB), pushing several reps
  // past that. So render the worst accounts in full and summarise the remainder:
  // what's left out is stated with its own total instead of being dropped by the
  // mail client. Whole accounts only — splitting one across the cut reads as a bug.
  // The header total and aging tiles above are still computed from EVERY row, so the
  // headline figure stays the rep's true past-due balance.
  const MAX_ROWS = 60;
  const shownGroups = [];
  let shownRows = 0, moreInvoices = 0, moreAmount = 0, moreAccounts = 0;
  groups.forEach((group) => {
    if (shownRows >= MAX_ROWS) {
      moreAccounts++; moreInvoices += group.invoices.length; moreAmount += group.total;
      return;
    }
    shownGroups.push(group);
    shownRows += group.invoices.length;
  });
  const moreRow = moreInvoices ? `<tr><td colspan="2" style="padding:14px 0 0">
      <div style="background:${CREAM};border:1px solid ${LINE};border-radius:8px;padding:11px 13px;font-size:13px;color:${INK}">
        <b>+ ${moreInvoices} more overdue invoice${moreInvoices === 1 ? '' : 's'}</b> across ${moreAccounts} smaller account${moreAccounts === 1 ? '' : 's'}, totalling <b style="color:${RED}">${money(moreAmount)}</b>.
        <div style="font-size:12px;color:${SUB};margin-top:3px">Trimmed so your mail app doesn't clip this email — the totals above still include them. <a href="${portal}/?pg=reports" style="color:${ACCENT};font-weight:700;text-decoration:none">See the full list →</a></div>
      </div></td></tr>` : '';

  const rowsHtml = shownGroups.map((group) => {
    const invoiceRows = group.invoices.map((r) => {
      const heat = r.dpd >= 90 ? '#7F1D1D' : r.dpd >= 60 ? '#B91C1C' : r.dpd >= 30 ? '#B45309' : '#92400E';
      return `<tr>
        <td style="padding:9px 0 9px 12px;border-bottom:1px solid #f1ece1;vertical-align:top">
          <div style="font-weight:700;color:${INK};font-size:14px">${esc(r.inv.id)}${r.hist ? ` <span style="font-size:9px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:${SUB};background:#F3EFE6;border:1px solid ${LINE};border-radius:3px;padding:1px 4px;vertical-align:1px">NetSuite</span>` : ''}</div>
          <div style="font-size:12px;color:${SUB};margin-top:1px">${esc(r.inv.memo || 'No memo')}</div>
          <div style="font-size:11px;color:${SUB};margin-top:1px">Due ${esc(String(r.inv.due_date).slice(0, 10))}${r.hist ? ' · from account terms' : ''}</div></td>
        <td align="right" style="padding:9px 0;border-bottom:1px solid #f1ece1;vertical-align:top;white-space:nowrap">
          <div style="font-weight:800;color:${RED};font-size:14px">${money(r.balance)}</div>
          <div style="margin-top:1px"><span style="font-size:12px;font-weight:800;color:${heat}">${r.dpd} days past</span></div>
          <div style="margin-top:4px">${r.hist
            ? `<a href="${custLink(r.inv.customer_id)}" style="font-size:12px;color:${ACCENT};text-decoration:none;font-weight:700">Open account →</a>`
            : `<a href="${invLink(r.inv.id)}" style="font-size:12px;color:${ACCENT};text-decoration:none;font-weight:700">Open →</a>
            <a href="${dlLink(r.inv.id)}" style="font-size:12px;color:${ACCENT};text-decoration:none;font-weight:700;margin-left:14px">↓ Download</a>`}</div></td></tr>`;
    }).join('');
    return `<tr><td colspan="2" style="padding:15px 0 7px;border-bottom:2px solid ${LINE}">
        <table width="100%" style="border-collapse:collapse"><tr>
          <td style="vertical-align:bottom">
            <div style="font-weight:800;color:${NAVY};font-size:16px">${esc(group.account)}</div>
            <div style="font-size:11px;color:${SUB};margin-top:1px">${group.invoices.length} overdue invoice${group.invoices.length === 1 ? '' : 's'}</div></td>
          <td align="right" style="vertical-align:bottom;white-space:nowrap">
            <div style="font-weight:800;color:${RED};font-size:17px">${money(group.total)}</div>
            <div style="font-size:10px;color:${SUB};text-transform:uppercase;letter-spacing:.4px">Account total</div></td>
        </tr></table></td></tr>${invoiceRows}`;
  }).join('');

  return `<div style="background:${CREAM};padding:0;margin:0">
  <div style="font-family:'Source Sans 3',-apple-system,Segoe UI,Roboto,sans-serif;color:${INK};max-width:600px;margin:0 auto;padding:20px 16px">
    <table width="100%" style="border-collapse:collapse;margin-bottom:14px"><tr>
      <td align="left" style="padding:12px 18px;background:#fff;border:1px solid ${LINE};border-radius:10px 0 0 10px">
        <a href="https://nationalsportsapparel.com"><img src="${nsaLogo}" alt="National Sports Apparel" height="30" style="height:30px;display:block;border:none"></a></td>
      <td align="right" style="padding:12px 18px;background:#fff;border:1px solid ${LINE};border-left:none;border-radius:0 10px 10px 0">
        <span style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:700;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:${ACCENT}">Weekly A/R · Past Due</span></td>
    </tr></table>

    <div style="background:${NAVY};color:#fff;padding:20px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:${ACCENT};font-weight:700">${esc(dateLabel)}</div>
      <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:24px;margin-top:3px">${money(total)} past due, ${first}</div>
      <div style="font-size:14px;color:rgba(255,255,255,.82);margin-top:4px">${rows.length} open invoice${rows.length === 1 ? '' : 's'} on your accounts need a nudge.</div>
    </div>
    <div style="background:#fff;border:1px solid ${LINE};border-top:none;border-radius:0 0 10px 10px;padding:18px 18px 22px">
      ${ccFor ? `<div style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF;font-size:12px;font-weight:700;padding:8px 12px;border-radius:6px;margin:0 0 12px">📋 You're receiving ${esc(ccFor)}'s weekly A/R recap — you're on their account team.</div>` : ''}
      ${testNote ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;font-size:12px;font-weight:700;padding:8px 12px;border-radius:6px;margin:0 0 12px">🧪 ${esc(testNote)}</div>` : ''}
      ${summary}
      <table width="100%" style="border-collapse:collapse"><tbody>${rowsHtml}${moreRow}</tbody></table>
      <p style="font-size:12px;color:${SUB};margin:22px 0 0;line-height:1.5">You're getting this because you're the assigned rep on these customers. Accounts are ranked by total past-due balance; invoices within each account are oldest first.${rows.some((r) => r.hist) ? ` Rows tagged <b>NetSuite</b> came from the imported invoice history — their balance is the amount NetSuite still shows outstanding, and their due date is worked out from the account's payment terms.` : ''}</p>
    </div>
    <div style="text-align:center;color:${SUB};font-size:11px;padding:16px 0 4px">National Sports Apparel · Custom team apparel</div>
  </div></div>`;
}
