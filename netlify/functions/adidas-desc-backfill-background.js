// One-time bulk backfill: clean EVERY adidas product description into
// products.description_ai using Claude Sonnet 4.6 via the Message Batches API
// (~50% cheaper than per-item calls; runs async server-side). The storefront view
// prefers description_ai, so this upgrades scraped vendor spec-dumps to clean
// ecommerce copy across the whole catalog (~4,500 items) in one batch.
//
// On-add cleanup (ai-clean-description.js) stays on Haiku for cheap single items;
// this is the higher-quality catalog-wide pass.
//
// Stateless: the product id is used as the batch custom_id (all adidas ids are
// short + URL-safe), so collecting results needs no mapping table. Idempotent +
// fill-empties: only adidas rows with a real description and no description_ai are
// submitted, so it's safe to re-run (each run creates a fresh batch — submit once).
//
// Actions (POST, ?action=…):
//   submit  (default) — build + create the batch, then auto-kick the poll/collect chain
//   status  &batch=ID — report processing_status + request_counts
//   collect &batch=ID — wait for the batch to end, then write results to description_ai
//
// Kick once after deploy (where ANTHROPIC_API_KEY is set), then it finishes itself:
//   curl -X POST https://<site>/.netlify/functions/adidas-desc-backfill-background
//
// Env: ANTHROPIC_API_KEY, REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, URL
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

const WRITE_CONCURRENCY = 20;          // parallel description_ai updates while collecting
const POLL_INTERVAL_MS = 60 * 1000;    // status check cadence while waiting on the batch
const TIME_BUDGET_MS = 13 * 60 * 1000; // re-invoke the poll chain before the 15-min cap
const MAX_ATTEMPTS = 24;               // safety cap on the poll chain (~5h of windows)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const anthropicHeaders = (apiKey) => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });

function actionOf(event) {
  try { return new URL(event.rawUrl).searchParams.get('action') || ''; } catch (e) { /* */ }
  try { return JSON.parse(event.body || '{}').action || ''; } catch (e) { return ''; }
}
function paramOf(event, key) {
  try { const v = new URL(event.rawUrl).searchParams.get(key); if (v != null) return v; } catch (e) { /* */ }
  try { return JSON.parse(event.body || '{}')[key]; } catch (e) { return undefined; }
}

// All adidas items with a real description but no AI copy yet (paged past the 1k cap).
async function loadTargets(admin) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('products')
      .select('id,name,description')
      .ilike('brand', '%adidas%')
      .not('description', 'is', null)
      .is('description_ai', null)
      .not('is_archived', 'is', true)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error('targets: ' + error.message);
    if (!data || !data.length) break;
    for (const r of data) if (r.description && String(r.description).trim()) out.push(r);
    if (data.length < 1000) break;
  }
  return out;
}

async function getBatch(apiKey, id) {
  const res = await fetch(BATCHES_URL + '/' + encodeURIComponent(id), { headers: anthropicHeaders(apiKey) });
  if (!res.ok) throw new Error('batch get ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 160));
  return res.json();
}

// Stream the JSONL results and write each succeeded completion to description_ai.
async function writeResults(apiKey, admin, resultsUrl) {
  const res = await fetch(resultsUrl, { headers: anthropicHeaders(apiKey) });
  if (!res.ok) throw new Error('results ' + res.status);
  const lines = (await res.text()).split('\n').map((l) => l.trim()).filter(Boolean);
  let written = 0, failed = 0, empty = 0;
  for (let i = 0; i < lines.length; i += WRITE_CONCURRENCY) {
    await Promise.all(lines.slice(i, i + WRITE_CONCURRENCY).map(async (line) => {
      let rec; try { rec = JSON.parse(line); } catch (e) { failed++; return; }
      const id = rec && rec.custom_id;
      const r = rec && rec.result;
      if (!id || !r || r.type !== 'succeeded') { failed++; return; }
      const text = (r.message?.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
      if (!text) { empty++; return; } // leave null so on-add / a re-run can retry it
      const { error } = await admin
        .from('products')
        .update({ description_ai: text, description_ai_at: new Date().toISOString() })
        .eq('id', id);
      if (error) { failed++; console.error('[desc-backfill] update', id, error.message); } else written++;
    }));
  }
  return { written, failed, empty, total: lines.length };
}

exports.handler = async (event) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 200, body: JSON.stringify({ ok: false, reason: 'missing_api_key' }) };
  const site = (process.env.URL || '').replace(/\/+$/, '');
  let admin; try { admin = getSupabaseAdmin(); } catch (e) { return { statusCode: 500, body: e.message }; }

  const action = actionOf(event) || 'submit';
  const reinvoke = (qs) => { if (site) fetch(site + '/.netlify/functions/adidas-desc-backfill-background?' + qs, { method: 'POST' }).catch(() => {}); };

  try {
    // ---- SUBMIT: build the batch from current targets and create it. ----
    if (action === 'submit') {
      const targets = await loadTargets(admin);
      if (!targets.length) return { statusCode: 200, body: JSON.stringify({ ok: true, submitted: 0, note: 'nothing to backfill' }) };
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
      if (!res.ok) return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'create ' + res.status, detail: data }) };
      console.log(`[desc-backfill] submitted batch=${data.id} count=${requests.length}`);
      reinvoke('action=collect&batch=' + encodeURIComponent(data.id) + '&attempt=0'); // auto-poll
      return { statusCode: 200, body: JSON.stringify({ ok: true, batch_id: data.id, submitted: requests.length, processing_status: data.processing_status }) };
    }

    // ---- STATUS: one-shot inspection. ----
    if (action === 'status') {
      const id = paramOf(event, 'batch');
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'batch id required' }) };
      const b = await getBatch(apiKey, id);
      return { statusCode: 200, body: JSON.stringify({ ok: true, batch_id: id, processing_status: b.processing_status, request_counts: b.request_counts }) };
    }

    // ---- COLLECT: wait for the batch to end (chaining across windows), then write. ----
    if (action === 'collect') {
      const id = paramOf(event, 'batch');
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'batch id required' }) };
      const attempt = parseInt(paramOf(event, 'attempt') || '0', 10) || 0;
      const started = Date.now();
      let b = await getBatch(apiKey, id);
      while (b.processing_status !== 'ended' && Date.now() - started < TIME_BUDGET_MS) {
        await sleep(POLL_INTERVAL_MS);
        b = await getBatch(apiKey, id);
      }
      if (b.processing_status !== 'ended') {
        if (attempt + 1 < MAX_ATTEMPTS) reinvoke('action=collect&batch=' + encodeURIComponent(id) + '&attempt=' + (attempt + 1));
        console.log(`[desc-backfill] still processing batch=${id} attempt=${attempt}`, b.request_counts);
        return { statusCode: 200, body: JSON.stringify({ ok: true, still_processing: true, attempt, request_counts: b.request_counts }) };
      }
      if (!b.results_url) return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'ended but no results_url', request_counts: b.request_counts }) };
      const summary = await writeResults(apiKey, admin, b.results_url);
      console.log(`[desc-backfill] done batch=${id}`, summary);
      return { statusCode: 200, body: JSON.stringify({ ok: true, batch_id: id, request_counts: b.request_counts, ...summary }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'unknown action: ' + action }) };
  } catch (e) {
    console.error('[desc-backfill]', action, e.message || e);
    return { statusCode: 500, body: JSON.stringify({ ok: false, action, error: e.message || String(e) }) };
  }
};
