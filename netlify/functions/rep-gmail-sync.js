// "My Email": read each connected rep's new Primary-inbox mail, ask Claude
// which messages matter, and store the summary / tasks / deadlines in
// rep_email_insights. Only a short snippet is kept — never the full body.
//
// Runs on a schedule (netlify.toml) for every connected rep, or on demand for
// the signed-in rep only (POST with a portal bearer token: the "Check now" button).
// Nothing is sent, labelled or modified in Gmail; this only reads.
const { corsHeaders, verifyUser, getSupabaseAdmin } = require('./_shared');
const { gmailFetch, getMessage, parseMessage } = require('./_gmailAi');
const { accessTokenForLink } = require('./_repGoogle');

const MODEL = process.env.REP_EMAIL_MODEL || 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MAX_PER_REP = Number(process.env.REP_EMAIL_MAX_PER_RUN || 6);
const RUN_BUDGET_MS = 20000; // stay under the 26s function timeout
const FIRST_SYNC_QUERY = 'newer_than:3d';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SYSTEM = [
  'You triage a sales rep\'s inbox at National Sports Apparel (NSA), a team uniform and apparel dealer for high school and college athletic programs.',
  'Important = needs the rep to do something or know something soon: a coach/AD/school asking for a quote, order, change, sizes, artwork, pricing, or status; order problems; deadlines (in-hands dates, season start, booking cutoffs, board/budget approvals); payments; vendor issues affecting a customer order.',
  'Not important = newsletters, marketing, receipts with no action, automated notifications with nothing to do, internal FYI with no ask.',
  'Extract concrete tasks for the rep (short imperative titles, e.g. "Send revised quote for varsity football polos") and dated deadlines. Resolve relative dates ("next Friday", "end of month") against the email\'s received date. Use null when no date is stated. Never invent dates, names, prices or facts.',
  'Respond with ONLY a JSON object, no prose:',
  '{"important": boolean, "reason": "one short line why", "summary": "1-2 sentences the rep can read in 5 seconds", "tasks": [{"title": string, "due_date": "YYYY-MM-DD" | null}], "deadlines": [{"label": string, "date": "YYYY-MM-DD"}]}',
  'At most 4 tasks and 4 deadlines. Empty arrays when there are none.',
].join('\n');

const json = (statusCode, body) => ({ statusCode, headers: corsHeaders(), body: JSON.stringify(body) });

function isScheduledRun(event) {
  if (String(event.headers?.['x-nf-event'] || '').toLowerCase() === 'schedule') return true;
  try { return !!JSON.parse(event.body || '{}').next_run; } catch (_) { return false; }
}

// Drop quoted history so the model reads the new message, not the whole thread.
function newestPart(text) {
  const s = String(text || '');
  const cut = s.search(/\n(On .{5,200}wrote:|-{2,}\s*Original Message|From: .+\nSent: )/i);
  return (cut > 200 ? s.slice(0, cut) : s).slice(0, 8000);
}

function cleanStr(v, max) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

function normalizeAnalysis(raw) {
  const out = {
    important: raw?.important === true,
    reason: cleanStr(raw?.reason, 200),
    summary: cleanStr(raw?.summary, 600),
    tasks: [],
    deadlines: [],
  };
  for (const t of Array.isArray(raw?.tasks) ? raw.tasks.slice(0, 4) : []) {
    const title = cleanStr(t?.title, 180);
    if (title) out.tasks.push({ title, due_date: DATE_RE.test(String(t?.due_date || '')) ? t.due_date : null });
  }
  for (const d of Array.isArray(raw?.deadlines) ? raw.deadlines.slice(0, 4) : []) {
    const label = cleanStr(d?.label, 180);
    if (label && DATE_RE.test(String(d?.date || ''))) out.deadlines.push({ label, date: d.date });
  }
  return out;
}

async function analyze(parsed, { repName, customerName }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const received = parsed.received_at ? parsed.received_at.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const user = [
    `Rep: ${repName || 'the rep'}`,
    `Received: ${received}`,
    `From: ${parsed.sender_name ? `${parsed.sender_name} <${parsed.sender_email}>` : parsed.sender_email}`,
    `To: ${(parsed.to_emails || []).join(', ')}`,
    customerName ? `Matched portal customer: ${customerName}` : 'Matched portal customer: none',
    `Subject: ${parsed.subject || '(no subject)'}`,
    parsed.attachment_meta?.length ? `Attachments: ${parsed.attachment_meta.map((a) => a.filename).join(', ').slice(0, 300)}` : '',
    '',
    newestPart(parsed.text_body) || parsed.snippet || '',
  ].filter((line) => line !== '').join('\n');

  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, temperature: 0, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error('anthropic ' + resp.status + ' ' + t.slice(0, 200));
    }
    const data = await resp.json();
    const text = (data.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return normalizeAnalysis(JSON.parse(match[0])); } catch (_) { /* retry once */ }
    }
  }
  throw new Error('AI returned unreadable JSON');
}

async function findCustomer(admin, emails) {
  for (const email of emails) {
    if (!email || /@nationalsportsapparel\.com$/i.test(email)) continue;
    const { data } = await admin
      .from('customer_contacts')
      .select('customer_id, customers(name)')
      .ilike('email', email)
      .limit(1)
      .maybeSingle();
    if (data?.customer_id) return { id: data.customer_id, name: data.customers?.name || null };
  }
  return null;
}

async function syncLink(admin, link, deadline) {
  const result = { team_member_id: link.team_member_id, analyzed: 0, important: 0, error: null };
  try {
    const token = await accessTokenForLink(admin, link);
    const since = link.gmail_cursor_ms ? `after:${Math.floor(Number(link.gmail_cursor_ms) / 1000)}` : FIRST_SYNC_QUERY;
    const q = encodeURIComponent(`in:inbox category:primary -from:me ${since}`);
    const listed = await gmailFetch(token, `/messages?q=${q}&maxResults=50`);
    const ids = (listed.messages || []).map((m) => m.id);
    if (!ids.length) {
      await admin.from('rep_google_links').update({ last_synced_at: new Date().toISOString(), last_error: null }).eq('team_member_id', link.team_member_id);
      return result;
    }
    const { data: seen } = await admin
      .from('rep_email_insights')
      .select('gmail_message_id')
      .eq('team_member_id', link.team_member_id)
      .in('gmail_message_id', ids);
    const seenSet = new Set((seen || []).map((r) => r.gmail_message_id));
    // Gmail lists newest first; work oldest first so the cursor only moves forward.
    const todo = ids.filter((id) => !seenSet.has(id)).reverse().slice(0, MAX_PER_REP);

    const { data: rep } = await admin.from('team_members').select('name').eq('id', link.team_member_id).maybeSingle();
    let cursor = Number(link.gmail_cursor_ms || 0);
    for (const id of todo) {
      if (Date.now() > deadline) break;
      const parsed = parseMessage(await getMessage(token, id));
      const customer = await findCustomer(admin, [parsed.sender_email, ...(parsed.to_emails || []), ...(parsed.cc_emails || [])]
        .filter((e) => e && e !== link.google_email));
      let analysis;
      try {
        analysis = await analyze(parsed, { repName: rep?.name, customerName: customer?.name });
      } catch (err) {
        // A single email the model can't parse must not block the mailbox forever;
        // anything else (API down, missing key) stops the run so it retries later.
        if (!/unreadable JSON/.test(err.message)) throw err;
        analysis = { important: true, reason: 'AI could not read this email. Open it in Gmail.', summary: null, tasks: [], deadlines: [] };
      }
      const { error } = await admin.from('rep_email_insights').upsert({
        team_member_id: link.team_member_id,
        gmail_message_id: parsed.gmail_message_id,
        gmail_thread_id: parsed.gmail_thread_id,
        internet_message_id: parsed.internet_message_id,
        references_header: parsed.references_header ? String(parsed.references_header).slice(0, 4000) : null,
        sender_email: parsed.sender_email,
        sender_name: parsed.sender_name,
        subject: cleanStr(parsed.subject, 300),
        snippet: cleanStr(parsed.snippet, 300),
        received_at: parsed.received_at,
        customer_id: customer?.id || null,
        important: analysis.important,
        importance_reason: analysis.reason,
        summary: analysis.summary,
        tasks: analysis.tasks,
        deadlines: analysis.deadlines,
      }, { onConflict: 'team_member_id,gmail_message_id', ignoreDuplicates: true });
      if (error) throw new Error(`Saving insight failed: ${error.message}`);
      result.analyzed += 1;
      if (analysis.important) result.important += 1;
      const internal = parsed.received_at ? Date.parse(parsed.received_at) : 0;
      if (internal > cursor) cursor = internal;
    }
    await admin.from('rep_google_links').update({
      gmail_cursor_ms: cursor || null,
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('team_member_id', link.team_member_id);
  } catch (err) {
    result.error = String(err.message || err).slice(0, 500);
    console.error('[rep-gmail-sync]', link.team_member_id, result.error);
    // accessTokenForLink already records a reconnect message for revoked grants.
    if (!/revoked or expired/i.test(result.error)) {
      await admin.from('rep_google_links').update({ last_error: result.error, updated_at: new Date().toISOString() })
        .eq('team_member_id', link.team_member_id);
    }
  }
  return result;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  const deadline = Date.now() + RUN_BUDGET_MS;

  if (isScheduledRun(event)) {
    const admin = getSupabaseAdmin();
    const { data: links, error } = await admin.from('rep_google_links').select('*').order('last_synced_at', { ascending: true, nullsFirst: true });
    if (error) return json(500, { error: error.message });
    const results = [];
    for (const link of links || []) {
      if (Date.now() > deadline) break;
      results.push(await syncLink(admin, link, deadline));
    }
    return json(200, { ok: true, results });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const auth = await verifyUser(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const { data: link, error } = await auth.admin.from('rep_google_links').select('*').eq('team_member_id', auth.teamMemberId).maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!link) return json(400, { error: 'Connect Google first' });
  const result = await syncLink(auth.admin, link, deadline);
  return json(result.error ? 500 : 200, { ok: !result.error, ...result });
};
