// supabase/functions/taxcloud-capture/index.ts
// ─────────────────────────────────────────────────────────
// Reports a completed transaction to TaxCloud via AuthorizedWithCapture.
// Call this when an invoice is fully paid so TaxCloud can include the
// tax in your state filing. Also supports Returned for refunds.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const TAXCLOUD_API_ID = Deno.env.get("TAXCLOUD_API_LOGIN_ID") || "";
const TAXCLOUD_API_KEY = Deno.env.get("TAXCLOUD_API_KEY") || "";

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

interface CartItem {
  Index: number;
  ItemID: string;
  TIC: string;
  Price: number;
  Qty: number;
}

interface CaptureRequest {
  action: "capture" | "returned";
  customer_id: string;
  invoice_id: string;
  so_id: string;
  items: Array<{
    sku: string;
    name: string;
    price: number;
    qty: number;
    tic?: string; // Defaults to 20010 (apparel)
  }>;
  destination: {
    address1?: string;
    city?: string;
    state: string;
    zip5: string;
  };
  date_authorized?: string; // ISO date, defaults to now
  date_captured?: string;   // ISO date, defaults to now
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body: CaptureRequest = await req.json();
    const { action = "capture", customer_id, invoice_id, so_id, items, destination } = body;

    if (!customer_id || !invoice_id || !items?.length || !destination?.state || !destination?.zip5) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required fields: customer_id, invoice_id, items, destination.state, destination.zip5" }),
        { status: 400, headers: CORS }
      );
    }

    // Build cart items for TaxCloud
    const cartItems: CartItem[] = items.map((item, i) => ({
      Index: i,
      ItemID: item.sku || `ITEM_${i}`,
      TIC: item.tic || "20010", // Default: apparel
      Price: item.price,
      Qty: item.qty,
    }));

    const now = new Date().toISOString();

    if (action === "capture") {
      // Step 1: Lookup — TaxCloud requires a Lookup before AuthorizedWithCapture
      const lookupBody = {
        apiLoginID: TAXCLOUD_API_ID,
        apiKey: TAXCLOUD_API_KEY,
        customerID: customer_id,
        cartID: invoice_id,
        cartItems,
        origin: ORIGIN,
        destination: {
          Address1: destination.address1 || "",
          City: destination.city || "",
          State: destination.state,
          Zip5: destination.zip5,
        },
      };

      const lookupRes = await fetch("https://api.taxcloud.com/1.0/TaxCloud/Lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lookupBody),
      });
      const lookupData = await lookupRes.json();

      if (lookupData.ResponseType === 3 || lookupData.ResponseType === 0) {
        return new Response(
          JSON.stringify({
            ok: false,
            step: "lookup",
            error: lookupData.Messages?.[0]?.Message || "TaxCloud Lookup failed",
          }),
          { status: 400, headers: CORS }
        );
      }

      // Step 2: AuthorizedWithCapture — tells TaxCloud we collected the tax
      const captureBody = {
        apiLoginID: TAXCLOUD_API_ID,
        apiKey: TAXCLOUD_API_KEY,
        customerID: customer_id,
        cartID: invoice_id,
        orderID: so_id,
        dateAuthorized: body.date_authorized || now,
        dateCaptured: body.date_captured || now,
      };

      const captureRes = await fetch("https://api.taxcloud.com/1.0/TaxCloud/AuthorizedWithCapture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(captureBody),
      });
      const captureData = await captureRes.json();

      if (captureData.ResponseType === 3 || captureData.ResponseType === 0) {
        return new Response(
          JSON.stringify({
            ok: false,
            step: "capture",
            error: captureData.Messages?.[0]?.Message || "AuthorizedWithCapture failed",
          }),
          { status: 400, headers: CORS }
        );
      }

      // Calculate total tax from lookup
      const totalTax = (lookupData.CartItemsResponse || [])
        .reduce((sum: number, item: { TaxAmount: number }) => sum + (item.TaxAmount || 0), 0);

      return new Response(
        JSON.stringify({
          ok: true,
          action: "capture",
          invoice_id,
          so_id,
          customer_id,
          total_tax: Math.round(totalTax * 100) / 100,
          items_count: items.length,
          message: "Transaction reported to TaxCloud for filing",
        }),
        { status: 200, headers: CORS }
      );
    } else if (action === "returned") {
      // Handle refunds — report returned items to TaxCloud
      const returnBody = {
        apiLoginID: TAXCLOUD_API_ID,
        apiKey: TAXCLOUD_API_KEY,
        orderID: so_id,
        cartItems,
        returnedDate: body.date_captured || now,
      };

      const returnRes = await fetch("https://api.taxcloud.com/1.0/TaxCloud/Returned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(returnBody),
      });
      const returnData = await returnRes.json();

      if (returnData.ResponseType === 3 || returnData.ResponseType === 0) {
        return new Response(
          JSON.stringify({
            ok: false,
            step: "returned",
            error: returnData.Messages?.[0]?.Message || "Return failed",
          }),
          { status: 400, headers: CORS }
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          action: "returned",
          invoice_id,
          so_id,
          items_count: items.length,
          message: "Return reported to TaxCloud",
        }),
        { status: 200, headers: CORS }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: "Invalid action. Use 'capture' or 'returned'" }),
      { status: 400, headers: CORS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: CORS }
    );
  }
});
