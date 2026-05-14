// supabase/functions/ai-order-builder/index.ts
// ─────────────────────────────────────────────────────────
// "Build with AI" — parses a coach's order (text, image, or
// Google Sheets URL) into structured line items using
// Claude Sonnet 4.6 with vision + prompt caching of the
// product catalog. Returns lines for the review modal in
// OrderEditor; the client still confirms before saving.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("AI_ORDER_BUILDER_MODEL") || "claude-sonnet-4-6";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

type CatalogItem = {
  sku: string;
  name: string;
  brand?: string;
  color?: string;
  available_sizes?: string[];
};

type ParsedLine = {
  sku_guess: string | null;
  name: string;
  brand?: string;
  color?: string;
  sizes: Record<string, number>;
  total_qty: number;
  confidence: "high" | "medium" | "low";
  raw_line?: string;
  notes?: string;
};

const SYSTEM_PROMPT = `You parse team-apparel orders for National Sports Activewear.
Coaches send orders as free-form text, screenshots of spreadsheets, or links to sheets.
Your job: extract a normalized JSON list of line items.

Each line item has:
- sku_guess: the SKU as written (e.g. "JY6033", "JM5094"). If no SKU is given, set null.
- name: product name (e.g. "Techfit Sleeveless Tee").
- brand: if obvious from context (e.g. "Adidas", "Under Armour", "Nike"). Else omit.
- color: if mentioned (e.g. "Black", "Grey"). Else omit.
- sizes: object mapping size code -> integer qty. Use standard codes: XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL, YXS, YS, YM, YL, YXL, OSFA.
  - Coaches often write "S/40 M/60 L/60 XL/60 2XL/15 3XL/15" — that means {S:40,M:60,L:60,XL:60,"2XL":15,"3XL":15}.
  - "Sizing S/20 M/40..." is the same pattern.
  - If only a single total qty is given with no breakdown, put it under "OSFA".
- total_qty: sum of the sizes object.
- confidence: "high" if SKU + sizes are crystal clear, "medium" if you had to infer, "low" if guessing.
- raw_line: the original line/snippet you parsed this from (helpful for the user to verify).
- notes: any caveats (e.g. "no size breakdown given", "color inferred from brand line").

Return STRICT JSON only — no prose, no markdown fences. Schema:
{ "lines": ParsedLine[], "warnings": string[] }

Use the catalog provided in the system prompt to validate SKUs when possible. If a SKU
appears in the catalog, use the exact casing from the catalog. If it doesn't, still
return what the coach wrote — the server will fuzzy-match.

Skip anything that's clearly not a line item (greetings, signatures, decoration notes,
shipping addresses). If you see decoration callouts (Screen Print, Embroidery, Logo
on left chest, etc.), note them in warnings — don't add as line items.`;

function buildCatalogBlock(catalog: CatalogItem[]): string {
  // Compact format to keep tokens low: "SKU | name | brand | color"
  const lines = catalog.map((p) => {
    const parts = [p.sku, p.name];
    if (p.brand) parts.push(p.brand);
    if (p.color) parts.push(p.color);
    return parts.join(" | ");
  });
  return `PRODUCT CATALOG (SKU | name | brand | color):\n${lines.join("\n")}`;
}

function normalizeSize(s: string): string {
  const u = s.toUpperCase().trim().replace(/\s+/g, "");
  // Common variants
  const map: Record<string, string> = {
    "XXL": "2XL",
    "XXXL": "3XL",
    "XXXXL": "4XL",
    "XXXXXL": "5XL",
    "ONESIZE": "OSFA",
    "OS": "OSFA",
    "ONE": "OSFA",
  };
  return map[u] || u;
}

function resolveAgainstCatalog(line: ParsedLine, catalog: CatalogItem[]): ParsedLine & { product_id?: string | null; match_quality?: string } {
  const sizes: Record<string, number> = {};
  for (const [k, v] of Object.entries(line.sizes || {})) {
    const n = normalizeSize(k);
    sizes[n] = (sizes[n] || 0) + (Number(v) || 0);
  }
  const total_qty = Object.values(sizes).reduce((a, b) => a + (Number(b) || 0), 0);

  if (!line.sku_guess) {
    return { ...line, sizes, total_qty, product_id: null, match_quality: "no_sku" };
  }
  const skuUp = line.sku_guess.toUpperCase().trim();

  // 1. Exact SKU
  let hit = catalog.find((p) => p.sku.toUpperCase() === skuUp);
  if (hit) return { ...line, sizes, total_qty, sku_guess: hit.sku, product_id: (hit as any).id || null, match_quality: "exact" };

  // 2. Strip trailing size suffix (e.g. "JY6033-M" -> "JY6033")
  const stripped = skuUp.replace(/[-\s](XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|YXS|YS|YM|YL|YXL)$/i, "");
  if (stripped !== skuUp) {
    hit = catalog.find((p) => p.sku.toUpperCase() === stripped);
    if (hit) return { ...line, sizes, total_qty, sku_guess: hit.sku, product_id: (hit as any).id || null, match_quality: "stripped" };
  }

  // 3. Prefix / token match on name + color
  const nameUp = (line.name || "").toUpperCase();
  const colorUp = (line.color || "").toUpperCase();
  if (nameUp) {
    const tokens = nameUp.split(/\s+/).filter((t) => t.length > 2);
    const scored = catalog.map((p) => {
      const pn = (p.name || "").toUpperCase();
      const pc = (p.color || "").toUpperCase();
      let score = 0;
      for (const t of tokens) if (pn.includes(t)) score += 1;
      if (colorUp && pc && pc.includes(colorUp)) score += 1;
      return { p, score };
    }).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score);
    if (scored.length > 0) {
      hit = scored[0].p;
      return { ...line, sizes, total_qty, product_id: (hit as any).id || null, match_quality: "fuzzy_name" };
    }
  }

  return { ...line, sizes, total_qty, product_id: null, match_quality: "unresolved" };
}

async function fetchUrlAsText(url: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    // Google Sheets: convert /edit URL to CSV export.
    // https://docs.google.com/spreadsheets/d/<ID>/edit?gid=<GID> -> /export?format=csv&gid=<GID>
    const sheetsMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    let fetchUrl = url;
    if (sheetsMatch) {
      const id = sheetsMatch[1];
      const gidMatch = url.match(/[?#&]gid=(\d+)/);
      const gid = gidMatch ? gidMatch[1] : "0";
      fetchUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
    }
    const res = await fetch(fetchUrl, { redirect: "follow" });
    if (!res.ok) {
      if (sheetsMatch && (res.status === 401 || res.status === 403 || res.status === 404)) {
        return { ok: false, error: "Google Sheet isn't shared publicly. Set sharing to 'Anyone with the link can view', or paste the contents as text instead." };
      }
      return { ok: false, error: `Fetch failed: HTTP ${res.status}` };
    }
    const text = await res.text();
    // Sheets returns HTML login page on private docs with 200 sometimes
    if (sheetsMatch && /<html/i.test(text.slice(0, 200))) {
      return { ok: false, error: "Google Sheet isn't shared publicly. Set sharing to 'Anyone with the link can view', or paste the contents as text instead." };
    }
    return { ok: true, text: text.slice(0, 200000) };
  } catch (e) {
    return { ok: false, error: `Fetch error: ${(e as Error).message}` };
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const t0 = Date.now();
  let auditId: number | null = null;
  let userId: string | null = null;

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "ANTHROPIC_API_KEY not set in edge function env" }), { status: 200, headers: CORS });
    }

    const body = await req.json();
    const {
      input_type,           // 'text' | 'image' | 'url'
      text,                 // string (for text + url-fetched)
      image_data_urls,      // string[] (data:image/...;base64,XXX) for vision
      url,                  // string
      catalog,              // CatalogItem[] (small SKU+name+brand+color list)
      estimate_id,
      so_id,
    } = body || {};

    // Identify user from JWT (for audit). Don't fail if missing.
    const authHeader = req.headers.get("Authorization") || "";
    if (authHeader && SUPABASE_URL) {
      try {
        const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user } } = await supa.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
        userId = user?.id || null;
      } catch (_) { /* ignore */ }
    }

    const admin = (SUPABASE_URL && SERVICE_ROLE_KEY)
      ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
      : null;

    // Resolve text for url inputs
    let effectiveText = (typeof text === "string" ? text : "") || "";
    if (input_type === "url") {
      if (!url) return new Response(JSON.stringify({ ok: false, error: "url is required" }), { status: 200, headers: CORS });
      const fetched = await fetchUrlAsText(url);
      if (!fetched.ok) {
        return new Response(JSON.stringify({ ok: false, error: fetched.error }), { status: 200, headers: CORS });
      }
      effectiveText = fetched.text || "";
    }

    if (input_type === "text" && !effectiveText.trim()) {
      return new Response(JSON.stringify({ ok: false, error: "text is required" }), { status: 200, headers: CORS });
    }
    if (input_type === "image" && (!Array.isArray(image_data_urls) || image_data_urls.length === 0)) {
      return new Response(JSON.stringify({ ok: false, error: "image_data_urls is required" }), { status: 200, headers: CORS });
    }

    // Build Claude messages.
    // System prompt has two blocks: the static instructions (cacheable) and
    // the catalog (also cacheable — only invalidated when catalog changes).
    const catalogBlock = Array.isArray(catalog) && catalog.length > 0
      ? buildCatalogBlock(catalog.slice(0, 5000) as CatalogItem[])
      : "PRODUCT CATALOG: (not provided — return sku_guess as-written)";

    // 1-hour TTL on the catalog block: it's ~130k tokens and changes rarely.
    // Without this we pay the cache-write cost on every call (and burn through
    // the org's input-tokens-per-minute rate limit on back-to-back parses).
    const systemBlocks: any[] = [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: catalogBlock, cache_control: { type: "ephemeral", ttl: "1h" } },
    ];

    const userContent: any[] = [];
    if (input_type === "image") {
      for (const dataUrl of image_data_urls) {
        const m = String(dataUrl).match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
        if (!m) continue;
        userContent.push({
          type: "image",
          source: { type: "base64", media_type: m[1], data: m[2] },
        });
      }
      if (effectiveText.trim()) {
        userContent.push({ type: "text", text: `Additional context from the coach:\n${effectiveText}` });
      } else {
        userContent.push({ type: "text", text: "Parse this order into the JSON schema described in the system prompt." });
      }
    } else {
      userContent.push({ type: "text", text: `Parse this order into the JSON schema described in the system prompt:\n\n${effectiveText}` });
    }

    // Insert audit row up-front so we can correlate failures
    if (admin) {
      const ins = await admin.from("ai_order_builds").insert({
        estimate_id: estimate_id || null,
        so_id: so_id || null,
        user_id: userId,
        input_type,
        input_payload: {
          text: input_type !== "image" ? effectiveText.slice(0, 50000) : null,
          image_count: Array.isArray(image_data_urls) ? image_data_urls.length : 0,
          url: input_type === "url" ? url : null,
        },
        model: MODEL,
      }).select("id").single();
      auditId = (ins.data as any)?.id || null;
    }

    const anthropicHeaders = {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      // Required to opt into the 1h cache_control TTL used above.
      "anthropic-beta": "extended-cache-ttl-2025-04-11",
    };
    const anthropicBody = JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: systemBlocks,
      messages: [{ role: "user", content: userContent }],
    });

    // Retry 429 (rate_limit) and 529 (overloaded) up to 3 attempts, respecting
    // the Retry-After header when present. Total wait is capped so we don't
    // blow the edge function's runtime budget.
    let anthropicRes!: Response;
    let lastRetryAfter: number | null = null;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: anthropicHeaders,
        body: anthropicBody,
      });
      if (anthropicRes.ok) break;
      if (anthropicRes.status !== 429 && anthropicRes.status !== 529) break;
      const raHeader = parseInt(anthropicRes.headers.get("retry-after") || "", 10);
      lastRetryAfter = Number.isFinite(raHeader) ? raHeader : null;
      if (attempt === maxAttempts) break;
      try { await anthropicRes.text(); } catch (_) { /* drain */ }
      const waitMs = lastRetryAfter
        ? Math.min(lastRetryAfter * 1000, 10_000)
        : Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise((r) => setTimeout(r, waitMs));
    }

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      const isRateLimit = anthropicRes.status === 429;
      const isOverloaded = anthropicRes.status === 529;
      const friendly = isRateLimit
        ? `The AI service is busy right now${lastRetryAfter ? ` — please try again in ~${lastRetryAfter}s` : " — please try again in a minute"}.`
        : isOverloaded
        ? "The AI service is temporarily overloaded — please try again in a moment."
        : `Claude API error ${anthropicRes.status}: ${errText.slice(0, 300)}`;
      if (admin && auditId) {
        await admin.from("ai_order_builds").update({
          error: `Anthropic ${anthropicRes.status}: ${errText.slice(0, 500)}`,
          duration_ms: Date.now() - t0,
        }).eq("id", auditId);
      }
      return new Response(JSON.stringify({
        ok: false,
        error: friendly,
        error_code: isRateLimit ? "rate_limit" : isOverloaded ? "overloaded" : null,
        retry_after_s: lastRetryAfter,
      }), { status: 200, headers: CORS });
    }

    const claudeJson = await anthropicRes.json();
    const usage = claudeJson?.usage || {};
    const textOut: string = (claudeJson?.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    // Extract the JSON object — Claude usually returns clean JSON given the
    // system prompt, but be defensive in case of stray prose.
    let parsed: { lines: ParsedLine[]; warnings: string[] } = { lines: [], warnings: [] };
    try {
      const start = textOut.indexOf("{");
      const end = textOut.lastIndexOf("}");
      const slice = start >= 0 && end > start ? textOut.slice(start, end + 1) : textOut;
      parsed = JSON.parse(slice);
    } catch (e) {
      if (admin && auditId) {
        await admin.from("ai_order_builds").update({
          raw_response: { text: textOut, parse_error: (e as Error).message },
          error: "Failed to parse model JSON",
          duration_ms: Date.now() - t0,
        }).eq("id", auditId);
      }
      return new Response(JSON.stringify({ ok: false, error: "Claude returned non-JSON output", raw: textOut.slice(0, 500) }), { status: 200, headers: CORS });
    }

    const catalogArr = Array.isArray(catalog) ? (catalog as CatalogItem[]) : [];
    const resolved = (parsed.lines || []).map((l) => resolveAgainstCatalog(l, catalogArr));

    if (admin && auditId) {
      await admin.from("ai_order_builds").update({
        raw_response: claudeJson,
        parsed_lines: resolved,
        line_count: resolved.length,
        input_tokens: usage.input_tokens || null,
        output_tokens: usage.output_tokens || null,
        cache_read_tokens: usage.cache_read_input_tokens || null,
        cache_create_tokens: usage.cache_creation_input_tokens || null,
        duration_ms: Date.now() - t0,
      }).eq("id", auditId);
    }

    return new Response(JSON.stringify({
      ok: true,
      build_id: auditId,
      lines: resolved,
      warnings: parsed.warnings || [],
      usage,
    }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 200, headers: CORS });
  }
});
