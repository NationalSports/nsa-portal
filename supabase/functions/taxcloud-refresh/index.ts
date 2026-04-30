// supabase/functions/taxcloud-refresh/index.ts
// ─────────────────────────────────────────────────────────
// Chunked tax-rate refresh via TaxCloud.
//
// Body params (all optional):
//   { limit?: number       // max customers to process this call (default 50, hard cap 200)
//   , only_missing?: bool  // true → only customers with null/0 tax_rate (default true)
//   , concurrency?: number // parallel TaxCloud calls per chunk (default 10, cap 20)
//   }
//
// Returns:
//   { ok, processed, updated, errors, remaining, changes, failed, total_missing }
//
// `remaining` is how many customers still need a rate AFTER this call completes.
// The client loops, calling this until remaining === 0.
//
// TaxCloud lookups are network-bound and independent, so we fan them out
// concurrently in small batches. A serial loop at ~1–2s/customer easily
// exceeds the edge-function wall-clock and shows zero progress to the UI.
//
// Daily pg_cron job calls this with {} to keep new customers caught up automatically.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TAXCLOUD_API_ID = Deno.env.get("TAXCLOUD_API_LOGIN_ID") || "";
const TAXCLOUD_API_KEY = Deno.env.get("TAXCLOUD_API_KEY") || "";

const ORIGIN = {
  Address1: Deno.env.get("NSA_ORIGIN_ADDRESS") || "123 Main St",
  City: Deno.env.get("NSA_ORIGIN_CITY") || "Your City",
  State: Deno.env.get("NSA_ORIGIN_STATE") || "TX",
  Zip5: Deno.env.get("NSA_ORIGIN_ZIP") || "75001",
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const DEFAULT_LIMIT = 50;
const HARD_CAP = 200;
const DEFAULT_CONCURRENCY = 10;
const CONCURRENCY_CAP = 20;
const TAXCLOUD_TIMEOUT_MS = 8000;

async function lookupRate(address1: string, city: string, state: string, zip5: string): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TAXCLOUD_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.taxcloud.net/1.0/TaxCloud/Lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiLoginID: TAXCLOUD_API_ID,
        apiKey: TAXCLOUD_API_KEY,
        customerID: "rate-refresh",
        cartItems: [{ Index: 0, ItemID: "RATE_CHECK", TIC: "20010", Price: 100.0, Qty: 1 }],
        origin: ORIGIN,
        destination: { Address1: address1 || "", City: city || "", State: state, Zip5: zip5 },
      }),
      signal: ctrl.signal,
    });
    const data = await res.json();
    if (data.ResponseType === 0 || (!data.CartItemsResponse && data.Messages?.length)) return null;
    const taxAmount = data.CartItemsResponse?.[0]?.TaxAmount ?? 0;
    return Math.round((taxAmount / 100) * 100000) / 100000;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let body: { limit?: number; only_missing?: boolean; concurrency?: number } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const limit = Math.min(Math.max(1, body.limit ?? DEFAULT_LIMIT), HARD_CAP);
  const onlyMissing = body.only_missing !== false; // default true
  const concurrency = Math.min(Math.max(1, body.concurrency ?? DEFAULT_CONCURRENCY), CONCURRENCY_CAP);

  try {
    // Base query — active, non-exempt, has shipping state + zip
    let q = supabase
      .from("customers")
      .select("id, name, shipping_address_line1, shipping_city, shipping_state, shipping_zip, tax_rate", { count: "exact" })
      .eq("is_active", true)
      .eq("tax_exempt", false)
      .not("shipping_state", "is", null)
      .not("shipping_zip", "is", null);

    if (onlyMissing) {
      // tax_rate is null OR 0
      q = q.or("tax_rate.is.null,tax_rate.eq.0");
    }

    const { data: customers, error, count } = await q.limit(limit);
    if (error) throw error;

    const totalMissing = count ?? (customers?.length || 0);

    const results: { id: string; name: string; old_rate: number; new_rate: number }[] = [];
    const errors: { id: string; name: string; error: string }[] = [];
    let processed = 0;
    let skipped = 0;

    // Process customers in parallel batches. TaxCloud lookups are network-bound,
    // so fanning out 10 at a time turns a 100s serial run into ~10s.
    const list = customers || [];
    for (let i = 0; i < list.length; i += concurrency) {
      const batch = list.slice(i, i + concurrency);
      await Promise.all(batch.map(async (c) => {
        processed++;
        if (!c.shipping_state?.trim() || !c.shipping_zip?.trim()) { skipped++; return; }
        const newRate = await lookupRate(
          c.shipping_address_line1 || "",
          c.shipping_city || "",
          c.shipping_state,
          c.shipping_zip
        );
        if (newRate === null) {
          errors.push({ id: c.id, name: c.name, error: "Lookup failed" });
          return;
        }
        const { error: updErr } = await supabase
          .from("customers")
          .update({ tax_rate: newRate, updated_at: new Date().toISOString() })
          .eq("id", c.id);
        if (updErr) {
          errors.push({ id: c.id, name: c.name, error: updErr.message });
        } else {
          results.push({ id: c.id, name: c.name, old_rate: c.tax_rate || 0, new_rate: newRate });
        }
      }));
    }

    const remaining = Math.max(0, totalMissing - processed);

    return new Response(
      JSON.stringify({
        ok: true,
        processed,
        updated: results.length,
        skipped,
        errors: errors.length,
        remaining,
        total_missing: totalMissing,
        changes: results,
        failed: errors,
      }),
      { status: 200, headers: CORS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 200, headers: CORS }
    );
  }
});
