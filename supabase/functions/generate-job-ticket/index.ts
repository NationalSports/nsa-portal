// supabase/functions/generate-job-ticket/index.ts
// ─────────────────────────────────────────────────────────
// POST { queue_id: uuid }
//
// Looks up the production_queue row + associated sales order,
// generates a 1-page job-ticket PDF with a Code128 barcode,
// uploads it to the `production-tickets` bucket, and updates
// the queue row with the public URL.
//
// Non-blocking from the caller's perspective — failures are
// logged but don't break the upload flow. The bridge script
// will still deliver the art file even without a ticket.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import bwipjs from "https://esm.sh/bwip-js@4.5.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function renderBarcodePng(text: string): Promise<Uint8Array> {
  // bwip-js on Deno — toBuffer returns a Uint8Array of PNG bytes
  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text,
    scale: 3,
    height: 18,
    includetext: false,
    backgroundcolor: "FFFFFF",
  });
  return png instanceof Uint8Array ? png : new Uint8Array(png);
}

function safeText(s: unknown, max = 120): string {
  const v = typeof s === "string" ? s : "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

async function buildTicketPdf(row: any): Promise<Uint8Array> {
  // Load SO + customer for header context
  const { data: so } = await supabase
    .from("sales_orders")
    .select("id, customer_id, memo, expected_date, production_notes, items, art_files")
    .eq("id", row.so_id)
    .maybeSingle();

  let customerName = "";
  if (so?.customer_id) {
    const { data: c } = await supabase
      .from("customers")
      .select("name, alpha_tag")
      .eq("id", so.customer_id)
      .maybeSingle();
    customerName = c?.name || c?.alpha_tag || "";
  }

  // Find the specific art file for decoration context
  const artFile = Array.isArray(so?.art_files)
    ? so!.art_files.find((a: any) => a?.id === row.art_id)
    : null;

  // Totals
  const items = Array.isArray(so?.items) ? so!.items : [];
  const totalPieces = items.reduce((t: number, it: any) => {
    const sizes = it?.sizes || {};
    return t + Object.values(sizes).reduce((a: number, n: any) => a + (Number(n) || 0), 0);
  }, 0);

  const pdf = await PDFDocument.create();
  // 4x6 thermal-ish ticket: 288 x 432 pts (4in x 6in @ 72 dpi)
  const page = pdf.addPage([288, 432]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0, 0, 0);
  const grey = rgb(0.4, 0.4, 0.4);

  let y = 412;
  const pad = 14;
  const w = 288 - pad * 2;

  // Header: SO + customer
  page.drawText(safeText(row.so_id, 32), { x: pad, y, size: 20, font: bold, color: black });
  y -= 22;
  if (customerName) {
    page.drawText(safeText(customerName, 42), { x: pad, y, size: 11, font: bold, color: black });
    y -= 14;
  }
  if (so?.memo) {
    page.drawText(safeText(so.memo, 48), { x: pad, y, size: 9, font, color: grey });
    y -= 12;
  }
  if (so?.expected_date) {
    page.drawText("Due: " + safeText(so.expected_date, 20), { x: pad, y, size: 9, font, color: grey });
    y -= 12;
  }

  y -= 6;
  page.drawLine({ start: { x: pad, y }, end: { x: pad + w, y }, thickness: 1, color: grey });
  y -= 14;

  // Art block
  page.drawText(safeText(row.art_name || artFile?.name || "Art", 42), {
    x: pad, y, size: 13, font: bold, color: black,
  });
  y -= 16;

  const decoLabel = row.deco_type === "embroidery" ? "Embroidery" : "Screen Print";
  page.drawText(decoLabel + "  ·  " + safeText(row.file_ext?.toUpperCase() || "", 8), {
    x: pad, y, size: 10, font, color: black,
  });
  y -= 14;

  if (artFile?.art_size) {
    page.drawText("Size: " + safeText(artFile.art_size, 32), { x: pad, y, size: 9, font, color: grey });
    y -= 12;
  }

  // Colors block (ink_colors for screen, thread_colors for embroidery)
  const colorSrc = row.deco_type === "embroidery" ? artFile?.thread_colors : artFile?.ink_colors;
  if (colorSrc) {
    const lines = String(colorSrc).split(/\n|,/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
    lines.forEach((line) => {
      page.drawText("• " + safeText(line, 40), { x: pad, y, size: 9, font, color: black });
      y -= 11;
    });
  }

  y -= 6;
  if (totalPieces > 0) {
    page.drawText(`Total pieces to decorate: ${totalPieces}`, {
      x: pad, y, size: 10, font: bold, color: black,
    });
    y -= 14;
  }

  // Barcode block — anchored toward bottom
  try {
    const pngBytes = await renderBarcodePng(row.barcode_value);
    const bcImg = await pdf.embedPng(pngBytes);
    const bcW = w;
    const bcH = 70;
    const bcX = pad;
    const bcY = 50;
    page.drawImage(bcImg, { x: bcX, y: bcY, width: bcW, height: bcH });
    // Human-readable label under the barcode
    const label = row.barcode_value;
    const labelW = bold.widthOfTextAtSize(label, 11);
    page.drawText(label, {
      x: (288 - labelW) / 2, y: bcY - 16, size: 11, font: bold, color: black,
    });
  } catch (e) {
    console.error("[ticket] barcode render failed:", e);
    page.drawText(row.barcode_value, { x: pad, y: 60, size: 12, font: bold, color: black });
  }

  return pdf.save();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResp({ ok: false, error: "POST required" }, 405);

  try {
    const body = await req.json();
    const queueId: string | undefined = body?.queue_id;
    if (!queueId) return jsonResp({ ok: false, error: "queue_id required" }, 400);

    const { data: row, error: loadErr } = await supabase
      .from("production_queue")
      .select("*")
      .eq("id", queueId)
      .single();
    if (loadErr || !row) return jsonResp({ ok: false, error: loadErr?.message || "not found" }, 404);

    const pdfBytes = await buildTicketPdf(row);

    const path = `${row.so_id}/${row.barcode_value}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("production-tickets")
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) return jsonResp({ ok: false, error: "upload: " + upErr.message }, 500);

    const { data: pub } = supabase.storage.from("production-tickets").getPublicUrl(path);
    const publicUrl = pub?.publicUrl || "";

    await supabase
      .from("production_queue")
      .update({ ticket_pdf_url: publicUrl, updated_at: new Date().toISOString() })
      .eq("id", queueId);

    return jsonResp({ ok: true, ticket_pdf_url: publicUrl });
  } catch (e) {
    console.error("[generate-job-ticket] error:", e);
    return jsonResp({ ok: false, error: (e as Error).message }, 500);
  }
});
