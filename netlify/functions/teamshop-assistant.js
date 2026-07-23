// Team Shop chat assistant — the AI brain behind src/teamshop/ChatWidget.js
// (v2). Claude-powered (owner explicitly chose Claude Sonnet — model string
// 'claude-sonnet-5', official @anthropic-ai/sdk), configured for fast support
// chat: thinking disabled + output effort 'low' (the documented low-latency
// configuration for Sonnet 5 — NO temperature/top_p, both rejected on this
// model), system prompt cached via cache_control: ephemeral.
//
// POST { messages: [{ role: 'user'|'assistant', text }], customer_id? }
//   Authorization: Bearer <coach Supabase session JWT>   (optional)
//
// Server-side caps (never trusted from the client): last 12 turns, each text
// clipped to 2000 chars. A bad/expired bearer token is treated as anonymous —
// it only gates the coach tool, never errors the chat.
//
// Grounding: the system prompt inlines the FAQ Q/As from src/lib/teamshopFaq.js
// (the SAME data src/teamshop/faqData.js re-exports to the storefront FAQ
// page) — the ONLY policy source the bot may state — plus tool results.
//
// Tools (manual loop, bounded at MAX_MODEL_CALLS):
//   get_my_orders          — only offered when the bearer token resolved to a
//                            verified coach AND a customer_id came with the
//                            request. Executes teamshop-orders.js's exported
//                            listOrders (verifyCoach + coachHasCustomerAccess
//                            chain — reused, not forked). The model sees ONLY:
//                            order_number, status label (statusChipLabel),
//                            production stage, created_at, item count, total,
//                            tracker path.
//   lookup_order_for_family — order_number + email (both required non-empty).
//                            Matches webstore_orders on order_source='teamshop'
//                            + order_number + buyer_email (case-insensitive
//                            exact — ilike with escaped wildcards, same
//                            escaping _coachAuth.js uses). Returns ONLY:
//                            order_number, status label, production stage, and
//                            the status_token tracker path (that token is
//                            designed for exactly this tokenless family view).
//                            NEVER addresses, payment info, po numbers, coach
//                            ids, or emails. Abuse-limited: max 2 executions
//                            per invocation.
//
// Responses:
//   { ok: true, text, cards: [{ type: 'order', order: <safe card shape> }] }
//   { fallback: true }  — ANTHROPIC_API_KEY missing, service unconfigured, or
//                         any Anthropic/API failure. The widget silently keeps
//                         its rule-based v1 behavior on this.
//
// Money is never computed here or client-side — totals are read verbatim from
// the same rows teamshop-orders.js already exposes to the signed-in coach.
const Anthropic = require('@anthropic-ai/sdk');
const { corsHeaders, getSupabaseAdmin } = require('./_shared');
const { verifyCoach } = require('./_coachAuth');
const { listOrders, summarizeProdStage } = require('./teamshop-orders');
const { statusChipLabel } = require('../../src/lib/teamshopOrderStatus');
const { FAQS } = require('../../src/lib/teamshopFaq');

const bad = (status, error) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error }) });
const ok = (body) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) });

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 1024;
const MAX_MODEL_CALLS = 3; // bounded manual tool loop
const MAX_FAMILY_LOOKUPS = 2; // per invocation — abuse cap
const MAX_TURNS = 12;
const MAX_TURN_CHARS = 2000;
const MAX_ORDERS_TO_MODEL = 10;
const SUPPORT_EMAIL = 'info@nationalsportsapparel.com';

// ── System prompt ─────────────────────────────────────────────────────
// Stable string (no timestamps/ids interpolated) so the ephemeral
// cache_control breakpoint actually gets prefix hits across requests.
function buildSystemPrompt() {
  const facts = FAQS.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
  return [
    "You are the Team Shop Assistant for National Sports Apparel's Team Shop storefront. You help coaches and families with orders, sizing, decoration, team pricing, and store policies.",
    '',
    'Hard rules:',
    `- Answer policy questions ONLY from the FAQ facts below and from tool results. Never invent prices, dates, minimums, turnaround times, discounts, or policies. If something is not covered by the FAQ facts or a tool result, say you do not have that information and direct the person to ${SUPPORT_EMAIL}.`,
    '- Decoration methods are exactly three: Embroidery, Heat Applications (which covers DTF transfers, vinyl names/numbers, and silicone patches), and Screen Print (24+ pieces per design). Never present DTF as a top-level method — it is a Heat Applications sub-type.',
    '- Keep answers short and friendly — a sentence or three, plain language, no markdown headings.',
    '- Order data comes only from tools. A signed-in coach can use get_my_orders. A family member can use lookup_order_for_family, which needs BOTH the order number and the email used at checkout — if either is missing, ask for it instead of calling the tool. Never guess or fabricate order details, and never reveal one customer\'s information to another.',
    '',
    'FAQ facts (the only policies you may state):',
    '',
    facts,
  ].join('\n');
}

// ── Tool definitions (strict JSON schemas) ────────────────────────────
const FAMILY_LOOKUP_TOOL = {
  name: 'lookup_order_for_family',
  description: 'Look up ONE Team Shop order for a family member or shopper who is not signed in. Requires the order number AND the email address used at checkout — both, always. Returns the order status and a tracker link, or not_found when nothing matches.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      order_number: { type: 'string', description: 'The customer-facing order number, e.g. 1010042.' },
      email: { type: 'string', description: 'The email address used at checkout.' },
    },
    required: ['order_number', 'email'],
    additionalProperties: false,
  },
};

const MY_ORDERS_TOOL = {
  name: 'get_my_orders',
  description: "List the signed-in coach's recent Team Shop orders for their selected team, newest first, with live status and tracker links.",
  strict: true,
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

// ── Sanitizers ────────────────────────────────────────────────────────
// Card shape the widget's existing OrderCard renders (id, status, total,
// items summary, production.stage, status_token) — an explicit whitelist so
// nothing sensitive can ride along.
function toCardOrder(o) {
  return {
    id: o.order_number != null ? String(o.order_number) : o.id,
    order_number: o.order_number != null ? o.order_number : null,
    status: o.status || null,
    total: o.total != null ? o.total : null,
    created_at: o.created_at || null,
    items: (o.items || []).map((i) => ({ name: i.name || '', sku: i.sku || '', qty: i.qty || 1, size: i.size || '' })),
    production: o.production && o.production.stage ? { stage: o.production.stage } : null,
    status_token: o.status_token || null,
  };
}

// What the MODEL sees for a coach order — nothing else.
function toCoachToolRow(o) {
  return {
    order_number: o.order_number != null ? o.order_number : o.id,
    status: statusChipLabel(o),
    production_stage: (o.production && o.production.stage) || null,
    created_at: o.created_at || null,
    item_count: (o.items || []).length,
    total: o.total != null ? o.total : null,
    tracker_path: o.status_token ? `/shop/order/${o.status_token}` : null,
  };
}

// ── Tool executors ────────────────────────────────────────────────────
async function execGetMyOrders(admin, coach, customerId) {
  const res = await listOrders(admin, { customer_id: customerId }, coach);
  let body;
  try { body = JSON.parse(res.body); } catch { body = {}; }
  if (res.statusCode !== 200) return { result: { error: body.error || 'Could not load orders' } };
  const orders = Array.isArray(body.orders) ? body.orders : [];
  if (!orders.length) return { result: { orders: [] } };
  return {
    result: { orders: orders.slice(0, MAX_ORDERS_TO_MODEL).map(toCoachToolRow) },
    // Card hint for the most recent order — the widget renders its existing
    // order card next to the model's text.
    cards: [{ type: 'order', order: toCardOrder(orders[0]) }],
  };
}

async function execFamilyLookup(admin, input, state) {
  const orderNumber = String((input && input.order_number) || '').trim();
  const email = String((input && input.email) || '').trim();
  if (!orderNumber || !email) {
    return { result: { error: 'Both order_number and email are required. Ask the person for whichever is missing.' } };
  }
  state.familyLookups += 1;
  if (state.familyLookups > MAX_FAMILY_LOOKUPS) {
    return { result: { error: `Lookup limit reached for this conversation. Direct the person to ${SUPPORT_EMAIL}.` } };
  }
  const numeric = orderNumber.replace(/[^0-9]/g, '');
  if (!numeric) return { result: { found: false } };
  const esc = email.replace(/([%_\\])/g, '\\$1'); // ilike without wildcards = case-insensitive exact
  const { data, error } = await admin.from('webstore_orders')
    .select('id,order_number,status,created_at,status_token,so_id')
    .eq('order_source', 'teamshop')
    .eq('order_number', Number(numeric))
    .ilike('buyer_email', esc)
    .limit(1);
  if (error) return { result: { error: 'Lookup failed — try again in a moment.' } };
  const order = (data || [])[0];
  if (!order) return { result: { found: false, note: 'No Team Shop order matches that order number and email together.' } };

  // Production stage — same summarization rule the coach list uses
  // (teamshop-orders.js summarizeProdStage), only meaningful once converted
  // to a Sales Order.
  let production = null;
  if (order.so_id) {
    const [jobsRes, shipRes] = await Promise.all([
      admin.from('so_jobs').select('so_id,prod_status').in('so_id', [order.so_id]),
      admin.from('webstore_shipments').select('order_id').in('order_id', [order.id]),
    ]);
    if (!jobsRes.error && !shipRes.error) {
      production = { stage: summarizeProdStage(jobsRes.data || [], (shipRes.data || []).length > 0) };
    }
  }
  const labeled = { status: order.status, production };
  const trackerPath = order.status_token ? `/shop/order/${order.status_token}` : null;
  return {
    // ONLY these fields ever reach the model: no addresses, payment info,
    // po numbers, coach ids, totals, or emails.
    result: {
      found: true,
      order_number: order.order_number != null ? order.order_number : null,
      status: statusChipLabel(labeled),
      production_stage: production ? production.stage : null,
      tracker_path: trackerPath,
    },
    cards: [{
      type: 'order',
      order: {
        id: order.order_number != null ? String(order.order_number) : order.id,
        order_number: order.order_number != null ? order.order_number : null,
        status: order.status || null,
        total: null, // family view never includes money
        created_at: order.created_at || null,
        items: [],
        production,
        status_token: order.status_token || null,
      },
    }],
  };
}

// ── Request-message normalization (server-enforced caps) ──────────────
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
  while (turns.length && turns[0].role !== 'user') turns.shift(); // API requires a user first
  if (!turns.length || turns[turns.length - 1].role !== 'user') return null;
  return turns;
}

// ── The bounded manual tool loop ──────────────────────────────────────
async function runAssistant({ client, tools, messages, admin, coach, customerId }) {
  const system = [{ type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } }];
  const state = { familyLookups: 0 };
  const cards = [];
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
      return { text: text || `I'm not sure how to help with that — email us at ${SUPPORT_EMAIL}.`, cards };
    }

    convo.push({ role: 'assistant', content });
    const results = [];
    for (const tu of toolUses) {
      let out;
      try {
        if (tu.name === 'get_my_orders' && coach && customerId) {
          out = await execGetMyOrders(admin, coach, customerId);
        } else if (tu.name === 'lookup_order_for_family') {
          out = await execFamilyLookup(admin, tu.input, state);
        } else {
          out = { result: { error: `Unknown or unavailable tool: ${tu.name}` } };
        }
      } catch (e) {
        out = { result: { error: 'Tool failed — try again in a moment.' } };
      }
      if (out.cards) cards.push(...out.cards);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out.result) });
    }
    convo.push({ role: 'user', content: results });
  }

  // Loop budget exhausted with the model still asking for tools — end safely.
  return { text: `I couldn't finish looking that up — email us at ${SUPPORT_EMAIL} and we'll sort it out.`, cards };
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return ok({ fallback: true }); // widget keeps its rule-based v1 flow

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }

  const messages = normalizeMessages(body.messages);
  if (!messages) return bad(400, 'messages required (ending with a user turn)');

  let admin;
  try { admin = getSupabaseAdmin(); } catch (e) { return ok({ fallback: true }); }

  // Optional coach auth — a bad/expired token degrades to anonymous rather
  // than failing the chat; it only gates the get_my_orders tool.
  let coach = null;
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (auth) {
    try {
      const v = await verifyCoach(admin, event);
      if (v.coach) coach = v.coach;
    } catch (e) { coach = null; }
  }
  const customerId = String(body.customer_id || '').trim() || null;

  const tools = (coach && customerId) ? [MY_ORDERS_TOOL, FAMILY_LOOKUP_TOOL] : [FAMILY_LOOKUP_TOOL];

  try {
    const client = new Anthropic({ apiKey });
    const { text, cards } = await runAssistant({ client, tools, messages, admin, coach, customerId });
    return ok({ ok: true, text, cards });
  } catch (e) {
    console.error('[teamshop-assistant] error:', e && e.message);
    return ok({ fallback: true }); // any AI failure → widget falls back to v1
  }
};

// ── Test surface ─────────────────────────────────────────────────────
module.exports.buildSystemPrompt = buildSystemPrompt;
module.exports.normalizeMessages = normalizeMessages;
