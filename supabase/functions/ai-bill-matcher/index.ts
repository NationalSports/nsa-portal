// supabase/functions/ai-bill-matcher/index.ts
// ─────────────────────────────────────────────────────────
// "AI bill reconciliation" — two related passes over a supplier
// bill, both constrained to a CLOSED SET so the model can never
// invent a SKU/size/order:
//
//  1) RECONCILE  (body.order present): the bill ALREADY matched a
//     PO, but its line items don't reconcile against what was
//     ordered (vendor size-label quirks like "3XLT"/"L 7\""/"9-",
//     or a placeholder SKU). Given the bill lines plus the matched
//     order's real lines, Claude maps each bill line onto the
//     order's actual SKU + size bucket.
//
//  2) FIND PO  (body.candidates present): the bill did NOT match a
//     PO by number. Given the bill lines plus SEVERAL candidate
//     open orders (pre-narrowed client-side by SKU overlap), Claude
//     picks the ONE order this bill belongs to and maps each bill
//     line onto that order's item index. The client uses the pick
//     to pre-fill the existing manual-match wizard; the human still
//     confirms the push.
//
// In both passes the model may ONLY choose from what it's given —
// it cannot invent buckets, items, or orders. The client applies
// the mapping, re-validates against the deterministic pipeline, and
// the human confirms.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
// Two model tiers, one per pass (2026-07-21 mining, BILL_AI_MINING_2026-07-21.md):
// RECONCILE is mechanical size-label mapping inside a closed set with server-side
// validation and a human approve behind it — 83% of its mappings came back high-
// confidence, so the cheap tier handles it. FIND-PO is genuine judgment (pick the
// order) and stays on Sonnet. AI_BILL_MATCHER_MODEL still overrides BOTH (existing
// deploys keep their behavior); the per-pass vars override that.
const MODEL_GLOBAL = Deno.env.get("AI_BILL_MATCHER_MODEL") || "";
const MODEL_RECONCILE = Deno.env.get("AI_BILL_MATCHER_MODEL_RECONCILE") || MODEL_GLOBAL || "claude-haiku-4-5-20251001";
const MODEL_FINDPO = Deno.env.get("AI_BILL_MATCHER_MODEL_FINDPO") || MODEL_GLOBAL || "claude-sonnet-4-6";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Stable hash of exactly what the model sees, so a byte-identical re-run (same bill,
// same order state) replays the stored result instead of re-calling the API. Mined
// 2026-07-21: 379 of 478 calls (~695k tokens) were such repeats — the client re-sweeps
// unresolved bills on every pull. Order state that changes (a size gets billed, a
// candidate list shifts) changes the hash, so staleness self-invalidates.
async function inputHash(mode: string, contextBlock: string): Promise<string> {
  const data = new TextEncoder().encode(mode + "\n" + contextBlock);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
// A candidate open order the FIND-PO pass may choose from. items are an
// indexed flat list (idx -> the order item) so the model can point each
// bill line at a target item index the client wizard understands directly.
type CandidateItem = { idx: number; sku: string; name?: string; size: string; qty: number; color?: string };
type Candidate = { id: string; kind?: string; label?: string; vendor?: string; items: CandidateItem[] };
type FindPoMapping = {
  idx: number;
  target_idx: number | null;
  allocated_qty: number;
  confidence: "high" | "medium" | "low";
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

const FIND_PO_SYSTEM_PROMPT = `You match a supplier INVOICE (bill) to the correct open order, then map its lines, for National Sports Activewear.

The bill did NOT auto-match an order by PO number. You are given the bill's lines plus SEVERAL CANDIDATE ORDERS (already narrowed to ones that share something with the bill). Each candidate has an id, a kind, a label, a vendor string, and an indexed list of open items (idx, sku, name, size, qty).

Do two things:
1) Pick the ONE candidate order this bill belongs to. Weigh the signals: shared SKUs are the strongest, then matching product names, then sizes that line up, then vendor. The candidates are a CLOSED SET — chosen_id MUST be one of the given candidate ids, or null. If no candidate plausibly matches, return chosen_id=null (do NOT force it).
2) For each bill line, map it to the item INDEX (target_idx) within the CHOSEN candidate's items list. target_idx must be a valid index in that candidate's items, or null if the bill line has no counterpart there.

Size-label rules (same as reconciliation): "L 7\"" / "XL7\"" → "L"/"XL"; "9-" / "9½" → "9.5"; "3XLT" → the order's "3XL" unless it carries a distinct tall bucket; "OSFM"/"OS"/"ONE" → the order's one-size item. Match by the same physical size.

allocated_qty defaults to the bill line's qty.
confidence: "high" when shared SKUs make it unambiguous, "medium" when matched by name/size family, "low" when guessing.
reason: one short clause for why you chose that order (e.g. "shares SKU JX4464 and 3XL sizes").

Return STRICT JSON only — no prose, no markdown fences:
{ "chosen_id": string|null, "chosen_kind": string|null, "confidence": "high"|"medium"|"low", "reason": string, "mappings": [ { "idx": number, "target_idx": number|null, "allocated_qty": number, "confidence": "high"|"medium"|"low", "reason"?: string } ], "warnings": string[] }
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

function buildFindPoContext(candidates: Candidate[], bill: { doc_number?: string; po_number?: string; vendor?: string; items: BillLine[] }): string {
  const billLines = (bill.items || []).map((b) =>
    `- idx ${b.idx}: SKU "${b.sku}" size "${b.size}" qty ${b.qty}${b.name ? ` | desc: ${b.name}` : ""}`
  ).join("\n");
  const cand = (candidates || []).map((c) => {
    const items = (c.items || []).map((it) =>
      `    [${it.idx}] SKU ${it.sku}${it.name ? ` (${it.name})` : ""} size ${it.size} qty ${it.qty}${it.color ? ` ${it.color}` : ""}`
    ).join("\n");
    return `- id "${c.id}" kind ${c.kind || "?"} — ${c.label || ""}${c.vendor ? ` | ${c.vendor}` : ""}\n${items || "    (no open items)"}`;
  }).join("\n");
  return `BILL ${bill.doc_number || ""}${bill.po_number ? ` (printed PO ${bill.po_number}, did not match)` : ""}${bill.vendor ? ` from ${bill.vendor}` : ""}:\n${billLines || "(no bill lines)"}\n\nCANDIDATE ORDERS (pick exactly one by id, then map each bill line to a target_idx within it):\n${cand || "(no candidates)"}`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const t0 = Date.now();
  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "ANTHROPIC_API_KEY not set in edge function env" }), { status: 200, headers: CORS });
    }

    const body = await req.json();
    const { bill, order, candidates, mode } = body || {};
    if (!bill || !Array.isArray(bill.items) || bill.items.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "bill.items is required" }), { status: 200, headers: CORS });
    }
    // Pick the pass: FIND PO when candidates are supplied (and no single order), else RECONCILE.
    const isFindPo = mode === "find_po" || (Array.isArray(candidates) && candidates.length > 0 && !order);
    if (isFindPo) {
      if (!Array.isArray(candidates) || candidates.length === 0) {
        return new Response(JSON.stringify({ ok: false, error: "candidates is required for find_po" }), { status: 200, headers: CORS });
      }
    } else if (!order || !Array.isArray(order.lines) || order.lines.length === 0) {
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

    const systemText = isFindPo ? FIND_PO_SYSTEM_PROMPT : SYSTEM_PROMPT;
    const contextBlock = isFindPo
      ? buildFindPoContext(candidates as Candidate[], bill)
      : buildContextBlock(order, bill);
    const userText = isFindPo
      ? `Find which open order this bill belongs to, then map its lines:\n\n${contextBlock}`
      : `Reconcile this bill against the order:\n\n${contextBlock}`;
    const MODEL = isFindPo ? MODEL_FINDPO : MODEL_RECONCILE;

    // Cache replay: identical inputs → the stored validated result, no API call.
    // body.force=true bypasses (a human explicitly asking for a fresh opinion).
    const cacheKey = await inputHash(isFindPo ? "find_po" : "reconcile", contextBlock);
    if (!body.force && SUPABASE_URL && SERVICE_ROLE_KEY) {
      try {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        const { data: hit } = await admin.from("ai_bill_matches")
          .select("response")
          .eq("input_hash", cacheKey)
          .not("response", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (hit && hit.response && hit.response.ok) {
          return new Response(JSON.stringify({ ...hit.response, cached: true }), { status: 200, headers: CORS });
        }
      } catch (_) { /* cache is best-effort (e.g. pre-00230 schema) — fall through to a live call */ }
    }

    const anthropicHeaders = {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    };
    const anthropicBody = JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
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

    let parsed: any = {};
    try {
      const start = textOut.indexOf("{");
      const end = textOut.lastIndexOf("}");
      const slice = start >= 0 && end > start ? textOut.slice(start, end + 1) : textOut;
      parsed = JSON.parse(slice);
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "Claude returned non-JSON output", raw: textOut.slice(0, 500) }), { status: 200, headers: CORS });
    }

    // ── FIND PO: validate the chosen order is one of the candidates, and each
    // target_idx is a real item index within it, so a hallucinated order/index
    // can never reach the wizard. ────────────────────────────────────────────
    if (isFindPo) {
      const candList = candidates as Candidate[];
      const candById = new Map<string, Candidate>();
      for (const c of candList) candById.set(String(c.id), c);
      const chosen = parsed.chosen_id != null ? candById.get(String(parsed.chosen_id)) : null;
      const chosenItems = chosen?.items || [];
      const qtyByIdx = new Map<number, number>();
      for (const b of (bill.items as BillLine[])) qtyByIdx.set(b.idx, Number(b.qty) || 0);

      const validMappings: FindPoMapping[] = (parsed.mappings || []).map((m: any) => {
        const out: FindPoMapping = {
          idx: m.idx,
          target_idx: null,
          allocated_qty: Number.isFinite(+m.allocated_qty) && +m.allocated_qty > 0 ? +m.allocated_qty : (qtyByIdx.get(m.idx) || 0),
          confidence: m.confidence === "high" || m.confidence === "medium" || m.confidence === "low" ? m.confidence : "low",
          reason: m.reason,
        };
        if (!chosen || m.target_idx == null) return out;
        const ti = Number(m.target_idx);
        if (!Number.isInteger(ti) || ti < 0 || ti >= chosenItems.length) { out.reason = `dropped: target_idx ${m.target_idx} out of range`; return out; }
        out.target_idx = ti;
        return out;
      });

      const confidence = parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low" ? parsed.confidence : "low";

      const responseObj = {
        ok: true,
        mode: "find_po",
        chosen_id: chosen ? String(chosen.id) : null,
        chosen_kind: chosen?.kind || null,
        confidence,
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
        mappings: validMappings,
        warnings: parsed.warnings || [],
        usage,
      };

      // Best-effort audit (reuses ai_bill_matches; candidates stored under order_lines).
      if (SUPABASE_URL && SERVICE_ROLE_KEY) {
        try {
          const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
          await admin.from("ai_bill_matches").insert({
            user_id: userId,
            doc_number: bill.doc_number || null,
            po_number: chosen ? String(chosen.id) : null,
            model: MODEL,
            bill_lines: bill.items,
            order_lines: { mode: "find_po", chosen_id: chosen ? String(chosen.id) : null, candidates: candList },
            mappings: validMappings,
            input_tokens: usage.input_tokens || null,
            output_tokens: usage.output_tokens || null,
            duration_ms: Date.now() - t0,
            input_hash: cacheKey,
            response: responseObj,
          });
        } catch (_) { /* audit table optional */ }
      }

      return new Response(JSON.stringify(responseObj), { status: 200, headers: CORS });
    }

    // ── RECONCILE: validate the model's mappings against the closed set — drop
    // anything that points at a SKU/size the order doesn't have, so a
    // hallucination can never sneak a bad bucket into the apply path. ─────────
    const orderBySku = new Map<string, OrderLine>();
    for (const l of order.lines as OrderLine[]) orderBySku.set(String(l.sku).toUpperCase(), l);
    const validMappings: Mapping[] = (parsed.mappings || []).map((m: Mapping) => {
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

    const responseObj = {
      ok: true,
      mappings: validMappings,
      warnings: parsed.warnings || [],
      usage,
    };

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
          input_hash: cacheKey,
          response: responseObj,
        });
      } catch (_) { /* audit table optional */ }
    }

    return new Response(JSON.stringify(responseObj), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 200, headers: CORS });
  }
});
