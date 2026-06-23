// supabase/functions/ai-bill-matcher/index.ts
// ─────────────────────────────────────────────────────────
// "AI bill reconciliation" — a confirm/align pass over a
// supplier bill that ALREADY matched a PO in the system but
// whose line items don't reconcile against what was ordered
// (vendor size-label quirks like "3XLT"/"L 7\""/"9-", or a
// placeholder/variant SKU). Given the bill lines plus the
// matched order's real lines, Claude maps each bill line onto
// the order's actual SKU + size bucket. The client applies the
// mapping, re-validates, and the human still confirms the push.
//
// Constrained on purpose: the model may ONLY pick a SKU/size
// that exists on the order — it cannot invent buckets. Bills
// that didn't match a PO never reach this function (they stay
// parked for "Look at later").
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("AI_BILL_MATCHER_MODEL") || "claude-sonnet-4-6";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

type BillLine = {
  idx: number;
  sku: string;
  size: string;
  qty: number;
  unit_price?: number;
  name?: string;
};
type OrderLine = {
  sku: string;
  name?: string;
  sizes: Record<string, number>; // size bucket -> ordered qty
};
type Mapping = {
  idx: number;
  order_sku: string | null;
  order_size: string | null;
  confidence: "high" | "medium" | "low";
  changed: boolean;
  reason?: string;
};

const SYSTEM_PROMPT = `You reconcile a supplier INVOICE (bill) against the PURCHASE ORDER it was matched to, for National Sports Activewear.

The bill already matched a PO by number. The problem is the vendor labels SKUs/sizes differently than how the order stored them, so the line items don't line up. Your ONLY job: map each bill line to the exact ORDER line (SKU) and ORDER size bucket it corresponds to.

You are given:
- ORDER LINES: the real lines on the matched order — each with a SKU, a product name, and the size buckets that were actually ordered (bucket -> qty).
- BILL LINES: what the vendor billed — each with an index, a SKU as printed, a size as printed, and a qty.

Rules:
- For each bill line, choose order_sku and order_size from the ORDER LINES provided. These are a CLOSED SET — you may only pick a SKU that appears in ORDER LINES, and a size that appears in that SKU's buckets. Never invent a SKU or size.
- Sizes are the usual mismatch. Vendors bake extras into the label that the order omits:
  - inseam/length: "L 7\"" or "XL7\"" is just "L"/"XL"; "XS3\"" is "XS".
  - half-sizes for shoes: "9-" / "9½" / "9 1/2" all mean "9.5".
  - tall: "3XLT" is the Tall cut of "3XL" — map to "3XL" ONLY IF the order has no distinct "3XLT" bucket; if the order does carry "3XLT", keep it.
  - one-size: "OSFM"/"OS"/"ONE" all mean the order's one-size bucket (often "OSFA").
  - Match a bill size to the order bucket that means the same physical size. Prefer an exact bucket; otherwise the equivalent.
- SKUs usually match exactly. If a bill SKU is a placeholder ("CUSTOM", "SPECIAL") or a near-variant, map it to the order SKU whose name/style it matches. If a bill line genuinely has no counterpart on the order, set order_sku=null and order_size=null (do NOT force a match).
- changed = true if order_sku or order_size differs from what the bill printed; false if the bill was already correct (a pure confirmation).
- confidence: "high" when the mapping is unambiguous, "medium" when you inferred from the name/size family, "low" when guessing.
- reason: one short clause, only when changed or low confidence (e.g. "stripped 7\" inseam", "3XLT→3XL, order has no tall bucket", "placeholder SKU → JX4489 by name").

Return STRICT JSON only — no prose, no markdown fences:
{ "mappings": [ { "idx": number, "order_sku": string|null, "order_size": string|null, "confidence": "high"|"medium"|"low", "changed": boolean, "reason"?: string } ], "warnings": string[] }
Return exactly one mapping per bill line, preserving idx.`;

function buildContextBlock(order: { label?: string; lines: OrderLine[] }, bill: { doc_number?: string; po_number?: string; vendor?: string; items: BillLine[] }): string {
  const orderLines = (order.lines || []).map((l) => {
    const buckets = Object.entries(l.sizes || {})
      .map(([k, v]) => `${k}:${v}`)
      .join(", ");
    return `- SKU ${l.sku}${l.name ? ` (${l.name})` : ""} | ordered sizes: ${buckets || "(none)"}`;
  }).join("\n");
  const billLines = (bill.items || []).map((b) =>
    `- idx ${b.idx}: SKU "${b.sku}" size "${b.size}" qty ${b.qty}${b.name ? ` | desc: ${b.name}` : ""}`
  ).join("\n");
  return `ORDER ${order.label || ""} (the closed set of SKUs and size buckets you may choose from):\n${orderLines || "(no order lines)"}\n\nBILL ${bill.doc_number || ""}${bill.po_number ? ` (PO ${bill.po_number})` : ""}${bill.vendor ? ` from ${bill.vendor}` : ""}:\n${billLines || "(no bill lines)"}`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const t0 = Date.now();
  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "ANTHROPIC_API_KEY not set in edge function env" }), { status: 200, headers: CORS });
    }

    const body = await req.json();
    const { bill, order } = body || {};
    if (!bill || !Array.isArray(bill.items) || bill.items.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "bill.items is required" }), { status: 200, headers: CORS });
    }
    if (!order || !Array.isArray(order.lines) || order.lines.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "order.lines is required" }), { status: 200, headers: CORS });
    }

    // Identify user from JWT (best-effort, for audit only).
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization") || "";
    if (authHeader && SUPABASE_URL && SERVICE_ROLE_KEY) {
      try {
        const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: authHeader } } });
        const { data: { user } } = await supa.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
        userId = user?.id || null;
      } catch (_) { /* ignore */ }
    }

    const contextBlock = buildContextBlock(order, bill);

    const anthropicHeaders = {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    };
    const anthropicBody = JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: `Reconcile this bill against the order:\n\n${contextBlock}` }] }],
    });

    // Retry 429 (rate_limit) and 529 (overloaded), capped so we stay within the runtime budget.
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
      const waitMs = lastRetryAfter ? Math.min(lastRetryAfter * 1000, 10_000) : Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise((r) => setTimeout(r, waitMs));
    }

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      const isRateLimit = anthropicRes.status === 429;
      const isOverloaded = anthropicRes.status === 529;
      const friendly = isRateLimit
        ? `The AI service is busy right now${lastRetryAfter ? ` — try again in ~${lastRetryAfter}s` : " — try again in a minute"}.`
        : isOverloaded
        ? "The AI service is temporarily overloaded — try again in a moment."
        : `Claude API error ${anthropicRes.status}: ${errText.slice(0, 300)}`;
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

    let parsed: { mappings?: Mapping[]; warnings?: string[] } = { mappings: [], warnings: [] };
    try {
      const start = textOut.indexOf("{");
      const end = textOut.lastIndexOf("}");
      const slice = start >= 0 && end > start ? textOut.slice(start, end + 1) : textOut;
      parsed = JSON.parse(slice);
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "Claude returned non-JSON output", raw: textOut.slice(0, 500) }), { status: 200, headers: CORS });
    }

    // Validate the model's mappings against the closed set — drop anything that
    // points at a SKU/size the order doesn't have, so a hallucination can never
    // sneak a bad bucket into the apply path.
    const orderBySku = new Map<string, OrderLine>();
    for (const l of order.lines as OrderLine[]) orderBySku.set(String(l.sku).toUpperCase(), l);
    const validMappings: Mapping[] = (parsed.mappings || []).map((m) => {
      const out: Mapping = {
        idx: m.idx,
        order_sku: null,
        order_size: null,
        confidence: m.confidence === "high" || m.confidence === "medium" || m.confidence === "low" ? m.confidence : "low",
        changed: false,
        reason: m.reason,
      };
      if (m.order_sku == null) return out; // model declined to match — leave as-is
      const ol = orderBySku.get(String(m.order_sku).toUpperCase());
      if (!ol) { out.reason = `dropped: SKU ${m.order_sku} not on order`; return out; }
      out.order_sku = ol.sku;
      if (m.order_size != null) {
        const sizeKeys = Object.keys(ol.sizes || {});
        const hit = sizeKeys.find((k) => k === m.order_size) || sizeKeys.find((k) => k.toUpperCase() === String(m.order_size).toUpperCase());
        if (hit) out.order_size = hit;
        else { out.order_size = null; out.reason = `dropped size: ${m.order_size} not a bucket on ${ol.sku}`; }
      }
      out.changed = !!m.changed;
      return out;
    });

    // Best-effort audit. Won't fail the request if the table doesn't exist.
    if (SUPABASE_URL && SERVICE_ROLE_KEY) {
      try {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        await admin.from("ai_bill_matches").insert({
          user_id: userId,
          doc_number: bill.doc_number || null,
          po_number: bill.po_number || null,
          model: MODEL,
          bill_lines: bill.items,
          order_lines: order.lines,
          mappings: validMappings,
          input_tokens: usage.input_tokens || null,
          output_tokens: usage.output_tokens || null,
          duration_ms: Date.now() - t0,
        });
      } catch (_) { /* audit table optional */ }
    }

    return new Response(JSON.stringify({
      ok: true,
      mappings: validMappings,
      warnings: parsed.warnings || [],
      usage,
    }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 200, headers: CORS });
  }
});
