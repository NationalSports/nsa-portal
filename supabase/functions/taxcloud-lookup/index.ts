// supabase/functions/taxcloud-lookup/index.ts
// ─────────────────────────────────────────────────────────
// Looks up tax rate from TaxCloud for a given shipping address.
// Called from the customer form UI or during quarterly refresh.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const TAXCLOUD_API_ID = Deno.env.get("TAXCLOUD_API_LOGIN_ID") || "";
const TAXCLOUD_API_KEY = Deno.env.get("TAXCLOUD_API_KEY") || "";

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

  try {
    const { address1, city, state, zip5 } = await req.json();

    if (!state || !zip5) {
      return new Response(
        JSON.stringify({ ok: false, error: "State and ZIP are required" }),
        { status: 400, headers: CORS }
      );
    }

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

    const res = await fetch("https://api.taxcloud.com/1.0/TaxCloud/Lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (data.ResponseType === 3 || data.ResponseType === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: data.Messages?.[0]?.Message || "TaxCloud lookup failed" }),
        { status: 400, headers: CORS }
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
      { status: 500, headers: CORS }
    );
  }
});
