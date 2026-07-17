// supabase/functions/taxcloud-lookup/index.ts
// ─────────────────────────────────────────────────────────
// Looks up tax rate from TaxCloud for a given shipping address.
// Called from the customer form UI or during quarterly refresh.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireStaffOrService } from "../_shared/auth.ts";

const TAXCLOUD_API_ID = Deno.env.get("TAXCLOUD_API_LOGIN_ID") || "";
const TAXCLOUD_API_KEY = Deno.env.get("TAXCLOUD_API_KEY") || "";

// Monthly TaxCloud call cap (plan limit). Every call is metered in the DB so
// we never exceed it. Configurable via env without a code change.
const MONTHLY_CAP = parseInt(Deno.env.get("TAXCLOUD_MONTHLY_CAP") || "100", 10);
const meter = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Reserve `n` calls against this month's budget. Fails closed (denies) on any
// metering error so the cap can never be silently overrun.
async function consumeBudget(n: number): Promise<{ granted: boolean; used: number; cap: number }> {
  try {
    const { data, error } = await meter.rpc("taxcloud_try_consume", { p_count: n, p_cap: MONTHLY_CAP });
    if (error) return { granted: false, used: -1, cap: MONTHLY_CAP };
    const row = Array.isArray(data) ? data[0] : data;
    return { granted: !!row?.granted, used: row?.used ?? -1, cap: row?.cap ?? MONTHLY_CAP };
  } catch {
    return { granted: false, used: -1, cap: MONTHLY_CAP };
  }
}

function cappedResponse(used: number, cap: number, headers: HeadersInit) {
  const seen = used >= 0 ? used : cap;
  return new Response(
    JSON.stringify({
      ok: false,
      capped: true,
      used: seen,
      cap,
      error: `Monthly TaxCloud call limit reached (${seen}/${cap}). Lookups resume next month.`,
    }),
    { status: 200, headers },
  );
}

// NSA origin address (where goods ship from)
const ORIGIN = {
  Address1: Deno.env.get("NSA_ORIGIN_ADDRESS") || "123 Main St",
  City: Deno.env.get("NSA_ORIGIN_CITY") || "Your City",
  State: Deno.env.get("NSA_ORIGIN_STATE") || "TX",
  Zip5: Deno.env.get("NSA_ORIGIN_ZIP") || "75001",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  // Authorize first: this spends the metered TaxCloud budget. Callers are staff
  // (customer form), the refresh cron, and webstore-checkout server-side — all
  // send either a staff JWT or the service-role key. Previously any anon-key
  // holder could drain the monthly cap.
  const auth = await requireStaffOrService(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: CORS });
  }

  try {
    const { address1, city, state, zip5 } = await req.json();

    if (!state || !zip5) {
      return new Response(
        JSON.stringify({ ok: false, error: "State and ZIP are required" }),
        { status: 200, headers: CORS }
      );
    }

    if (!city) {
      return new Response(
        JSON.stringify({ ok: false, error: "City is required — TaxCloud needs city for tax jurisdiction lookup" }),
        { status: 200, headers: CORS }
      );
    }

    if (!TAXCLOUD_API_ID || !TAXCLOUD_API_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "TaxCloud API credentials not configured — set TAXCLOUD_API_LOGIN_ID and TAXCLOUD_API_KEY in Supabase secrets" }),
        { status: 200, headers: CORS }
      );
    }

    // Meter this call against the monthly cap before hitting TaxCloud.
    const budget = await consumeBudget(1);
    if (!budget.granted) return cappedResponse(budget.used, budget.cap, CORS);

    // TaxCloud Lookup — use a $100 generic item to get the effective rate
    // TIC 20010 = Clothing/Apparel (handles state exemptions automatically)
    const body = {
      apiLoginID: TAXCLOUD_API_ID,
      apiKey: TAXCLOUD_API_KEY,
      customerID: "rate-lookup",
      cartItems: [
        { Index: 0, ItemID: "RATE_CHECK", TIC: "20010", Price: 100.0, Qty: 1 },
      ],
      origin: ORIGIN,
      destination: {
        Address1: address1 || "",
        City: city || "",
        State: state,
        Zip5: zip5,
      },
    };

    const res = await fetch("https://api.taxcloud.net/1.0/TaxCloud/Lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    // ResponseType 0 = Error, 3 = Success/Informational
    if (data.ResponseType === 0 || (!data.CartItemsResponse && data.Messages?.length)) {
      const tcMsg = data.Messages?.[0]?.Message || "";
      const errDetail = tcMsg || "TaxCloud returned no results — verify API Login ID and API Key are correct in Supabase secrets";
      return new Response(
        JSON.stringify({ ok: false, error: errDetail, response_type: data.ResponseType, messages: data.Messages }),
        { status: 200, headers: CORS }
      );
    }

    // TaxCloud returns tax amount on a $100 item, so amount = rate as percentage
    const taxAmount = data.CartItemsResponse?.[0]?.TaxAmount ?? 0;
    const rate = taxAmount / 100; // Convert to decimal (e.g. 7.875 -> 0.07875)

    return new Response(
      JSON.stringify({
        ok: true,
        tax_rate: Math.round(rate * 100000) / 100000, // 5 decimal precision
        tax_pct: Math.round(taxAmount * 1000) / 1000,  // e.g. 7.875
        destination: { city, state, zip5 },
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
