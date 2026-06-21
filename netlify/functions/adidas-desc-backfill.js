// One-time bulk backfill: clean EVERY adidas product description into
// products.description_ai using Claude Sonnet 4.6 via the Message Batches API
// (~50% cheaper than per-item calls; processed async server-side). The storefront
// view prefers description_ai, so this upgrades scraped vendor spec-dumps to clean
// ecommerce copy across the whole catalog (~4,500 items) in one batch.
//
// On-add cleanup (ai-clean-description.js) stays on Haiku for cheap single items;
// this is the higher-quality catalog-wide pass.
//
// Synchronous (26s timeout — see netlify.toml) so each step returns actionable
// JSON. Stateless: the product id is the batch custom_id (all adidas ids are short
// + URL-safe), so collecting needs no mapping table. Idempotent + fill-empties:
// only adidas rows with a real description and no description_ai are submitted, and
// writes are guarded on description_ai IS NULL, so submit/collect are safe to repeat.
//
// Drive it (POST, ?action=…):
//   submit  (default) — build + create the batch; returns { batch_id, submitted }
//   status  &batch=ID — { processing_status, request_counts }; poll until "ended"
//   collect &batch=ID — once ended, write results to description_ai; returns
//                       { written, failed, empty, remaining }. Re-call if remaining>0.
//
// Env: ANTHROPIC_API_KEY, REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
const { getSupabaseAdmin } = require('./_shared');

const MODEL = 'claude-sonnet-4-6';
const BATCHES_URL = 'https://api.anthropic.com/v1/messages/batches';

// Mirrors the prompt in ai-clean-description.js so backfilled and on-add copy match.
const SYSTEM = [
  'You rewrite raw vendor product descriptions into clean, friendly ecommerce copy for a youth/team apparel webstore.',
  'Rules:',
  "- Stay accurate to the source. Never invent materials, features, technologies, or claims that aren't in the input.",
  '- Remove spec-sheet noise: drop empty fields like "WOVEN: N/A" / "HOOD: N/A", style/SKU codes, color codes, and ALL-CAPS label dumps.',
  '- Fix odd casing and spacing; expand an abbreviation only when it is unambiguous.',
  '- Write 1-3 short, plain sentences. You may add a brief list of real features (fabric, fit, closures) when the source clearly states them.',
  '- No marketing hype, no sizes, no prices, no stock/availability, no brand boilerplate.',
  '- Output ONLY the cleaned description text. No preamble, no quotes, no headings.',
].join('\n');

const WRITE_CONCURRENCY = 30;
const anthropicHeaders = (apiKey) => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
const json = (statusCode, obj) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });

function actionOf(event) {
  try { return new URL(event.rawUrl).searchParams.get('action') || ''; } catch (e) { /* */ }
  try { return JSON.parse(event.body || '{}').action || ''; } catch (e) { return ''; }
}
function paramOf(event, key) {
  try { const v = new URL(event.rawUrl).searchParams.get(key); if (v != null) return v; } catch (e) { /* */ }
  try { return JSON.parse(event.body || '{}')[key]; } catch (e) { return undefined; }
}

// Adidas items with a real description but no AI copy yet (paged past the 1k cap).
async function loadTargets(admin, withDesc) {
  const out = [];
  const cols = withDesc ? 'id,name,description' : 'id';
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('products')
      .select(cols)
      .ilike('brand', '%adidas%')
      .not('description', 'is', null)
      .is('description_ai', null)
      .not('is_archived', 'is', true)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error('targets: ' + error.message);
    if (!data || !data.length) break;
    for (const r of data) if (!withDesc || (r.description && String(r.description).trim())) out.push(r);
    if (data.length < 1000) break;
  }
  return out;
}

async function getBatch(apiKey, id) {
  const res = await fetch(BATCHES_URL + '/' + encodeURIComponent(id), { headers: anthropicHeaders(apiKey) });
  if (!res.ok) throw new Error('batch get ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 160));
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(200, { ok: false, reason: 'missing_api_key' });
  let admin; try { admin = getSupabaseAdmin(); } catch (e) { return json(500, { error: e.message }); }
  const action = actionOf(event) || 'submit';

  try {
    // ---- SUBMIT: build the batch from current targets and create it. ----
    if (action === 'submit') {
      const targets = await loadTargets(admin, true);
      if (!targets.length) return json(200, { ok: true, submitted: 0, note: 'nothing to backfill' });
      const requests = targets.map((r) => ({
        custom_id: r.id,
        params: {
          model: MODEL,
          max_tokens: 400,
          system: SYSTEM,
          messages: [{ role: 'user', content: `Product: ${r.name || '(unnamed)'}\n\nRaw description:\n${String(r.description).slice(0, 4000)}` }],
        },
      }));
      const res = await fetch(BATCHES_URL, { method: 'POST', headers: anthropicHeaders(apiKey), body: JSON.stringify({ requests }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json(502, { ok: false, error: 'create ' + res.status, detail: data });
      return json(200, { ok: true, batch_id: data.id, submitted: requests.length, processing_status: data.processing_status });
    }

    // ---- STATUS: poll target. ----
    if (action === 'status') {
      const id = paramOf(event, 'batch');
      if (!id) return json(400, { error: 'batch id required' });
      const b = await getBatch(apiKey, id);
      return json(200, { ok: true, batch_id: id, processing_status: b.processing_status, request_counts: b.request_counts });
    }

    // ---- COLLECT: once ended, write succeeded results to description_ai. ----
    if (action === 'collect') {
      const id = paramOf(event, 'batch');
      if (!id) return json(400, { error: 'batch id required' });
      const b = await getBatch(apiKey, id);
      if (b.processing_status !== 'ended') return json(200, { ok: true, still_processing: true, request_counts: b.request_counts });
      if (!b.results_url) return json(500, { ok: false, error: 'ended but no results_url', request_counts: b.request_counts });

      // Only touch rows still needing copy, so re-calls (and timeouts) stay cheap + safe.
      const remaining = new Set((await loadTargets(admin, false)).map((r) => r.id));
      const res = await fetch(b.results_url, { headers: anthropicHeaders(apiKey) });
      if (!res.ok) return json(502, { ok: false, error: 'results ' + res.status });
      const lines = (await res.text()).split('\n').map((l) => l.trim()).filter(Boolean);

      let written = 0, failed = 0, empty = 0;
      const todo = [];
      for (const line of lines) {
        let rec; try { rec = JSON.parse(line); } catch (e) { failed++; continue; }
        const cid = rec && rec.custom_id, r = rec && rec.result;
        if (!cid || !remaining.has(cid)) continue;          // already written or not a target
        if (!r || r.type !== 'succeeded') { failed++; continue; }
        const text = (r.message?.content || []).filter((x) => x && x.type === 'text').map((x) => x.text).join('').trim();
        if (!text) { empty++; continue; }
        todo.push({ id: cid, text });
      }
      for (let i = 0; i < todo.length; i += WRITE_CONCURRENCY) {
        await Promise.all(todo.slice(i, i + WRITE_CONCURRENCY).map(async ({ id: pid, text }) => {
          const { error } = await admin
            .from('products')
            .update({ description_ai: text, description_ai_at: new Date().toISOString() })
            .eq('id', pid)
            .is('description_ai', null);
          if (error) { failed++; console.error('[desc-backfill] update', pid, error.message); } else written++;
        }));
      }
      return json(200, { ok: true, batch_id: id, request_counts: b.request_counts, results: lines.length, written, failed, empty, remaining: Math.max(0, remaining.size - written) });
    }

    return json(400, { error: 'unknown action: ' + action });
  } catch (e) {
    console.error('[desc-backfill]', action, e.message || e);
    return json(500, { ok: false, action, error: e.message || String(e) });
  }
};
