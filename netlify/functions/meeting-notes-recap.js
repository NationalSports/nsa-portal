// Scheduled (see netlify.toml): ~5:45 PM PT, emails each rep a recap of the AI
// Notes they worked on today — every note saved today with its account,
// summary, to-dos and due dates, items to quote, and the follow-up email ready
// to copy — plus drafts still waiting for review and anything that didn't
// finish. Sent from hello@nationalsportsapparel.com (MEETING_RECAP_FROM
// overrides). Reps with no notes today get nothing. One email per rep per PT
// day: the meeting_recaps row is claimed before sending.
const { getSupabaseAdmin } = require('./_shared');

const TZ = 'America/Los_Angeles';
const SEND_HOUR_PT = 17; // cron fires at :45 past 00 and 01 UTC; only the run at 5:45 PM PT sends

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ptDay = (v) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
const ptHour = (d) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d));
const ptTime = (v) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(v));
const fmtDue = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const sizeText = (sz) => Object.entries(sz || {}).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ');
const itemText = (l) => [l.quantity ? `${l.quantity}×` : '', l.brand, l.name, l.sku_guess ? `(${l.sku_guess})` : '', l.color ? `· ${l.color}` : '', sizeText(l.sizes) ? `· ${sizeText(l.sizes)}` : '', l.decoration ? `· ${l.decoration}` : ''].filter(Boolean).join(' ');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Split one rep's notes into what the recap shows. `today` is the PT date.
function groupForRecap(notes, today) {
  const madeToday = (m) => ptDay(m.created_at) === today;
  return {
    saved: notes.filter((m) => m.status === 'approved' && m.approved_at && ptDay(m.approved_at) === today)
      .sort((a, b) => String(a.approved_at).localeCompare(String(b.approved_at))),
    waiting: notes.filter((m) => m.status === 'ready'),
    unfinished: notes.filter((m) => (m.status === 'recording' || m.status === 'processing') && madeToday(m)),
    failed: notes.filter((m) => m.status === 'failed' && madeToday(m)),
  };
}
// Only reps who did something with AI Notes today get an email.
const hasActivity = (g) => g.saved.length + g.unfinished.length + g.failed.length > 0 || g.waiting.some((m) => m._today);

function buildRecapEmail({ repName, dayLabel, groups, customerName, portal }) {
  const { saved, waiting, unfinished, failed } = groups;
  const link = `${portal}/?pg=meeting_notes`;
  const todoCount = saved.reduce((n, m) => n + ((m.final && m.final.action_items) || []).length, 0);
  const subject = `Your AI Notes for ${dayLabel}: ${plural(saved.length, 'note')} saved` + (todoCount ? `, ${plural(todoCount, 'to-do')}` : '') + (waiting.length ? `, ${waiting.length} to review` : '');
  const first = String(repName || '').split(' ')[0] || 'there';

  const h = [];
  const t = [];
  h.push(`<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#0f172a">`);
  h.push(`<div style="background:#1e3a8a;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0"><div style="font-size:18px;font-weight:700">Your AI Notes · ${esc(dayLabel)}</div><div style="font-size:13px;opacity:.85;margin-top:2px">${esc(plural(saved.length, 'note'))} saved today${todoCount ? ' · ' + esc(plural(todoCount, 'to-do')) : ''}</div></div>`);
  h.push(`<div style="border:1px solid #e2e8f0;border-top:none;padding:16px 20px;border-radius:0 0 8px 8px">`);
  h.push(`<p style="font-size:14px;margin:0 0 14px">Hi ${esc(first)}, here's everything from your notes today, with each follow-up email ready to copy and send.</p>`);
  t.push(`Your AI Notes · ${dayLabel}`, '', `Hi ${first}, here's everything from your notes today.`, '');

  if (waiting.length) {
    h.push(`<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:13px"><b>${esc(plural(waiting.length, 'draft'))} waiting for your review.</b> Nothing is saved to the account (no reminders or contacts) until you approve.<ul style="margin:6px 0 0 18px;padding:0">`
      + waiting.slice(0, 10).map((m) => `<li>${esc((m.draft && m.draft.headline) || m.title || 'Untitled note')} · ${esc(customerName(m.customer_id) || 'no account yet')}</li>`).join('')
      + `</ul><a href="${esc(link)}" style="display:inline-block;margin-top:8px;color:#1d4ed8;font-weight:700">Review in the portal →</a></div>`);
    t.push(`${plural(waiting.length, 'draft')} waiting for your review: ${link}`);
    waiting.slice(0, 10).forEach((m) => t.push(`  - ${(m.draft && m.draft.headline) || m.title || 'Untitled note'} (${customerName(m.customer_id) || 'no account yet'})`));
    t.push('');
  }
  if (unfinished.length || failed.length) {
    const bits = [];
    if (unfinished.length) bits.push(`${plural(unfinished.length, 'recording')} still not finished`);
    if (failed.length) bits.push(`${plural(failed.length, 'note')} couldn't be processed (tap Retry)`);
    h.push(`<div style="font-size:13px;color:#b45309;margin-bottom:14px">${esc(bits.join(' · '))}. <a href="${esc(link)}" style="color:#1d4ed8">Open AI Notes</a></div>`);
    t.push(bits.join(' · ') + `: ${link}`, '');
  }

  saved.forEach((m) => {
    const f = m.final || {};
    const acct = customerName(m.customer_id) || 'No account';
    h.push(`<div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-top:14px">`);
    h.push(`<div style="font-size:15px;font-weight:700">${esc(f.headline || m.title || 'Note')}</div>`);
    h.push(`<div style="font-size:12px;color:#64748b;margin:2px 0 8px">${esc(acct)} · ${esc(ptTime(m.created_at))}</div>`);
    if (f.summary) h.push(`<div style="font-size:13px;line-height:1.5;margin-bottom:8px">${esc(f.summary)}</div>`);
    t.push(`== ${f.headline || m.title || 'Note'} (${acct}) ==`);
    if (f.summary) t.push(f.summary);
    const todos = f.action_items || [];
    if (todos.length) {
      h.push(`<div style="font-size:12px;font-weight:700;color:#475569;margin-top:6px">To-dos (on your reminders)</div><ul style="margin:4px 0 8px 18px;padding:0;font-size:13px">`
        + todos.map((a) => `<li>${esc(a.text)}${a.due_date ? ` <b style="color:#1e3a8a">· due ${esc(fmtDue(a.due_date))}</b>` : ''}${a.owner && a.owner !== 'rep' ? ` · ${esc(a.owner)}` : ''}</li>`).join('') + `</ul>`);
      t.push('To-dos:');
      todos.forEach((a) => t.push(`  - ${a.text}${a.due_date ? ` (due ${fmtDue(a.due_date)})` : ''}${a.owner && a.owner !== 'rep' ? ` · ${a.owner}` : ''}`));
    }
    if (f.next_action_date) {
      h.push(`<div style="font-size:13px;margin-bottom:8px"><b>Next touch:</b> ${esc(fmtDue(f.next_action_date))}</div>`);
      t.push(`Next touch: ${fmtDue(f.next_action_date)}`);
    }
    const items = f.line_items || [];
    if (items.length) {
      h.push(`<div style="font-size:12px;font-weight:700;color:#475569">Items to quote</div><ul style="margin:4px 0 8px 18px;padding:0;font-size:13px">` + items.map((l) => `<li>${esc(itemText(l))}</li>`).join('') + `</ul>`);
      t.push('Items to quote:');
      items.forEach((l) => t.push(`  - ${itemText(l)}`));
    }
    const em = f.follow_up_email;
    if (em && (em.subject || em.body)) {
      h.push(`<div style="font-size:12px;font-weight:700;color:#475569">Follow-up email</div><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;font-size:13px;line-height:1.5;margin-top:4px">`
        + (em.subject ? `<div style="font-weight:700;margin-bottom:6px">Subject: ${esc(em.subject)}</div>` : '')
        + `<div>${esc(em.body || '').replace(/\n/g, '<br>')}</div></div>`);
      t.push('Follow-up email:', em.subject ? `Subject: ${em.subject}` : '', em.body || '');
    }
    h.push(`</div>`);
    t.push('');
  });

  h.push(`<div style="margin-top:18px;font-size:12px;color:#64748b">Sent at the end of each day you use AI Notes. <a href="${esc(link)}" style="color:#1d4ed8">Open AI Notes</a></div>`);
  h.push(`</div></div>`);
  t.push(`Open AI Notes: ${link}`);
  return { subject, html: h.join(''), text: t.filter((x) => x !== null).join('\n') };
}

async function sendBrevo({ key, from, to, toName, subject, html, text }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': key },
    body: JSON.stringify({ sender: { name: 'National Sports Apparel', email: from }, to: [{ email: to, name: toName || '' }], subject, htmlContent: html, textContent: text }),
  });
  if (!res.ok) throw new Error(`brevo ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

async function runRecap(admin, { now = new Date(), brevoKey, from, portal, send = sendBrevo } = {}) {
  const today = ptDay(now);
  const since = new Date(now.getTime() - 30 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const cols = 'id,team_member_id,customer_id,mode,status,title,draft,final,created_at,approved_at';
  const [recent, ready] = await Promise.all([
    admin.from('meetings').select(cols).or(`created_at.gte.${since},approved_at.gte.${since}`).neq('status', 'discarded').limit(2000),
    admin.from('meetings').select(cols).eq('status', 'ready').limit(2000),
  ]);
  // Before the AI Notes migration is applied there is nothing to recap.
  if (recent.error && /does not exist|could not find the table/i.test(recent.error.message || '')) return { today, reps: 0, sent: 0, skipped: 'AI Notes tables are not set up yet' };
  if (recent.error) throw new Error('meetings: ' + recent.error.message);
  const byId = new Map();
  [...(recent.data || []), ...((ready.data) || [])].forEach((m) => byId.set(m.id, m));
  const byRep = new Map();
  for (const m of byId.values()) {
    m._today = ptDay(m.created_at) === today;
    if (!byRep.has(m.team_member_id)) byRep.set(m.team_member_id, []);
    byRep.get(m.team_member_id).push(m);
  }
  const plans = [...byRep.entries()].map(([repId, notes]) => ({ repId, groups: groupForRecap(notes, today) })).filter((p) => hasActivity(p.groups));
  if (!plans.length) return { today, reps: 0, sent: 0 };

  const custIds = [...new Set(plans.flatMap((p) => [...p.groups.saved, ...p.groups.waiting]).map((m) => m.customer_id).filter(Boolean))];
  const [{ data: members }, { data: custs }] = await Promise.all([
    admin.from('team_members').select('id,name,email,is_active').in('id', plans.map((p) => p.repId)),
    custIds.length ? admin.from('customers').select('id,name').in('id', custIds) : Promise.resolve({ data: [] }),
  ]);
  const custName = new Map((custs || []).map((c) => [c.id, c.name]));
  const dayLabel = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  let sent = 0;
  for (const p of plans) {
    const rep = (members || []).find((r) => r.id === p.repId);
    if (!rep || rep.is_active === false || !/.+@.+\..+/.test(rep.email || '')) continue;
    const { error: claimErr } = await admin.from('meeting_recaps').insert({ team_member_id: rep.id, day: today, note_count: p.groups.saved.length });
    if (claimErr) {
      if (claimErr.code !== '23505') console.error('[meeting-recap] claim failed', rep.id, claimErr.message);
      continue; // 23505: already sent today
    }
    const mail = buildRecapEmail({ repName: rep.name, dayLabel, groups: p.groups, customerName: (id) => custName.get(id), portal });
    try {
      await send({ key: brevoKey, from, to: rep.email, toName: rep.name, ...mail });
      sent += 1;
    } catch (e) {
      console.error('[meeting-recap] send failed', rep.email, e.message);
      await admin.from('meeting_recaps').delete().eq('team_member_id', rep.id).eq('day', today); // let a later run retry
    }
  }
  return { today, reps: plans.length, sent };
}

exports.handler = async () => {
  const now = new Date();
  if (ptHour(now) !== SEND_HOUR_PT) return { statusCode: 200, body: JSON.stringify({ skipped: 'not 5 PM PT' }) };
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
  if (!brevoKey) { console.error('[meeting-recap] BREVO_API_KEY missing'); return { statusCode: 500, body: 'Not configured' }; }
  let admin;
  try { admin = getSupabaseAdmin(); } catch (e) { console.error('[meeting-recap]', e.message); return { statusCode: 500, body: 'Not configured' }; }
  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
  try {
    const res = await runRecap(admin, { now, brevoKey, from: process.env.MEETING_RECAP_FROM || 'hello@nationalsportsapparel.com', portal });
    console.log(`[meeting-recap] ${res.today}: ${res.reps} reps with notes, ${res.sent} emailed`);
    return { statusCode: 200, body: JSON.stringify(res) };
  } catch (e) {
    console.error('[meeting-recap]', e.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false }) };
  }
};

exports.buildRecapEmail = buildRecapEmail;
exports.groupForRecap = groupForRecap;
exports.runRecap = runRecap;
