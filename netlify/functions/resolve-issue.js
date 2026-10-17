// Diagnose a reported issue with Claude, right inside the portal's Issues page.
//
// A salesperson reports something ("artwork dropped off SO-1234", "sizes missing")
// from any page; the report already captures the page they were on, the exact
// record they were viewing (e.g. "Editing SO-1234"), and the last few console
// errors. This function takes that issue, pulls the actual referenced record(s)
// from Supabase so Claude has the real data (no copy-pasting into the Claude app),
// and asks Claude to triage it: what's going on, the likely cause, a concrete fix,
// and a friendly message to send back to whoever reported it.
//
// DIAGNOSE-ONLY: this never writes to live order data. It reads + reasons and
// returns a structured result; the portal posts Claude's note into the issue's
// conversation thread (which notifies the reporter) and optionally marks it
// resolved. Staff-gated; a graceful no-op until ANTHROPIC_API_KEY is set.
const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');
const { ALLOWED, validateFix } = require('./_issueFixPolicy');

const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM = [
  'You are a support engineer for National Sports Apparel\'s internal operations portal',
  '(orders, estimates, customers, vendors, webstores, artwork, inventory, shipping; React + Supabase).',
  'A staff member reported an issue. You are given the report plus the actual database record(s) it refers to.',
  'Triage it: figure out what is wrong, the most likely cause, and the concrete fix a staff member should apply.',
  '',
  'Rules:',
  '- Ground your answer in the provided data. If the data contradicts the report, say so.',
  '- Be specific: reference the order/estimate id, the field, the line item.',
  '- Do NOT claim you changed anything — you only diagnose. Describe the fix; you do not apply it.',
  '- If the report is too vague to act on, set verdict to "needs_info" and say exactly what you need.',
  '- Only set "resolved" to true when no real action is needed (already correct, transient, duplicate, not a real problem).',
  '- The reporter is not technical. Write reporter_message directly to them, warm and plain, no jargon, 1-3 sentences.',
  '',
  'Respond with ONLY a JSON object (no prose, no markdown fences) of this exact shape:',
  '{',
  '  "verdict": "data_issue" | "code_bug" | "user_error" | "not_reproducible" | "question" | "needs_info",',
  '  "summary": "1-2 sentences: what is going on, in plain language",',
  '  "cause": "the most likely root cause, referencing the specific data",',
  '  "fix": "concrete step-by-step fix for a staff member (or what info is needed)",',
  '  "confidence": "high" | "medium" | "low",',
  '  "resolved": true | false,',
  '  "reporter_message": "a short, friendly note written directly to the person who reported it",',
  '  "proposed_fix": null OR { "table": "...", "id": "...", "changes": { "column": newValue }, "explanation": "what this changes" }',
  '}',
  '',
  'About proposed_fix (optional — usually null):',
  '- Only include it for a clear data_issue where you are confident, AND the fix is a simple field correction.',
  '- "table" MUST be one of these and "changes" may ONLY use these columns (anything else is ignored):',
  '  ' + JSON.stringify(ALLOWED),
  '- "id" must be the exact id of a record shown in the provided data (e.g. "SO-1234").',
  '- Put the corrected value in changes. Never touch money, pricing, tax, status, ids, or fulfillment fields.',
  '- If the right fix is outside those columns, leave proposed_fix null and just describe it in "fix".',
].join('\n');

// Pull the id tokens (SO-1234 / EST-1234 / INV-1234) out of the free-text context.
function extractIds(text) {
  const out = { so: [], est: [], inv: [] };
  const s = String(text || '');
  (s.match(/SO-\d+/gi) || []).forEach((m) => out.so.push(m.toUpperCase()));
  (s.match(/EST-\d+/gi) || []).forEach((m) => out.est.push(m.toUpperCase()));
  (s.match(/INV-\d+/gi) || []).forEach((m) => out.inv.push(m.toUpperCase()));
  out.so = [...new Set(out.so)].slice(0, 3);
  out.est = [...new Set(out.est)].slice(0, 3);
  out.inv = [...new Set(out.inv)].slice(0, 3);
  return out;
}

// "Viewing customer: Acme" / "Viewing vendor: SanMar" → the name, for a lookup.
function extractName(viewing, label) {
  const m = new RegExp(label + ':\\s*(.+)$', 'i').exec(String(viewing || ''));
  return m ? m[1].trim() : null;
}

// Keep the JSON we hand Claude bounded so a fat order row can't blow the token budget.
function trim(obj, max = 6000) {
  try {
    const s = JSON.stringify(obj);
    return s.length > max ? s.slice(0, max) + '…(truncated)' : s;
  } catch { return ''; }
}

async function gatherContext(admin, issue) {
  const blob = [issue.viewing, issue.description].filter(Boolean).join(' ');
  const ids = extractIds(blob);
  const ctx = {};

  if (ids.so.length) {
    const { data } = await admin.from('sales_orders').select('*').in('id', ids.so);
    if (data && data.length) ctx.sales_orders = data;
  }
  if (ids.est.length) {
    const { data } = await admin.from('estimates').select('*').in('id', ids.est);
    if (data && data.length) ctx.estimates = data;
  }
  if (ids.inv.length) {
    const { data } = await admin.from('invoices').select('*').in('id', ids.inv);
    if (data && data.length) ctx.invoices = data;
  }
  const custName = extractName(issue.viewing, 'Viewing customer');
  if (custName) {
    const { data } = await admin.from('customers').select('*').ilike('name', `%${custName}%`).limit(2);
    if (data && data.length) ctx.customers = data;
  }
  const vendName = extractName(issue.viewing, 'Viewing vendor');
  if (vendName) {
    const { data } = await admin.from('vendors').select('*').ilike('name', `%${vendName}%`).limit(2);
    if (data && data.length) ctx.vendors = data;
  }
  return ctx;
}

function parseResult(text) {
  let t = String(text || '').trim();
  // Tolerate ```json fences or stray prose around the object.
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first !== -1 && last !== -1) t = t.slice(first, last + 1);
  const r = JSON.parse(t);
  const out = {
    verdict: r.verdict || 'question',
    summary: r.summary || '',
    cause: r.cause || '',
    fix: r.fix || '',
    confidence: r.confidence || 'low',
    resolved: r.resolved === true,
    reporter_message: r.reporter_message || '',
    proposed_fix: null,
  };
  // Run any proposed write-back through the same policy the apply endpoint enforces,
  // so the portal can show an "Apply fix" button only when it's genuinely applicable.
  if (r.proposed_fix && typeof r.proposed_fix === 'object') {
    const v = validateFix(r.proposed_fix);
    out.proposed_fix = v.ok
      ? { table: v.table, id: v.id, changes: v.changes, rejected: v.rejected, explanation: r.proposed_fix.explanation || '', applicable: true }
      : { table: r.proposed_fix.table, id: r.proposed_fix.id, changes: r.proposed_fix.changes || {}, explanation: r.proposed_fix.explanation || '', applicable: false, reason: v.reason };
  }
  return out;
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const auth = await verifyUser(event);
  if (!auth.ok) return { statusCode: auth.status, headers, body: JSON.stringify({ error: auth.error }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: 'missing_api_key' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad JSON' }) }; }
  const issue = body.issue;
  if (!issue || !issue.description) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing issue' }) };

  try {
    const admin = getSupabaseAdmin();
    let ctx = {};
    try { ctx = await gatherContext(admin, issue); } catch (e) { console.warn('[resolve-issue] context lookup failed:', e.message); }

    const errs = (issue.recent_errors || []).map((e) => e && (e.msg || e)).filter(Boolean).slice(0, 5);
    const userMsg = [
      `Report: ${issue.description}`,
      `Priority: ${issue.priority || 'unspecified'}`,
      `Page: ${issue.page || 'unknown'}`,
      issue.viewing ? `Was viewing: ${issue.viewing}` : '',
      `Reported by: ${issue.reported_by || 'unknown'} (${issue.role || '?'})`,
      errs.length ? `Console errors at report time:\n${errs.join('\n')}` : '',
      Object.keys(ctx).length
        ? `Related records pulled from the database:\n${trim(ctx)}`
        : 'No matching order/estimate/customer record was found from the report context.',
    ].filter(Boolean).join('\n\n');

    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'anthropic ' + resp.status + ' ' + t.slice(0, 200) }) };
    }
    const data = await resp.json();
    const raw = (data.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();

    let result;
    try { result = parseResult(raw); }
    catch { return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not parse Claude response', raw: raw.slice(0, 400) }) }; }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, result, context_found: Object.keys(ctx) }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
