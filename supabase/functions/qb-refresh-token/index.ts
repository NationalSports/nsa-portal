// supabase/functions/qb-refresh-token/index.ts
// ─────────────────────────────────────────────────────────
// Refreshes the QBO access token using the stored refresh token.
// Called before QB API calls when the access token has expired.
// Access tokens expire after 1 hour; refresh tokens after 100 days.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID") || "";
const QBO_CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
    // Load stored tokens
    const { data: row, error: loadErr } = await supabase
      .from("app_state")
      .select("value")
      .eq("key", "qb_tokens")
      .single();

    if (loadErr || !row?.value) {
      return new Response(
        JSON.stringify({ ok: false, error: "No QB tokens found. Connect QuickBooks first." }),
        { status: 400, headers: CORS }
      );
    }

    const stored = row.value;

    // Check if access token is still valid (with 5-min buffer)
    const createdAt = new Date(stored.token_created_at).getTime();
    const expiresAt = createdAt + (stored.expires_in - 300) * 1000; // 5-min buffer
    if (Date.now() < expiresAt) {
      return new Response(
        JSON.stringify({
          ok: true,
          access_token: stored.access_token,
          realm_id: stored.realm_id,
          company_name: stored.company_name,
          refreshed: false,
        }),
        { status: 200, headers: CORS }
      );
    }

    // Token expired — refresh it
    const basicAuth = btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`);
    const tokenRes = await fetch(INTUIT_TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: stored.refresh_token,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return new Response(
        JSON.stringify({ ok: false, error: "Refresh failed: " + errText }),
        { status: 401, headers: CORS }
      );
    }

    const tokens = await tokenRes.json();

    // Update stored tokens
    const updated = {
      ...stored,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      x_refresh_token_expires_in: tokens.x_refresh_token_expires_in,
      token_created_at: new Date().toISOString(),
    };

    const { error: saveErr } = await supabase
      .from("app_state")
      .update({ value: updated })
      .eq("key", "qb_tokens");

    if (saveErr) {
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to save refreshed tokens: " + saveErr.message }),
        { status: 500, headers: CORS }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        access_token: tokens.access_token,
        realm_id: stored.realm_id,
        company_name: stored.company_name,
        refreshed: true,
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
