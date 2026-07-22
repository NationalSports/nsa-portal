// supabase/functions/ai-bill-parse/index.ts
// ─────────────────────────────────────────────────────────
// Vision parse for SCANNED supplier bills — the "Needs Manual Upload" bucket
// (owner, 2026-07-21). Sports Inc only scans ~250 suppliers: the API carries
// header totals but no usable line items, so accounting downloads the PDF by
// hand. Text extraction fails on those scans (no text layer), so the client
// sends page IMAGES here and Claude reads the invoice off the page.
//
// Output is the SAME parsed-bill shape the deterministic PDF parser emits, so
// everything downstream — PO matching, the reconcile pipeline, validation,
// human push — is unchanged. Extraction is the only AI step; nothing here
// writes. The client tags these bills _ai_parsed and they are EXCLUDED from
// auto-push: a scanned read always gets human eyes before money moves.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
// Sonnet by default: reading tabular money data off a scan is harder than
// closed-set label mapping, and a misread number costs real dollars.
const MODEL = Deno.env.get("AI_BILL_PARSE_MODEL") || "claude-sonnet-4-6";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const SYSTEM_PROMPT = `You read scanned supplier invoices (bills) for National Sports Activewear and transcribe them into structured JSON. The pages you receive are images of ONE PDF, which may contain one or more invoices.

Transcribe EXACTLY what is printed — never invent, estimate, or "fix" a value. If a field is unreadable or absent, use "" for strings and 0 for numbers, and add a note to warnings.

For each invoice, extract:
- doc_number: the supplier's invoice number as printed.
- po_number: the customer PO / order reference as printed (often like "PO 3131 TUH" or "3131TUH").
- supplier: the vendor who issued the invoice.
- doc_date, due_date: as printed, MM/DD/YYYY.
- tracking: shipment tracking number if printed, else "".
- is_credit: true only if this is clearly a credit memo.
- items: one entry per line item — { "sku": the vendor's item/style number as printed, "desc": the description, "color": color if printed else "", "size": size if printed else "", "qty": quantity shipped/billed (number), "unit_price": unit price (number), "extension": the line total (number) }. Split size-breakdown rows into one item per size when the invoice prints per-size quantities. Skip pure header/subtotal rows.
- merchandise_total: the goods subtotal before freight/tax.
- freight: shipping/freight charges (0 if none).
- si_upcharge: the "SI Upcharge" / service-handling charge if printed (Sports Inc invoices), else 0.
- doc_total: the invoice grand total as printed.
- warnings: short notes about anything unreadable, ambiguous, or unusual.

Cross-check before answering: the sum of item extensions should be close to merchandise_total, and merchandise_total + freight (+ any other printed charges — note them in warnings) should be close to doc_total. If they don't reconcile, transcribe what is printed anyway and add a warning saying which numbers disagree.

Return STRICT JSON only — no prose, no markdown fences:
{ "bills": [ { "doc_number": string, "po_number": string, "supplier": string, "doc_date": string, "due_date": string, "tracking": string, "is_credit": boolean, "items": [...], "merchandise_total": number, "freight": number, "si_upcharge": number, "doc_total": number, "warnings": string[] } ] }`;

const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v)); return isNaN(n) ? 0 : n; };

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "ANTHROPIC_API_KEY not set in edge function env" }), { status: 200, headers: CORS });
    }
    const body = await req.json();
    const pages: Array<{ media_type?: string; data?: string }> = Array.isArray(body?.pages) ? body.pages : [];
    const usable = pages.filter((p) => p && typeof p.data === "string" && p.data.length > 100).slice(0, 8);
    if (!usable.length) {
      return new Response(JSON.stringify({ ok: false, error: "pages[] (base64 images) is required" }), { status: 200, headers: CORS });
    }

    const content: any[] = usable.map((p) => ({
      type: "image",
      source: { type: "base64", media_type: p.media_type || "image/jpeg", data: p.data },
    }));
    content.push({ type: "text", text: `Transcribe the invoice(s) in these ${usable.length} page image(s)${body?.filename ? ` (file: ${String(body.filename).slice(0, 120)})` : ""} into the JSON schema.` });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      const friendly = res.status === 429 ? "The AI service is busy — try again in a minute."
        : res.status === 529 ? "The AI service is temporarily overloaded — try again in a moment."
        : `Claude API error ${res.status}: ${errText.slice(0, 300)}`;
      return new Response(JSON.stringify({ ok: false, error: friendly }), { status: 200, headers: CORS });
    }
    const j = await res.json();
    const textOut: string = (j?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    let parsed: any = {};
    try {
      const s = textOut.indexOf("{"); const e = textOut.lastIndexOf("}");
      parsed = JSON.parse(s >= 0 && e > s ? textOut.slice(s, e + 1) : textOut);
    } catch (_e) {
      return new Response(JSON.stringify({ ok: false, error: "Claude returned non-JSON output", raw: textOut.slice(0, 500) }), { status: 200, headers: CORS });
    }

    // Coerce to the deterministic parser's shape — numbers are numbers, strings are
    // strings, and a line with no quantity AND no money is dropped as scan noise.
    const bills = (Array.isArray(parsed.bills) ? parsed.bills : []).map((b: any) => ({
      doc_number: String(b?.doc_number || "").trim(),
      po_number: String(b?.po_number || "").trim(),
      supplier: String(b?.supplier || "").trim(),
      doc_date: String(b?.doc_date || "").trim(),
      due_date: String(b?.due_date || "").trim(),
      tracking: String(b?.tracking || "").trim(),
      is_credit: !!b?.is_credit,
      items: (Array.isArray(b?.items) ? b.items : []).map((it: any) => ({
        sku: String(it?.sku || "").trim(),
        desc: String(it?.desc || "").trim(),
        color: String(it?.color || "").trim(),
        size: String(it?.size || "").trim(),
        qty: num(it?.qty),
        unit_price: num(it?.unit_price),
        extension: num(it?.extension),
      })).filter((it: any) => it.qty > 0 || it.unit_price > 0 || it.extension > 0),
      merchandise_total: num(b?.merchandise_total),
      freight: num(b?.freight),
      si_upcharge: num(b?.si_upcharge),
      doc_total: num(b?.doc_total),
      warnings: (Array.isArray(b?.warnings) ? b.warnings : []).map((w: any) => String(w)).slice(0, 12),
    })).filter((b: any) => b.doc_number || b.items.length);

    return new Response(JSON.stringify({ ok: true, bills, usage: j?.usage || {} }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 200, headers: CORS });
  }
});
