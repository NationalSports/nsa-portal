// Staff Portal Assistant — the Claude brain behind src/PortalAssistant.js.
//
// The Claude brain for signed-in NSA staff using the internal portal. It answers
// "where is X / what does this screen do / how do I ..." questions, spotlights
// elements, runs tutorials, and translates natural language into structured
// specs the CLIENT executes over its own in-memory data (search, briefs,
// reports, vendor stock, estimate co-pilot). This function itself is stateless
// and reads no DB: it only emits typed actions. Writes it can propose
// (start_estimate / add_line / set_reminder / add_note) never happen here — the
// client resolves and persists them, and every write lands behind an explicit
// user confirm/Save gate, keeping the model clear of the money/persistence path.
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
  sales_orders: new Set(['status', 'is_open', 'needs_art', 'margin_pct', 'value', 'created_date', 'expected_date', 'ready_to_invoice', 'shipped', 'shipped_not_invoiced', 'checked_in', 'short_on_pull', 'paid', 'customer', 'rep', 'text']),
  jobs: new Set(['prod_status', 'art_status', 'needs_art', 'item_status', 'items_in', 'margin_pct', 'customer', 'rep', 'text']),
  invoices: new Set(['is_open', 'paid', 'status', 'balance', 'days_past_due', 'value', 'date', 'due_date', 'customer', 'rep', 'text']),
  estimates: new Set(['is_open', 'status', 'age_days', 'value', 'created_date', 'customer', 'rep', 'text']),
  customers: new Set(['rep', 'open_balance', 'has_open_orders', 'order_count', 'revenue', 'last_order_days', 'text']),
  products: new Set(['vendor', 'brand', 'color', 'has_image', 'in_stock', 'stock', 'cost', 'price', 'text']),
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
  if (input && input.aggregate && typeof input.aggregate === 'object') {
    const af = String(input.aggregate.field || '');
    const aop = String(input.aggregate.op || '');
    if (allowed.has(af) && ['sum', 'avg', 'min', 'max'].includes(aop)) out.aggregate = { field: af, op: aop };
  }
  return out;
}

// ── System prompt ─────────────────────────────────────────────────────────
// The catalogs are interpolated, so this string varies per request and will
// not get ephemeral-cache prefix hits across different screens — that's fine;
// the catalogs are small and the win is grounding the model in exactly what
// exists right now.
function buildSystemPrompt({ screen, screens, tours, targets }) {
  const _today = (() => { try { return new Date().toISOString().slice(0, 10); } catch (e) { return ''; } })();
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
    '- When the user has an estimate OPEN and asks to add an item to it ("add … at N% margin", "put a … on this estimate"), call the `add_line` tool with the product description and the target margin percent if they stated one. It only works while an estimate is open; the app resolves the product from the catalog and prices it, and the user reviews before saving. Do not state a price or claim it is added — the app confirms.',
    '- To START a NEW estimate ("start/build/create an estimate or quote for <customer>", optionally "with <items>"), call the start_estimate tool with the customer and an items array (each item = a description + optional margin_pct). The app resolves the customer and items and opens the draft for review. This is different from add_line (which adds to an already-open estimate).',
    '- If nothing matches, just answer in words. Only use a tool when it genuinely helps.',
    '',
    'Structured search — pick ONE entity and build the `search` spec from that entity\'s fields ONLY:',
    `Today's date is ${_today}. For date fields pass an absolute YYYY-MM-DD value with gt/gte/lt/lte. Convert relative windows using today: "this month" -> created_date gte first-of-this-month; "last 30 days" -> gte (today minus 30); "this year"/"this season" -> gte Jan 1; "last year" -> created_date gte last-Jan-1 AND lt this-Jan-1; "before/after <date>" -> lt/gt that date.`,
    '• sales_orders — status (booking|need_order|waiting_receive|needs_pull|items_received|in_production|ready_to_invoice|complete), is_open (true/false), needs_art (true/false), margin_pct (integer %), value ($), created_date (YYYY-MM-DD), expected_date (YYYY-MM-DD, when goods are expected), ready_to_invoice (true/false), shipped (true/false), shipped_not_invoiced (true/false), checked_in (true/false = all goods physically received), short_on_pull (true/false = stock came up short), paid (true/false), customer (contains), rep ("me" or a name), text (contains).',
    '• jobs — prod_status (draft|hold|staging|in_process|completed|shipped = the DECORATION/production stage), art_status (needs_art|waiting_approval|production_files_needed|upload_emb_files|order_dtf_transfers|art_complete), needs_art (true/false), item_status (need_to_order|on_order|waiting_receive|partially_received|items_received = the RECEIVING status of the garments), items_in (true/false = ALL garments received), margin_pct (%, from the job\'s order), customer, rep, text.',
    '• invoices — is_open (true/false = still owed), paid (true/false), status (open|partial|paid), balance ($ owed), days_past_due (number), value ($ total), date (YYYY-MM-DD invoice date), due_date (YYYY-MM-DD), customer, rep, text.',
    '• estimates — is_open (true/false = not yet converted), status (draft|approved|converted), age_days (number), value ($), created_date (YYYY-MM-DD), customer, rep, text.',
    '• customers — rep ("me" or a name), open_balance ($ they owe), has_open_orders (true/false), order_count (lifetime # of orders), revenue ($ lifetime), last_order_days (days since their most recent order), text (name/tag).',
    '• products — vendor (contains), brand (contains), color (contains), has_image (true/false), in_stock (true/false), stock (units on hand), cost ($), price ($), text (sku/name).',
    '• purchase_orders — status (waiting|ordered|partial|received|shipped), vendor (contains), so (order # contains), text.',
    'Mapping tips: "open orders" → sales_orders is_open=true. "unpaid / owes us / outstanding" → invoices is_open=true. "past due / overdue 30 days" → invoices days_past_due gt 30. "cold/stale quotes" → estimates is_open=true + age_days gt 7 (stale = 14+). "needs art" → needs_art=true. "all the items in / everything received / goods all here" → jobs items_in=true (do NOT use prod_status for this — prod_status is the decoration stage, not receiving). "margin over 40%" → margin_pct gt 40. "for <name>" → customer contains <name> (or rep if clearly a salesperson). "my/mine/I got/I sold" → rep is "me". "missing image" → products has_image=false. "ready to invoice" → sales_orders ready_to_invoice=true. "shipped but not invoiced" → sales_orders shipped_not_invoiced=true. "goods all in / checked in / arrived" → sales_orders checked_in=true. "short on pull / came up short" → sales_orders short_on_pull=true. "unpaid orders" → sales_orders paid=false; "paid orders" → paid=true. "out of stock" → products in_stock=false; "in stock" → products in_stock=true. "dormant / quiet / gone cold / haven\'t ordered in N days" → customers last_order_days gt N. A named record ("the Dana Hills tee order") → text contains the distinctive words, plus a date filter if a timeframe is given. Combine conditions as multiple filters (AND).',
    'Ranking: "top/biggest/highest/largest" → sort by the money field (value/balance/open_balance/cost) dir desc; "oldest/most overdue" → sort by age_days/days_past_due desc; "smallest/cheapest" → asc. "top N" also sets limit N. The sort field must be one of the chosen entity\'s fields.',
    'Aggregates: for "how much / total / average / highest / lowest" add aggregate {op, field} — "total value of open orders" → sales_orders is_open=true + aggregate {op:"sum", field:"value"}; "total AR past due" → invoices is_open=true + days_past_due gt 0 + aggregate {op:"sum", field:"balance"}; "average margin on my orders" → sales_orders rep "me" + aggregate {op:"avg", field:"margin_pct"}. "How many …" needs only filters — the count shows automatically. Do not state the number yourself; the app computes it.',
    'When the user asks what needs their attention / a daily brief / what\'s on their plate / what to work on, call the daily_brief tool (no input).',
    'For "everything for <customer>" / a customer snapshot / overview / "how are things with <customer>", call the customer_360 tool with the customer name.',
    'For "is <X> in stock (at the vendor) / available / when is the next delivery", call the vendor_stock tool with the SKU or description. (This is live vendor availability — different from our own warehouse stock, which is the products `stock`/`in_stock` search fields.)',
    '- For a customer REPORT — brand dollars bought ("how much adidas did San Mateo buy this year"), average days-to-pay ("average days to pay for Santa Barbara football"), a printable invoices-with-items list, or a customer snapshot — call the report tool with type (brand_spend|days_to_pay|invoice_detail|customer_summary), customer, brand (for brand_spend), and timeframe (this_year|last_year|last_12_months|all_time; default this_year).',
    `- To set a personal reminder/task ("remind me to …", "follow up with <customer> on Friday", "add a task …"), call the set_reminder tool. It is assigned to the current user and appears in their Assigned Tasks. Convert any relative due date to an absolute YYYY-MM-DD using today (${_today}). Mark priority "high" only if they signal urgency.`,
    '- To leave a note ("add a note …", "note on SO-1727: …", "note for <customer>: …"), call the add_note tool. Use target=order for a normal timestamped note on an order, target=production for a spec note that must reach vendors/job tickets, and target=customer for a note on the customer record. Pass ref = the order number (order/production) or customer name (customer).',
    'Both set_reminder and add_note are WRITE actions: the app shows the user a draft they must confirm before anything saves. Do not say it is saved or done — say you have drafted it for their confirmation.',
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
        aggregate: {
          type: 'object',
          description: 'Optional. Compute one number over the matches instead of just listing them ("how much / total / average"). op on a numeric field.',
          properties: {
            op: { type: 'string', enum: ['sum', 'avg', 'min', 'max'] },
            field: { type: 'string' },
          },
          required: ['op', 'field'],
          additionalProperties: false,
        },
      },
      required: ['entity', 'filters'],
      additionalProperties: false,
    },
  });
  // "What needs my attention" summary.
  tools.push({
    name: 'daily_brief',
    description: "Show the user a 'what needs my attention' summary — their orders ready to invoice, orders needing art, orders short on pull, shipped-not-invoiced, overdue invoices, and cold quotes. Use when they ask what needs attention / what's on their plate / a daily briefing / what's on fire / what should I work on.",
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  });
  // One-glance customer snapshot.
  tools.push({
    name: 'customer_360',
    description: "Show a one-glance snapshot for a single customer — their open orders, open estimates, unpaid invoices, and lifetime totals. Use when the user asks for 'everything for <customer>', a customer overview/snapshot/summary, or 'how are things with <customer>'.",
    input_schema: { type: 'object', properties: { customer: { type: 'string', description: 'The customer name or tag.' } }, required: ['customer'], additionalProperties: false },
  });
  // Live vendor B2B stock + next delivery.
  tools.push({
    name: 'vendor_stock',
    description: "Check live vendor B2B stock and next delivery for a product (Adidas, Agron, Under Armour, Nike). Use when the user asks whether something is in stock at the vendor, its availability, or when the next delivery is — for a SKU or a product description.",
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'A product SKU (e.g. IQ2728) or a description (e.g. "adidas navy pregame tee").' } }, required: ['query'], additionalProperties: false },
  });
  // Start a new draft estimate (write, reviewed before save).
  tools.push({
    name: 'start_estimate',
    description: "Start a NEW draft estimate for a customer, optionally pre-filled with items. Use when the user says 'start/create/build an estimate (or quote) for <customer>', optionally 'with <items>'. The app resolves the customer and each item from the catalog and opens the draft for review; nothing is saved until the user saves. (Different from add_line, which adds to an ALREADY-open estimate.)",
    input_schema: {
      type: 'object',
      properties: {
        customer: { type: 'string', description: 'Customer name or tag.' },
        items: {
          type: 'array',
          description: 'Optional items to pre-fill; each a product description (SKU or words) + optional target margin percent.',
          items: { type: 'object', properties: { description: { type: 'string' }, margin_pct: { type: 'number' } }, required: ['description'], additionalProperties: false },
        },
      },
      required: ['customer'],
      additionalProperties: false,
    },
  });
  // Customer-centric report (computed + printable).
  tools.push({
    name: 'report',
    description: "Generate a customer-centric report. Use for: dollars of a BRAND a customer bought in a period ('how much adidas did San Mateo College buy this year' -> type brand_spend, brand adidas), average days-to-pay ('average days to pay for Santa Barbara football' -> days_to_pay), a printable list of a customer's invoices with line items ('show <customer>'s invoices with items' -> invoice_detail), or an overall customer snapshot (customer_summary). The app computes it from real data and shows a summary the user can print/PDF; do not state the numbers yourself.",
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['brand_spend', 'days_to_pay', 'invoice_detail', 'customer_summary'] },
        customer: { type: 'string', description: 'Customer name or tag.' },
        brand: { type: 'string', description: 'Brand for brand_spend (e.g. "adidas", "under armour").' },
        timeframe: { type: 'string', enum: ['this_year', 'last_year', 'last_12_months', 'all_time'] },
      },
      required: ['type', 'customer'],
      additionalProperties: false,
    },
  });
  // Set a personal reminder / task for the current user (write, confirmed before save).
  tools.push({
    name: 'set_reminder',
    description: "Create a personal reminder / to-do for the CURRENT user (it is assigned to them and shows up in their 'Assigned Tasks' widget). Use when they say 'remind me to …', 'set a reminder …', 'add a task …', 'follow up with <customer> on <date>'. You do NOT save it directly — the app shows the drafted reminder and the user confirms before it is saved. Do not claim it is saved; the app confirms.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title of the reminder/task (e.g. "Follow up with San Mateo on pregame tees").' },
        due_date: { type: 'string', description: 'Optional due date as YYYY-MM-DD. Convert relative dates ("Friday", "next week", "in 3 days") to an absolute date using today.' },
        customer: { type: 'string', description: 'Optional customer name to link the reminder to.' },
        so: { type: 'string', description: 'Optional sales order number to link the reminder to (e.g. SO-1727).' },
        priority: { type: 'string', enum: ['high', 'normal'], description: 'Optional. "high" if the user says urgent/important/asap/high priority.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  });
  // Add a note to a record (write, confirmed before save).
  tools.push({
    name: 'add_note',
    description: "Add a note to a record. Use when the user says 'add a note …', 'note on <order>: …', 'leave a note for <customer>: …', 'jot down …'. target=order posts a timestamped note to a sales order's message thread; target=production writes a production/spec note on the order that also travels to job tickets and vendors; target=customer saves a note on the customer record. You do NOT save it directly — the app shows the drafted note and the user confirms. Do not claim it is saved.",
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['order', 'production', 'customer'], description: 'order = timestamped note on the order thread; production = production/spec note on the order (reaches vendors/job tickets); customer = note on the customer record.' },
        ref: { type: 'string', description: 'What to attach it to: the sales order number (e.g. SO-1727) for order/production, or the customer name for customer.' },
        text: { type: 'string', description: 'The note text.' },
      },
      required: ['target', 'ref', 'text'],
      additionalProperties: false,
    },
  });
  // Add a product line to the estimate the user has open (write, reviewed before save).
  tools.push({
    name: 'add_line',
    description: "Add a product line to the estimate the user currently has OPEN on screen. Use when they say to add/put an item onto the estimate (e.g. 'add adidas navy long-sleeve pregame tee at 40% margin'). Only works while an estimate is open. You do NOT see the catalog — the app resolves the product from your description, prices it, and adds the line for the user to review before saving.",
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'The product to add, as described (brand, color, style, sleeve length, etc.).' },
        margin_pct: { type: 'number', description: 'Target margin percent if the user gave one (e.g. 40). Omit if none was stated.' },
      },
      required: ['description'],
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
      } else if (tu.name === 'daily_brief') {
        actions.push({ type: 'daily_brief' });
        out = { ok: true };
      } else if (tu.name === 'customer_360') {
        const customer = normStr(tu.input && tu.input.customer, 120);
        if (customer) { actions.push({ type: 'customer_360', customer }); out = { ok: true }; }
        else out = { error: 'No customer' };
      } else if (tu.name === 'vendor_stock') {
        const query = normStr(tu.input && tu.input.query, 120);
        if (query) { actions.push({ type: 'vendor_stock', query }); out = { ok: true }; }
        else out = { error: 'No query' };
      } else if (tu.name === 'add_line') {
        const description = normStr(tu.input && tu.input.description, 200);
        const mp = Number(tu.input && tu.input.margin_pct);
        if (description) { actions.push({ type: 'add_line', description, margin_pct: (mp > 0 && mp < 100) ? mp : null }); out = { ok: true }; }
        else out = { error: 'No product description' };
      } else if (tu.name === 'start_estimate') {
        const customer = normStr(tu.input && tu.input.customer, 120);
        const rawItems = Array.isArray(tu.input && tu.input.items) ? tu.input.items : [];
        const items = rawItems.slice(0, 30).map((it) => {
          const mp = Number(it && it.margin_pct);
          return { description: normStr(it && it.description, 200), margin_pct: (mp > 0 && mp < 100) ? mp : null };
        }).filter((it) => it.description);
        if (customer) { actions.push({ type: 'start_estimate', customer, items }); out = { ok: true }; }
        else out = { error: 'No customer' };
      } else if (tu.name === 'report') {
        const rtype = normStr(tu.input && tu.input.type, 40);
        const rcustomer = normStr(tu.input && tu.input.customer, 120);
        const rbrand = normStr(tu.input && tu.input.brand, 60);
        const tframe = normStr(tu.input && tu.input.timeframe, 40);
        if (rtype && rcustomer) { actions.push({ type: 'report', report: { type: rtype, customer: rcustomer, brand: rbrand || null, timeframe: tframe || null } }); out = { ok: true }; }
        else out = { error: 'type and customer required' };
      } else if (tu.name === 'set_reminder') {
        const title = normStr(tu.input && tu.input.title, 160);
        const due = normStr(tu.input && tu.input.due_date, 10);
        const customer = normStr(tu.input && tu.input.customer, 120);
        const so = normStr(tu.input && tu.input.so, 40);
        const pr = normStr(tu.input && tu.input.priority, 10);
        const due_date = /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
        if (title) {
          actions.push({ type: 'set_reminder', reminder: { title, due_date, customer: customer || null, so: so || null, priority: pr === 'high' ? 'high' : 'normal' } });
          out = { ok: true };
        } else out = { error: 'title required' };
      } else if (tu.name === 'add_note') {
        const target = normStr(tu.input && tu.input.target, 20);
        const ref = normStr(tu.input && tu.input.ref, 120);
        const noteText = normStr(tu.input && tu.input.text, 1000);
        if (['order', 'production', 'customer'].includes(target) && ref && noteText) {
          actions.push({ type: 'add_note', note: { target, ref, text: noteText } });
          out = { ok: true };
        } else out = { error: 'target, ref and text required' };
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
