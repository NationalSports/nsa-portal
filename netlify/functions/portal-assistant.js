// Staff Portal Assistant — the Claude brain behind src/PortalAssistant.js.
//
// A read-only, guide-only helper for signed-in NSA staff using the internal
// portal. It answers "where is X / what does this screen do / how do I ..."
// questions and can (a) spotlight an on-screen element or (b) launch an
// interactive on-screen tutorial. It NEVER reads customer/order data, never
// clicks anything, never writes anything — it points, explains, and teaches.
// That keeps it well clear of every money/persistence path in the portal.
//
// Pattern copied from netlify/functions/teamshop-assistant.js (owner's chosen
// Claude config): official @anthropic-ai/sdk, model 'claude-sonnet-5', thinking
// disabled + output effort 'low' (the low-latency chat config for this model —
// NO temperature/top_p), system prompt cached via cache_control: ephemeral,
// bounded manual tool loop.
//
// POST {
//   messages: [{ role:'user'|'assistant', text }],
//   screen:   { id, title },                    // where the user currently is
//   screens:  [{ id, label, desc }],            // the portal's screen catalog
//   tours:    [{ id, title, desc }],            // available tutorials
//   targets:  [{ id, label }]                   // spotlight-able elements
// }
// The catalogs are supplied by the client (they live next to the DOM in
// PortalAssistant.js) so the two never drift and the model can only pick ids
// that actually exist this render.
//
// Responses:
//   { ok:true, text, actions:[ {type:'start_tutorial', tour_id}
//                            | {type:'highlight', target_id} ] }
//   { fallback:true }  — ANTHROPIC_API_KEY missing or any Anthropic failure.
//                        The widget keeps working (chat still usable) on this.
const Anthropic = require('@anthropic-ai/sdk');
const { corsHeaders } = require('./_shared');

const bad = (status, error) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error }) });
const ok = (body) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) });

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 1024;
const MAX_MODEL_CALLS = 3; // bounded manual tool loop
const MAX_TURNS = 12;
const MAX_TURN_CHARS = 2000;
const MAX_CATALOG = 60; // hard cap on client-supplied list sizes

// ── Client-catalog normalization (never trusted from the client) ──────────
function normStr(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }

function normCatalog(raw, fields) {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_CATALOG) : [];
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const id = normStr(row.id, 80);
    if (!id) continue;
    const rec = { id };
    for (const [key, len] of fields) rec[key] = normStr(row[key], len);
    out.push(rec);
  }
  return out;
}

// ── Structured-search vocabulary ───────────────────────────────────────────
// The AI may only build a `search` spec from these fields/ops. This MUST stay
// in lockstep with the executor (runPortalSearch) in src/App.js — same field
// names, same entities. Kept small and stable on purpose.
const SEARCH_FIELDS = {
  sales_orders: new Set(['status', 'is_open', 'needs_art', 'margin_pct', 'value', 'customer', 'rep', 'text']),
  jobs: new Set(['prod_status', 'art_status', 'needs_art', 'item_status', 'items_in', 'margin_pct', 'customer', 'rep', 'text']),
  invoices: new Set(['is_open', 'paid', 'status', 'balance', 'days_past_due', 'value', 'customer', 'rep', 'text']),
  estimates: new Set(['is_open', 'status', 'age_days', 'value', 'customer', 'rep', 'text']),
  customers: new Set(['rep', 'open_balance', 'has_open_orders', 'text']),
  products: new Set(['vendor', 'brand', 'color', 'has_image', 'cost', 'price', 'text']),
  purchase_orders: new Set(['status', 'vendor', 'so', 'text']),
};
const SEARCH_ENTITIES = Object.keys(SEARCH_FIELDS);
const SEARCH_OPS = new Set(['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'contains']);

function sanitizeSpec(input) {
  const entity = input && input.entity;
  if (!SEARCH_FIELDS[entity]) return null;
  const allowed = SEARCH_FIELDS[entity];
  const rawFilters = Array.isArray(input && input.filters) ? input.filters : [];
  const filters = [];
  for (const f of rawFilters) {
    if (!f || typeof f !== 'object') continue;
    const field = String(f.field || '');
    const op = String(f.op || '');
    if (!allowed.has(field) || !SEARCH_OPS.has(op)) continue;
    filters.push({ field, op, value: normStr(f.value, 120) });
  }
  const out = { entity, filters };
  if (input && input.sort && typeof input.sort === 'object') {
    const sf = String(input.sort.field || '');
    if (allowed.has(sf)) out.sort = { field: sf, dir: input.sort.dir === 'asc' ? 'asc' : 'desc' };
  }
  const lim = Number(input && input.limit);
  if (lim && lim > 0) out.limit = Math.min(Math.floor(lim), 300);
  return out;
}

// ── System prompt ─────────────────────────────────────────────────────────
// The catalogs are interpolated, so this string varies per request and will
// not get ephemeral-cache prefix hits across different screens — that's fine;
// the catalogs are small and the win is grounding the model in exactly what
// exists right now.
function buildSystemPrompt({ screen, screens, tours, targets }) {
  const screenLines = screens.length
    ? screens.map((s) => `- ${s.id} — ${s.label}${s.desc ? `: ${s.desc}` : ''}`).join('\n')
    : '(none provided)';
  const tourLines = tours.length
    ? tours.map((t) => `- ${t.id} — ${t.title}${t.desc ? `: ${t.desc}` : ''}`).join('\n')
    : '(none available)';
  const targetLines = targets.length
    ? targets.map((t) => `- ${t.id}${t.label ? ` — ${t.label}` : ''}`).join('\n')
    : '(none available)';
  const here = screen && screen.id
    ? `${screen.id}${screen.title ? ` (“${screen.title}”)` : ''}`
    : 'unknown';

  return [
    "You are the Portal Assistant for National Sports Apparel's internal staff portal. Your users are NSA employees. You help them find their way around the portal, understand what each screen is for, and learn how to do things — including by launching short interactive on-screen tutorials.",
    '',
    `The user is currently on the "${here}" screen.`,
    '',
    'Hard rules:',
    '- Keep answers short, friendly and plain — a sentence or three, everyday language, no markdown headings or bullet dumps.',
    '- You are READ-ONLY and can only guide. You cannot click buttons, open records, submit forms, create estimates/orders, or change any data. You also cannot see any specific customer, order, invoice, or number. Never claim to have done any of those — always guide the user to do it themselves.',
    '- Ground every factual claim in the screen list, tutorial list, or a tutorial you launch. Do NOT invent specific button names, menu locations, prices, policies, keyboard shortcuts, or step-by-step instructions you were not given. If you do not know a specific detail, say so plainly and suggest where they might look or that they ask a teammate or manager.',
    '- When the user asks where something is, or to be shown a screen or link, call the `highlight` tool with the matching target id — then say one short sentence pointing at it.',
    '- When the user wants a walkthrough or asks "how do I …" and an available tutorial matches, call the `start_tutorial` tool with that tour id. Do not also type out all the steps — the tutorial guides them on screen. Give a one-line lead-in instead.',
    '- When the user wants to FIND, LIST, FILTER, or COUNT their actual records — "show me…", "which…", "how many…", "find the … order", "jobs that…" — call the `search` tool with a structured filter spec. You do NOT see the results; the app displays them. Give a one-line lead-in ("Here are the open orders for Chase:") and NEVER state specific order/job ids, totals, counts, or margins yourself — the results panel shows them.',
    '- If nothing matches, just answer in words. Only use a tool when it genuinely helps.',
    '',
    'Structured search — pick ONE entity and build the `search` spec from that entity\'s fields ONLY:',
    '• sales_orders — status (booking|need_order|waiting_receive|needs_pull|items_received|in_production|ready_to_invoice|complete), is_open (true/false), needs_art (true/false), margin_pct (integer %), value ($), customer (contains), rep ("me" or a name), text (contains).',
    '• jobs — prod_status (draft|hold|staging|in_process|completed|shipped = the DECORATION/production stage), art_status (needs_art|waiting_approval|production_files_needed|upload_emb_files|order_dtf_transfers|art_complete), needs_art (true/false), item_status (need_to_order|on_order|waiting_receive|partially_received|items_received = the RECEIVING status of the garments), items_in (true/false = ALL garments received), margin_pct (%, from the job\'s order), customer, rep, text.',
    '• invoices — is_open (true/false = still owed), paid (true/false), status (open|partial|paid), balance ($ owed), days_past_due (number), value ($ total), customer, rep, text.',
    '• estimates — is_open (true/false = not yet converted), status (draft|approved|converted), age_days (number), value ($), customer, rep, text.',
    '• customers — rep ("me" or a name), open_balance ($ they owe), has_open_orders (true/false), text (name/tag).',
    '• products — vendor (contains), brand (contains), color (contains), has_image (true/false), cost ($), price ($), text (sku/name).',
    '• purchase_orders — status (waiting|ordered|partial|received|shipped), vendor (contains), so (order # contains), text.',
    'Mapping tips: "open orders" → sales_orders is_open=true. "unpaid / owes us / outstanding" → invoices is_open=true. "past due / overdue 30 days" → invoices days_past_due gt 30. "cold/stale quotes" → estimates is_open=true + age_days gt 7 (stale = 14+). "needs art" → needs_art=true. "all the items in / everything received / goods all here" → jobs items_in=true (do NOT use prod_status for this — prod_status is the decoration stage, not receiving). "margin over 40%" → margin_pct gt 40. "for <name>" → customer contains <name> (or rep if clearly a salesperson). "my/mine/I got/I sold" → rep is "me". "missing image" → products has_image=false. A named record ("the Dana Hills tee order") → text contains the distinctive words. Combine conditions as multiple filters (AND).',
    'Ranking: "top/biggest/highest/largest" → sort by the money field (value/balance/open_balance/cost) dir desc; "oldest/most overdue" → sort by age_days/days_past_due desc; "smallest/cheapest" → asc. "top N" also sets limit N. The sort field must be one of the chosen entity\'s fields.',
    '',
    'Portal screens (id — label: what it is for):',
    screenLines,
    '',
    'Available tutorials (id — title: what it teaches):',
    tourLines,
    '',
    'Highlightable targets (id — label):',
    targetLines,
  ].join('\n');
}

// ── Tools (strict JSON schemas, ids constrained to what the client sent) ───
function buildTools({ tours, targets }) {
  const tools = [];
  // Always available: structured search over the user's real records.
  tools.push({
    name: 'search',
    description: "Search the user's real portal data and display the results to them. Use whenever they want to find, list, filter, count, or rank records (sales orders, jobs, invoices, estimates, customers, products, purchase orders). You do NOT see the results — the app renders them — so give a short lead-in and never state specific ids, counts, totals, or margins yourself.",
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: ['sales_orders', 'jobs', 'invoices', 'estimates', 'customers', 'products', 'purchase_orders'] },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              op: { type: 'string', enum: ['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'contains'] },
              value: { type: 'string' },
            },
            required: ['field', 'op', 'value'],
            additionalProperties: false,
          },
        },
        sort: {
          type: 'object',
          description: 'Optional. Rank results by a numeric field ("top", "biggest", "oldest", "most past due").',
          properties: {
            field: { type: 'string' },
            dir: { type: 'string', enum: ['asc', 'desc'] },
          },
          required: ['field', 'dir'],
          additionalProperties: false,
        },
        limit: { type: 'integer', description: 'Optional cap on how many results (e.g. "top 10" -> 10).' },
      },
      required: ['entity', 'filters'],
      additionalProperties: false,
    },
  });
  if (targets.length) {
    tools.push({
      name: 'highlight',
      description: 'Visually spotlight one element on the portal screen for the user (e.g. a sidebar link) so they can see exactly where it is. Use when they ask where to find something or to be shown a screen.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          target_id: { type: 'string', enum: targets.map((t) => t.id), description: 'Which element to spotlight.' },
        },
        required: ['target_id'],
        additionalProperties: false,
      },
    });
  }
  if (tours.length) {
    tools.push({
      name: 'start_tutorial',
      description: 'Launch a short interactive on-screen tutorial that walks the user through a task step by step, highlighting elements as it goes. Use when the user wants a walkthrough and one of the available tutorials matches.',
      strict: true,
      input_schema: {
        type: 'object',
        properties: {
          tour_id: { type: 'string', enum: tours.map((t) => t.id), description: 'Which tutorial to start.' },
        },
        required: ['tour_id'],
        additionalProperties: false,
      },
    });
  }
  return tools;
}

// ── Request-message normalization (server-enforced caps) ───────────────────
function normalizeMessages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = [];
  for (const m of list) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const text = String(m.text || '').trim().slice(0, MAX_TURN_CHARS);
    if (!text) continue;
    cleaned.push({ role: m.role, content: text });
  }
  let turns = cleaned.slice(-MAX_TURNS);
  while (turns.length && turns[0].role !== 'user') turns.shift(); // API requires a user turn first
  if (!turns.length || turns[turns.length - 1].role !== 'user') return null;
  return turns;
}

// ── The bounded manual tool loop ───────────────────────────────────────────
async function runAssistant({ client, catalogs, messages }) {
  const system = [{ type: 'text', text: buildSystemPrompt(catalogs), cache_control: { type: 'ephemeral' } }];
  const tools = buildTools(catalogs);
  const tourIds = new Set(catalogs.tours.map((t) => t.id));
  const targetIds = new Set(catalogs.targets.map((t) => t.id));
  const actions = [];
  const convo = messages.slice();

  for (let call = 0; call < MAX_MODEL_CALLS; call += 1) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system,
      tools,
      messages: convo,
    });
    const content = Array.isArray(resp.content) ? resp.content : [];
    const text = content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n').trim();
    const toolUses = content.filter((b) => b && b.type === 'tool_use');

    if (resp.stop_reason !== 'tool_use' || !toolUses.length) {
      return { text: text || "I'm not sure how to help with that one — try rephrasing, or ask a teammate.", actions };
    }

    convo.push({ role: 'assistant', content });
    const results = [];
    for (const tu of toolUses) {
      let out;
      if (tu.name === 'search') {
        const spec = sanitizeSpec(tu.input);
        if (spec) { actions.push({ type: 'search', spec }); out = { ok: true }; }
        else out = { error: 'Invalid search spec' };
      } else if (tu.name === 'highlight') {
        const id = String(tu.input?.target_id || '');
        if (targetIds.has(id)) { actions.push({ type: 'highlight', target_id: id }); out = { ok: true }; }
        else out = { error: 'Unknown target_id' };
      } else if (tu.name === 'start_tutorial') {
        const id = String(tu.input?.tour_id || '');
        if (tourIds.has(id)) { actions.push({ type: 'start_tutorial', tour_id: id }); out = { ok: true }; }
        else out = { error: 'Unknown tour_id' };
      } else {
        out = { error: `Unknown tool: ${tu.name}` };
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
    }
    convo.push({ role: 'user', content: results });
  }

  // Loop budget spent with the model still calling tools — end safely with
  // whatever actions we collected.
  return { text: 'Done — follow the highlight on screen.', actions };
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return ok({ fallback: true }); // widget stays usable, just no AI

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }

  const messages = normalizeMessages(body.messages);
  if (!messages) return bad(400, 'messages required (ending with a user turn)');

  const catalogs = {
    screen: {
      id: normStr(body.screen?.id, 80),
      title: normStr(body.screen?.title, 120),
    },
    screens: normCatalog(body.screens, [['label', 120], ['desc', 400]]),
    tours: normCatalog(body.tours, [['title', 120], ['desc', 400]]),
    targets: normCatalog(body.targets, [['label', 120]]),
  };

  try {
    const client = new Anthropic({ apiKey });
    const { text, actions } = await runAssistant({ client, catalogs, messages });
    return ok({ ok: true, text, actions });
  } catch (e) {
    console.error('[portal-assistant] error:', e && e.message);
    return ok({ fallback: true }); // any AI failure → widget degrades gracefully
  }
};

// ── Test surface ───────────────────────────────────────────────────────────
module.exports.buildSystemPrompt = buildSystemPrompt;
module.exports.normalizeMessages = normalizeMessages;
module.exports.normCatalog = normCatalog;
