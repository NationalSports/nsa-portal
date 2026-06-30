// supabase/functions/ai-store-builder/index.ts
// ─────────────────────────────────────────────────────────
// "Build a store with AI" — turns a plain-English store brief
// ("Adidas-centric, in-stock black/white/royal, D4T shorts +
// baseball cleats") into a STRUCTURED catalog filter spec
// (brands, colors, categories, in_stock, keywords) using Claude
// with structured outputs. The CLIENT queries the catalog with
// the returned spec and lets staff review the matched products
// before building the store — the same review-before-commit
// pattern as ai-order-builder.
//
// Intentionally minimal: this function only does the AI
// translation. No catalog query, no writes — so it is cheap,
// fast, and safe to call speculatively as the user types.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
// Sonnet 4.6 is plenty for this lightweight, schema-constrained extraction, and
// it matches the proven ai-order-builder. Override per-env if you ever need to:
// AI_STORE_BUILDER_MODEL=claude-haiku-4-5 (cheaper still) or claude-opus-4-8.
const MODEL = Deno.env.get("AI_STORE_BUILDER_MODEL") || "claude-sonnet-4-6";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const SYSTEM_PROMPT = `You turn a rep/coach's plain-English description of a team STORE into a structured catalog filter for National Sports Activewear.

The brief describes which products the store should carry — by brand, color, product type, and stock. Translate it into the JSON schema you are given. Rules:
- brands: choose only from the VALID BRANDS list (exact strings). Empty array = any brand. "Adidas-centric" -> ["Adidas"].
- categories: choose only from the VALID CATEGORIES list (exact strings). Map everyday words to the closest categories — "shorts" -> a shorts category, "cleats"/"baseball cleats" -> a footwear/cleats category, "hoodie" -> a fleece/sweatshirt category. Empty array = any.
- colors: plain color words exactly as the brief says them ("Black", "White", "Royal"). Empty array = any color.
- in_stock_only: true ONLY if the brief asks for in-stock / available / "what's in stock" items; otherwise false.
- keywords: remaining specific style cues or model names that are not a brand, category, or color — e.g. "D4T", "techfit", a style number. These get matched against product names. Empty if none.
- interpretation: one short sentence summarizing what you understood, for the user to confirm.

Sport relevance — keep a store ON its sport:
- When the brief names a sport (volleyball, baseball, soccer, etc.), add that sport word to keywords so sport-specific items match by name.
- Do NOT pick broad equipment/ball/gear categories that would sweep in OTHER sports' gear. A volleyball store must not surface soccer balls, baseball gloves, etc. If the only way to include equipment is a generic category, prefer leaving categories to apparel and rely on the sport keyword instead.
- Apparel (tees, hoods, shorts, polos, pants, outerwear, hats, bags) is sport-neutral and fine to include broadly; sport-specific EQUIPMENT must match the named sport only.

Only use brand/category values that appear verbatim in the provided lists. If unsure, leave the field empty rather than inventing a value.`;

// additionalProperties:false is required on every object for structured outputs.
const FILTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    interpretation: { type: "string" },
    brands: { type: "array", items: { type: "string" } },
    colors: { type: "array", items: { type: "string" } },
    categories: { type: "array", items: { type: "string" } },
    in_stock_only: { type: "boolean" },
    keywords: { type: "array", items: { type: "string" } },
  },
  required: ["interpretation", "brands", "colors", "categories", "in_stock_only", "keywords"],
};

// Distinct non-null values for a column, so the model only picks brand/category
// names that actually exist. The products table is small enough (~9k rows) to
// dedupe a single column in memory.
async function distinctValues(admin: any, column: string, cap = 400): Promise<string[]> {
  const { data } = await admin.from("products").select(column).not(column, "is", null).limit(20000);
  const set = new Set<string>();
  for (const row of data || []) { const v = (row as any)[column]; if (v) set.add(String(v).trim()); }
  return [...set].filter(Boolean).sort().slice(0, cap);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "ANTHROPIC_API_KEY not set in edge function env" }), { status: 200, headers: CORS });
    }

    const body = await req.json().catch(() => ({}));
    const brief = (typeof body?.brief === "string" ? body.brief : "").trim();
    if (!brief) return new Response(JSON.stringify({ ok: false, error: "brief is required" }), { status: 200, headers: CORS });

    const admin = (SUPABASE_URL && SERVICE_ROLE_KEY) ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;
    let brands: string[] = [], categories: string[] = [];
    if (admin) {
      [brands, categories] = await Promise.all([distinctValues(admin, "brand"), distinctValues(admin, "category")]);
    }
    const reference = `VALID BRANDS:\n${brands.join(", ")}\n\nVALID CATEGORIES:\n${categories.join(", ")}`;

    // Structured outputs constrains the response to FILTER_SCHEMA — no "return
    // strict JSON" prompting needed, and the parse below can't drift.
    const anthropicBody = JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      output_config: { format: { type: "json_schema", schema: FILTER_SCHEMA } },
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        // The brand/category reference rarely changes — cache it across calls.
        { type: "text", text: reference, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `Store brief:\n\n${brief}` }],
    });

    // Retry 429 (rate limit) / 529 (overloaded) with backoff; everything else returns as-is.
    let res!: Response;
    for (let attempt = 1; attempt <= 3; attempt++) {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: anthropicBody,
      });
      if (res.ok || (res.status !== 429 && res.status !== 529)) break;
      try { await res.text(); } catch (_) { /* drain */ }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const friendly = res.status === 429 ? "The AI service is busy — try again in a moment."
        : res.status === 529 ? "The AI service is temporarily overloaded — try again shortly."
        : `Claude API error ${res.status}: ${errText.slice(0, 300)}`;
      return new Response(JSON.stringify({ ok: false, error: friendly }), { status: 200, headers: CORS });
    }

    const json = await res.json();
    const textOut: string = (json?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    let spec: any;
    try {
      const s = textOut.indexOf("{"), e = textOut.lastIndexOf("}");
      spec = JSON.parse(s >= 0 && e > s ? textOut.slice(s, e + 1) : textOut);
    } catch (_) {
      return new Response(JSON.stringify({ ok: false, error: "Could not parse the AI filter spec", raw: textOut.slice(0, 400) }), { status: 200, headers: CORS });
    }

    return new Response(JSON.stringify({ ok: true, spec, usage: json?.usage || null }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 200, headers: CORS });
  }
});
