// supabase/functions/taxcloud-refresh/index.ts
// ─────────────────────────────────────────────────────────
// Quarterly batch refresh of tax rates for all active customers.
// Schedule via pg_cron: SELECT cron.schedule('taxcloud-quarterly',
//   '0 6 1 1,4,7,10 *',  -- 6AM on Jan 1, Apr 1, Jul 1, Oct 1
//   $$SELECT net.http_post(
//     url := '<SUPABASE_URL>/functions/v1/taxcloud-refresh',
//     headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb
//   )$$
// );
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

async function lookupRate(address1: string, city: string, state: string, zip5: string): Promise<number | null> {
  try {
    const res = await fetch("https://api.taxcloud.com/1.0/TaxCloud/Lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiLoginID: TAXCLOUD_API_ID,
        apiKey: TAXCLOUD_API_KEY,
        customerID: "quarterly-refresh",
        cartItems: [{ Index: 0, ItemID: "RATE_CHECK", TIC: "20010", Price: 100.0, Qty: 1 }],
        origin: ORIGIN,
        destination: { Address1: address1 || "", City: city || "", State: state, Zip5: zip5 },
      }),
    });
    const data = await res.json();
    if (data.ResponseType === 0 || (!data.CartItemsResponse && data.Messages?.length)) return null;
    const taxAmount = data.CartItemsResponse?.[0]?.TaxAmount ?? 0;
    return Math.round((taxAmount / 100) * 100000) / 100000;
  } catch {
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // Get all active, non-exempt customers with a shipping state + zip
    const { data: customers, error } = await supabase
      .from("customers")
      .select("id, name, shipping_address_line1, shipping_city, shipping_state, shipping_zip, tax_rate")
      .eq("is_active", true)
      .eq("tax_exempt", false)
      .not("shipping_state", "is", null)
      .not("shipping_zip", "is", null);

    if (error) throw error;

    const results: { id: string; name: string; old_rate: number; new_rate: number }[] = [];
    const errors: { id: string; name: string; error: string }[] = [];
    let skipped = 0;

    for (const c of customers || []) {
      if (!c.shipping_state || !c.shipping_zip) { skipped++; continue; }

      // Rate-limit: ~1 req/sec to be respectful to TaxCloud
      await new Promise(r => setTimeout(r, 500));

      const newRate = await lookupRate(
        c.shipping_address_line1 || "",
        c.shipping_city || "",
        c.shipping_state,
        c.shipping_zip
      );

      if (newRate === null) {
        errors.push({ id: c.id, name: c.name, error: "Lookup failed" });
        continue;
      }

      // Only update if rate actually changed
      if (Math.abs((c.tax_rate || 0) - newRate) > 0.000001) {
        const { error: updErr } = await supabase
          .from("customers")
          .update({ tax_rate: newRate, updated_at: new Date().toISOString() })
          .eq("id", c.id);

        if (updErr) {
          errors.push({ id: c.id, name: c.name, error: updErr.message });
        } else {
          results.push({ id: c.id, name: c.name, old_rate: c.tax_rate || 0, new_rate: newRate });
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        total_customers: customers?.length || 0,
        updated: results.length,
        skipped,
        errors: errors.length,
        changes: results,
        failed: errors,
      }),
      { status: 200, headers: CORS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: CORS }
    );
  }
});
