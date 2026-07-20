// Server-side backend for the Adidas CLICK PO-tracking task (the "🔎 Track open
// Adidas POs in CLICK" button on the SO page). The CLICK read runs in a Cowork /
// claude-in-chrome session (reusing the inventory-sync access); this function is
// where the two privileged steps live so no secret ever touches the browser skill:
//
//   action=claim     → hand the tracker its queued track_po_status task(s) and
//                       mark them in_progress (service-role; the browser side has
//                       no service-role key). Also re-claims stale in_progress
//                       tasks so a died-mid-run task can't wedge forever.
//   action=complete  → record the result on the assigned_todos task, post a
//                       human-readable comment, and email the SO's rep the
//                       per-item update (Brevo, from the verified NSA domain).
//
// Content-locked where it matters: the RECIPIENT is always resolved server-side
// from the SO (customers.primary_rep_id, else sales_orders.created_by) — the
// caller can't redirect the email. If BOT_TASK_TOKEN is set, a matching
// `x-bot-token` header is required (this endpoint sends mail, so gate it).
const { createClient } = require('@supabase/supabase-js');

const HEADERS = { 'Content-Type': 'application/json' };
const STALE_MS = 20 * 60 * 1000; // re-claim an in_progress task older than this
const BOT_MEMBER_ID = process.env.BOT_MEMBER_ID || 'bot-claude';
const ALLOWED_STATUS = new Set(['done', 'needs_input', 'blocked', 'failed']);

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const j = (statusCode, obj) => ({ statusCode, headers: HEADERS, body: JSON.stringify(obj) });

// A po_line `sizes` blob carries ordered per-size quantities plus numeric meta
// (unit_cost). Keep only real size counts. Non-numeric meta (drop_ship, ship_to,
// status, memo…) is naturally excluded.
const SIZE_META = new Set(['unit_cost']);
function cleanSizes(sizes) {
  const out = {};
  Object.entries(sizes || {}).forEach(([k, v]) => {
    if (k.startsWith('_') || SIZE_META.has(k)) return;
    if (typeof v === 'number' && v > 0) out[k] = v;
  });
  return out;
}

// Build the item roster the CLICK tracker looks up: every OPEN Adidas PO line on
// the SO, with ordered sizes. Service-role read so the browser skill needs no
// access to staff tables. Restricts to the task's po_numbers when given; else
// falls back to the vendor string.
async function rosterForSo(sb, soId, poNumbers) {
  if (!soId) return [];
  const { data: items } = await sb.from('so_items').select('id,sku,name,color').eq('so_id', soId);
  if (!items || !items.length) return [];
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const { data: pls } = await sb.from('so_item_po_lines')
    .select('so_item_id,po_id,vendor,status,sizes').in('so_item_id', items.map((i) => i.id));
  const wantPo = new Set((poNumbers || []).map(String));
  const roster = [];
  (pls || []).forEach((p) => {
    if (!p.po_id) return;
    if (p.status === 'received' || p.status === 'cancelled') return; // open only
    const inWanted = wantPo.size ? wantPo.has(String(p.po_id)) : /adidas/i.test(p.vendor || '');
    if (!inWanted) return;
    const sizes = cleanSizes(p.sizes);
    if (!Object.keys(sizes).length) return;
    const it = byId[p.so_item_id] || {};
    roster.push({ po: p.po_id, sku: it.sku, name: it.name || '', color: it.color || '', sizes });
  });
  return roster;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return j(405, { error: 'POST only' });

  const url = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return j(500, { error: 'Supabase not configured' });

  // Optional shared-secret gate — this endpoint can send email, so if a token is
  // configured, require it. (Recipient is server-resolved regardless.)
  const wantToken = process.env.BOT_TASK_TOKEN;
  if (wantToken) {
    const got = event.headers['x-bot-token'] || event.headers['X-Bot-Token'];
    if (got !== wantToken) return j(401, { error: 'bad or missing x-bot-token' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'Invalid JSON' }); }
  const action = String(body.action || '').trim();

  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    if (action === 'claim') return await claim(sb, body);
    if (action === 'complete') return await complete(sb, body);
    return j(400, { error: "action must be 'claim' or 'complete'" });
  } catch (e) {
    console.error('[so-po-tracker] failed:', e);
    return j(500, { error: e.message });
  }
};

// Return + claim the queued (or stale-in_progress) track_po_status tasks.
async function claim(sb, body) {
  const limit = Math.min(Number(body.limit) || 5, 20);
  const { data: rows, error } = await sb
    .from('assigned_todos')
    .select('id,title,so_id,po_id,bot_payload,bot_status,updated_at')
    .eq('status', 'open')
    .eq('bot_payload->>task_type', 'track_po_status')
    .in('bot_status', ['queued', 'in_progress'])
    .order('created_at', { ascending: true })
    .limit(limit * 3);
  if (error) return j(500, { error: error.message });

  const now = Date.now();
  const candidates = (rows || []).filter((t) => {
    if (t.bot_status === 'queued') return true;
    const age = now - new Date(t.updated_at || 0).getTime();
    return age > STALE_MS; // stale in_progress → safe to re-claim
  });

  const claimed = [];
  for (const t of candidates) {
    if (claimed.length >= limit) break;
    // Atomic claim: only win if the row is still in the state we saw.
    const { data, error: uErr } = await sb
      .from('assigned_todos')
      .update({ bot_status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', t.id)
      .eq('bot_status', t.bot_status)
      .select('id')
      .maybeSingle();
    if (uErr) { console.warn('[so-po-tracker] claim update failed:', uErr.message); continue; }
    if (data) {
      const soId = t.so_id || t.bot_payload?.so_id || null;
      const poNumbers = t.bot_payload?.po_numbers || [];
      claimed.push({
        task_id: t.id,
        so_id: soId,
        po_numbers: poNumbers,
        notify: t.bot_payload?.notify !== false,
        roster: await rosterForSo(sb, soId, poNumbers),
      });
    }
  }
  return j(200, { ok: true, tasks: claimed });
}

// Record the tracker's result, comment, and email the rep.
async function complete(sb, body) {
  const taskId = String(body.task_id || '').trim();
  if (!taskId) return j(400, { error: 'task_id required' });
  const status = ALLOWED_STATUS.has(body.status) ? body.status : 'done';
  const summary = String(body.summary || '').slice(0, 1000);
  const poReports = Array.isArray(body.po_reports) ? body.po_reports : [];
  const notFound = Array.isArray(body.pos_not_found) ? body.pos_not_found : [];
  const issues = Array.isArray(body.issues) ? body.issues : [];

  const { data: task } = await sb
    .from('assigned_todos').select('id,so_id,bot_payload').eq('id', taskId).maybeSingle();
  if (!task) return j(404, { error: 'task not found' });
  const soId = task.so_id || task.bot_payload?.so_id || body.so_id || null;

  // 1) Persist result onto the task.
  const merged = { ...(task.bot_payload || {}), result: { status, summary, po_reports: poReports, pos_not_found: notFound, issues, at: new Date().toISOString() } };
  await sb.from('assigned_todos')
    .update({ bot_status: status, bot_payload: merged, updated_at: new Date().toISOString() })
    .eq('id', taskId);

  // 2) Human-readable comment on the task.
  await postComment(sb, taskId, status, summary, poReports, notFound, issues);

  // 3) Email the rep (recipient resolved server-side from the SO).
  let emailed = false, emailSkip = null;
  if (body.notify !== false && soId) {
    const r = await emailRep(sb, soId, { status, summary, poReports, notFound });
    emailed = r.emailed; emailSkip = r.skip;
  }
  return j(200, { ok: true, emailed, emailSkip });
}

async function postComment(sb, taskId, status, summary, poReports, notFound, issues) {
  const emoji = status === 'done' ? '✅' : status === 'needs_input' ? '❓' : status === 'blocked' ? '🚧' : '❌';
  const sections = [`${emoji} **CLICK PO tracking — ${status}**`];
  if (summary) sections.push(summary);
  for (const p of poReports) {
    const head = `**${p.po || 'PO'}**${p.adidas_orders?.length ? ' · ' + p.adidas_orders.join(', ') : ''}${p.order_status ? ' · ' + p.order_status : ''}`;
    const lines = (p.items || []).map((it) => {
      const tag = it.state === 'shipped' ? '✅' : it.state === 'backordered' ? '⛔' : it.state === 'partial' ? '⏳' : '•';
      const bits = [`ordered ${it.ordered ?? '?'}`, `shipped ${it.shipped ?? 0}`, `to ship ${it.to_ship ?? 0}`];
      if (it.eta) bits.push(`ETA ${it.eta}`);
      if (it.tracking) bits.push(`track ${it.tracking}`);
      return `- ${tag} ${it.sku || ''} ${it.color || ''} ${it.size || ''} — ${bits.join(' · ')}`;
    });
    sections.push(head + (lines.length ? '\n' + lines.join('\n') : ''));
  }
  if (notFound.length) sections.push('**Not found in CLICK**\n' + notFound.map((x) => `- ${x}`).join('\n'));
  if (issues.length) sections.push('**Issues**\n' + issues.map((x) => `- ${x}`).join('\n'));
  const { error } = await sb.from('todo_comments').insert({
    id: 'cmt-track-' + Date.now(),
    todo_id: taskId,
    user_id: BOT_MEMBER_ID,
    text: sections.join('\n\n'),
    created_at: new Date().toISOString(),
  });
  if (error) console.warn('[so-po-tracker] comment insert failed:', error.message);
}

async function emailRep(sb, soId, { status, summary, poReports, notFound }) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey) return { emailed: false, skip: 'no BREVO_API_KEY' };

  const { data: so } = await sb.from('sales_orders').select('id,customer_id,created_by').eq('id', soId).maybeSingle();
  if (!so) return { emailed: false, skip: 'SO not found' };
  let custName = 'Customer', repId = so.created_by;
  if (so.customer_id) {
    const { data: c } = await sb.from('customers').select('name,primary_rep_id').eq('id', so.customer_id).maybeSingle();
    if (c) { custName = c.name || custName; if (c.primary_rep_id) repId = c.primary_rep_id; }
  }
  if (!repId) return { emailed: false, skip: 'no rep on SO' };
  const { data: rep } = await sb.from('team_members').select('name,email,is_active').eq('id', repId).maybeSingle();
  if (!rep || !rep.email || rep.is_active === false) return { emailed: false, skip: 'rep has no active email' };

  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
  const html = buildEmailHtml({ soId, custName, summary, poReports, notFound, portal });
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: rep.email, name: rep.name || '' }],
      subject: `Adidas order update — ${soId} (${custName})`,
      htmlContent: html,
    }),
  });
  if (!resp.ok) { console.error('[so-po-tracker] Brevo send failed:', await resp.text()); return { emailed: false, skip: 'brevo send failed' }; }
  return { emailed: true, skip: null };
}

function buildEmailHtml({ soId, custName, summary, poReports, notFound, portal }) {
  const tagOf = (s) => s === 'shipped' ? '<span style="color:#166534;font-weight:700">Shipped ✅</span>'
    : s === 'backordered' ? '<span style="color:#b91c1c;font-weight:700">Backordered ⛔</span>'
    : s === 'partial' ? '<span style="color:#92400e;font-weight:700">Partial ⏳</span>'
    : '<span style="color:#475569">Open</span>';
  const poBlocks = (poReports || []).map((p) => {
    const rows = (p.items || []).map((it) => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eef1f5">${esc(it.sku)} <span style="color:#94a3b8">${esc(it.color || '')}</span> ${esc(it.size || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef1f5;text-align:center">${it.ordered ?? '—'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef1f5;text-align:center">${it.shipped ?? 0}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef1f5;text-align:center">${it.to_ship ?? 0}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef1f5">${esc(it.eta || '')}${it.tracking ? `<br><span style="color:#64748b;font-size:11px">${esc(it.tracking)}</span>` : ''}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef1f5">${tagOf(it.state)}</td>
      </tr>`).join('');
    return `<div style="margin-top:18px">
        <div style="font-weight:800;color:#192853">${esc(p.po || 'PO')}${p.adidas_orders?.length ? ` <span style="font-weight:500;color:#64748b">· ${esc(p.adidas_orders.join(', '))}</span>` : ''}${p.order_status ? ` <span style="font-weight:500;color:#64748b">· ${esc(p.order_status)}</span>` : ''}</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">
          <tr style="color:#64748b;font-size:11px;text-transform:uppercase">
            <td style="padding:4px 8px">Item</td><td style="padding:4px 8px;text-align:center">Ord</td><td style="padding:4px 8px;text-align:center">Shp</td><td style="padding:4px 8px;text-align:center">To&nbsp;ship</td><td style="padding:4px 8px">ETA / tracking</td><td style="padding:4px 8px">Status</td>
          </tr>${rows || '<tr><td colspan="6" style="padding:8px;color:#94a3b8">No matching CLICK lines.</td></tr>'}
        </table>
      </div>`;
  }).join('');
  const nf = (notFound || []).length ? `<p style="margin-top:16px;color:#b91c1c">Not found in CLICK: ${notFound.map(esc).join(', ')}</p>` : '';
  const link = portal ? `<p style="margin-top:20px"><a href="${portal}/?so=${encodeURIComponent(soId)}" style="display:inline-block;background:#192853;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700">Open ${esc(soId)} in the portal</a></p>` : '';
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#2A2F3E;max-width:640px;margin:0 auto">
    <div style="background:#192853;color:#fff;padding:16px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.85">National Sports Apparel</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px">Adidas order update — ${esc(soId)}</div>
      <div style="font-size:13px;opacity:.85;margin-top:4px">${esc(custName)}</div>
    </div>
    <div style="border:1px solid #eef1f5;border-top:none;border-radius:0 0 10px 10px;padding:20px 22px">
      ${summary ? `<p style="margin:0 0 6px;font-size:15px">${esc(summary)}</p>` : ''}
      ${poBlocks || '<p style="color:#94a3b8">No open POs matched.</p>'}
      ${nf}
      ${link}
      <p style="font-size:11px;color:#94a3b8;margin-top:18px">Automated update from the NSA Portal, pulled from Adidas CLICK. Reply to this SO's task in the portal for anything that needs a human.</p>
    </div></div>`;
}
