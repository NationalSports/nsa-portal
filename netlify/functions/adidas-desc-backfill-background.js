// One-time bulk backfill: clean EVERY adidas product description into
// products.description_ai using Claude Sonnet 4.6 (higher-quality copy than the
// on-add ai-clean-description path, which stays on Haiku for cheap single items).
//
// The storefront view prefers description_ai, so this upgrades the scraped vendor
// spec-dumps to clean ecommerce copy across the whole catalog in one pass.
//
// Idempotent + fill-empties: only touches adidas rows that have a raw description
// but no description_ai yet, so it's safe to re-run / re-trigger. Processes a chunk
// per ~13-min window (background functions cap at 15) and re-invokes itself until
// the catalog is drained; terminates on its own when nothing is left (or MAX_PASSES).
//
// Kick once (after this deploys to a context where ANTHROPIC_API_KEY is set):
//   curl -X POST https://<site>/.netlify/functions/adidas-desc-backfill-background
//
// Env: ANTHROPIC_API_KEY, REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, URL
const { getSupabaseAdmin } = require('./_shared');

const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

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

const PAGE = 60;              // rows fetched per DB round-trip
const CONCURRENCY = 6;        // parallel Anthropic calls (keeps well under tier RPM)
const TIME_BUDGET_MS = 13 * 60 * 1000; // re-invoke before the 15-min function cap
const MAX_PASSES = 15;        // hard stop on the self-invoke chain (safety)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Light local fallback so a row that Claude returns nothing for still gets a
// non-null description_ai and isn't re-fetched forever. Mirrors the storefront's
// cleanDesc(): drop "LABEL: N/A" spec fields and squeeze separators/whitespace.
function stripFallback(s) {
  return String(s || '')
    .replace(/\b[A-Z][A-Z0-9 /&+-]*:\s*N\/?A\b\.?/g, ' ')
    .replace(/\s*·\s*(?=·)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s·.]+|[\s·]+$/g, '')
    .trim();
}

async function cleanOne(apiKey, name, raw) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Product: ${name || '(unnamed)'}\n\nRaw description:\n${String(raw).slice(0, 4000)}` }],
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      return (data.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
    }
    // Back off on rate-limit / overload / transient server errors; fail fast otherwise.
    if (resp.status === 429 || resp.status === 529 || resp.status >= 500) {
      await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s, 8s
      continue;
    }
    const t = await resp.text().catch(() => '');
    throw new Error('anthropic ' + resp.status + ' ' + t.slice(0, 160));
  }
  throw new Error('anthropic retries exhausted');
}

function passFrom(event) {
  try { return parseInt(new URL(event.rawUrl).searchParams.get('pass') || '0', 10) || 0; } catch (e) { /* */ }
  try { return parseInt(JSON.parse(event.body || '{}').pass || '0', 10) || 0; } catch (e) { /* */ }
  return 0;
}

exports.handler = async (event) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 200, body: JSON.stringify({ ok: false, reason: 'missing_api_key' }) };

  const site = (process.env.URL || '').replace(/\/+$/, '');
  const pass = passFrom(event);
  let admin;
  try { admin = getSupabaseAdmin(); } catch (e) { return { statusCode: 500, body: e.message }; }

  const started = Date.now();
  let cleaned = 0, errors = 0, fetched = 0, more = false;

  while (Date.now() - started < TIME_BUDGET_MS) {
    // Adidas items with a real description but no AI copy yet (the PATCH below
    // removes each from this filter, so paging just walks the remaining set).
    const { data: rows, error } = await admin
      .from('products')
      .select('id,name,description')
      .ilike('brand', '%adidas%')
      .not('description', 'is', null)
      .is('description_ai', null)
      .not('is_archived', 'is', true)
      .limit(PAGE);
    if (error) { console.error('[desc-backfill] query', error.message); more = true; break; }
    if (!rows || !rows.length) { more = false; break; } // catalog drained
    fetched += rows.length;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      if (Date.now() - started > TIME_BUDGET_MS) { more = true; break; }
      await Promise.all(rows.slice(i, i + CONCURRENCY).map(async (r) => {
        const raw = String(r.description || '').trim();
        let text = '';
        try { text = raw ? await cleanOne(apiKey, r.name, raw) : ''; }
        catch (e) { errors++; console.error('[desc-backfill]', r.id, e.message || e); return; }
        if (!text) text = stripFallback(raw); // ensure non-null so the row isn't retried
        const { error: uErr } = await admin
          .from('products')
          .update({ description_ai: text, description_ai_at: new Date().toISOString() })
          .eq('id', r.id);
        if (uErr) { errors++; console.error('[desc-backfill] update', r.id, uErr.message); } else cleaned++;
      }));
    }
    more = true; // assume more until a fetch comes back empty
  }

  // Chain to the next window if work likely remains (and we're under the safety cap).
  let reinvoked = false;
  if (more && pass < MAX_PASSES && site) {
    reinvoked = true;
    fetch(site + '/.netlify/functions/adidas-desc-backfill-background?pass=' + (pass + 1), { method: 'POST' }).catch(() => {});
  }
  console.log(`[desc-backfill] pass=${pass} cleaned=${cleaned} errors=${errors} fetched=${fetched} reinvoked=${reinvoked}`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, pass, cleaned, errors, fetched, reinvoked }) };
};
