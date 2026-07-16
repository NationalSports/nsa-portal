// Coach lead enrichment — daily, scheduled via netlify.toml ([functions."coach-leads-enrich"]).
//
// For NEW coach_leads that have a school, this asks Claude (Haiku — cheap) to find the
// school's official athletic team colors + mascot and writes suggestions back, advancing
// status new → enriched. Logos stay MANUAL (staff set logo_url), so this never touches it.
//
// Two-call Haiku design (web search + structured output can't share one request):
//   A. Research — a web_search call. Haiku 4.5 only supports the basic web_search_20250305
//      variant (NOT the newer web_search_20260209), and structured output (output_config)
//      is incompatible with web-search citations, so it can't be combined here — it would
//      400. We handle the server-tool pause_turn loop and concatenate the text blocks.
//   B. Extract — a separate call with output_config.format json_schema (no tools) that
//      turns the research prose into a constrained JSON payload we can parse safely.
//
// Idempotent: only status='new' leads are selected, so a re-run never re-touches a lead
// staff or a prior run already enriched/edited. `enrichment` stores the full AI payload;
// `colors` gets the catalog-friendly color-family names the store builder consumes.
//
// Feeds the auto-store-creation funnel — see COACH_AUTO_STORE_PLAN_2026-07-10.md Phase 2.

const { getSupabaseAdmin } = require('./_shared');

const MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Cap the work per invocation so we finish well under the function's wall-clock limit.
const MAX_PER_CALL = 10;
const TIME_BUDGET_MS = 18000;
const PAUSE_TURN_LIMIT = 4;

const RESEARCH_SYSTEM = [
  "Find the OFFICIAL team colors, mascot, and (if visible) primary/secondary hex codes",
  "for a US school's athletics program. Use the school name and sport to disambiguate",
  'between schools that share a name. Be concise. If you are unsure, say so plainly —',
  'do not guess a mascot or colors that you cannot find.',
].join(' ');

const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    // Catalog-friendly color family names ("Red", "Navy", "Gold") — what the store builder consumes.
    color_names: { type: 'array', items: { type: 'string' } },
    primary_hex: { type: 'string' },
    accent_hex: { type: 'string' },
    mascot: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    summary: { type: 'string' },
  },
  required: ['color_names', 'confidence'],
};

const EXTRACT_SYSTEM = [
  'Extract structured team-brand data from the research notes.',
  'Only use facts present in the notes. If a field is unknown, use an empty string',
  '(or [] for color_names) and lower the confidence. Output must match the schema.',
].join(' ');

const textOf = (content) =>
  (content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');

async function anthropic(apiKey, payload) {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error('anthropic ' + resp.status + ' ' + t.slice(0, 200));
  }
  return resp.json();
}

// Call A — web search. Haiku 4.5 requires the basic web_search_20250305 variant, and we
// drive the server-tool loop ourselves (re-POST on stop_reason 'pause_turn'). Returns the
// concatenated research text (possibly empty).
async function researchSchool(apiKey, school, sport) {
  const messages = [{
    role: 'user',
    content: `School: ${school}\nSport: ${sport || 'unknown'}\nFind this school's official athletic team colors and mascot.`,
  }];
  const base = {
    model: MODEL,
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    system: RESEARCH_SYSTEM,
  };

  let data = await anthropic(apiKey, { ...base, messages });
  let text = textOf(data.content);
  for (let i = 0; i < PAUSE_TURN_LIMIT && data.stop_reason === 'pause_turn'; i++) {
    messages.push({ role: 'assistant', content: data.content });
    data = await anthropic(apiKey, { ...base, messages });
    text += textOf(data.content);
  }
  return text.trim();
}

// Call B — structured extraction (no tools; output_config constrains it to EXTRACT_SCHEMA).
// Returns the parsed object, or throws if the constrained JSON won't parse.
async function extractBrand(apiKey, researchText) {
  const data = await anthropic(apiKey, {
    model: MODEL,
    max_tokens: 512,
    output_config: { format: { type: 'json_schema', schema: EXTRACT_SCHEMA } },
    system: EXTRACT_SYSTEM,
    messages: [{ role: 'user', content: researchText }],
  });
  return JSON.parse(textOf(data.content));
}

// Build the enrichment payload + update patch from an extracted object. Kept pure and
// exported so the color-handling rule (only overwrite colors when non-empty) is unit-testable.
function buildEnrichment(parsed, researchLen) {
  const colorNames = Array.isArray(parsed.color_names) ? parsed.color_names.filter(Boolean) : [];
  const enrichment = {
    color_names: colorNames,
    primary_hex: parsed.primary_hex || '',
    accent_hex: parsed.accent_hex || '',
    mascot: parsed.mascot || '',
    confidence: parsed.confidence || 'low',
    summary: parsed.summary || '',
    source: 'haiku-web-search',
    researched_len: researchLen,
  };
  const patch = {
    enrichment,
    status: 'enriched',
    enriched_at: new Date().toISOString(),
  };
  // Only overwrite the store-builder colors when we actually found some — an empty result
  // must leave a staff-picked (or previously-enriched) colors array untouched.
  if (colorNames.length) patch.colors = colorNames;
  return { enrichment, patch };
}

// Build the patch for a lead whose research came back empty, or whose research/extract
// call threw. Tracks attempts in the enrichment jsonb so a school that can't be found (or
// keeps erroring) doesn't get retried forever: once attempts reaches 3 the lead goes
// terminal (status 'enrich_failed'), which the handler's status='new' query filter then
// excludes from every future run automatically. Below that, status stays 'new' so the next
// scheduled run retries it. Pure/exported for testing.
function buildAttemptPatch(existingEnrichment, errMessage) {
  const prior = (existingEnrichment && typeof existingEnrichment === 'object' && Number(existingEnrichment.attempts)) || 0;
  const attempts = prior + 1;
  const enrichment = {
    ...(existingEnrichment || {}),
    attempts,
    last_error: String(errMessage || '').trim().slice(0, 300),
  };
  return { enrichment, patch: { enrichment, status: attempts >= 3 ? 'enrich_failed' : 'new' } };
}

exports.handler = async () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'ANTHROPIC_API_KEY not configured' }) };
  }

  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from('coach_leads')
    .select('id,school,sport,enrichment')
    .eq('status', 'new')
    .not('school', 'is', null)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_CALL);
  if (error) return { statusCode: 500, body: JSON.stringify({ ok: false, error: error.message }) };

  const targets = (rows || []).filter((r) => r.school && String(r.school).trim());

  const started = Date.now();
  let processed = 0;
  let enriched = 0;
  let skippedNoData = 0;
  const errors = [];

  for (const lead of targets) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    processed++;
    try {
      const research = await researchSchool(apiKey, String(lead.school).trim(), lead.sport);
      if (!research) {
        // No data found — count the attempt (caps at 3 tries before going terminal) but
        // don't treat the empty result itself as an error worth surfacing.
        skippedNoData++;
        const { patch } = buildAttemptPatch(lead.enrichment, 'No research results found');
        const { error: uErr } = await admin.from('coach_leads').update(patch).eq('id', lead.id);
        if (uErr) errors.push(lead.id + ': ' + uErr.message);
        continue;
      }

      const parsed = await extractBrand(apiKey, research); // throws on unparseable JSON
      const { patch } = buildEnrichment(parsed, research.length);

      const { error: uErr } = await admin.from('coach_leads').update(patch).eq('id', lead.id);
      if (uErr) { errors.push(lead.id + ': ' + uErr.message); continue; } // stays 'new'
      enriched++;
    } catch (e) {
      // One bad lead must not abort the batch. Track the attempt so a lead that keeps
      // erroring eventually goes terminal instead of retrying forever; best-effort (if
      // this write also fails, the lead simply stays 'new' and retries next run, same as
      // before this hardening).
      const msg = e.message || String(e);
      errors.push(lead.id + ': ' + msg);
      try {
        const { patch } = buildAttemptPatch(lead.enrichment, msg);
        await admin.from('coach_leads').update(patch).eq('id', lead.id);
      } catch (_) { /* best effort */ }
    }
  }

  console.log(`[coach-leads-enrich] processed=${processed} enriched=${enriched} skippedNoData=${skippedNoData} errors=${errors.length}`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, processed, enriched, skippedNoData, errors: errors.slice(0, 5) }) };
};

// Exposed for tests (mirrors coach-leads-sheet-sync.js's _internals pattern).
exports._internals = { EXTRACT_SCHEMA, buildEnrichment, buildAttemptPatch };
