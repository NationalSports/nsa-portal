// supabase/functions/qb-auth/index.ts
// ─────────────────────────────────────────────────────────
// Initiates QuickBooks Online OAuth2 authorization flow.
// Redirects the user to Intuit's consent screen.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID") || "";
const QBO_REDIRECT_URI = Deno.env.get("QBO_REDIRECT_URI") || "";
const QBO_SCOPES = "com.intuit.quickbooks.accounting";

// Intuit OAuth2 endpoints (production)
const INTUIT_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    if (!QBO_CLIENT_ID || !QBO_REDIRECT_URI) {
      return new Response(
        JSON.stringify({ ok: false, error: "QBO_CLIENT_ID and QBO_REDIRECT_URI must be set" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Generate a random state parameter to prevent CSRF
    const state = crypto.randomUUID();

    const params = new URLSearchParams({
      client_id: QBO_CLIENT_ID,
      response_type: "code",
      scope: QBO_SCOPES,
      redirect_uri: QBO_REDIRECT_URI,
      state: state,
    });

    const authUrl = `${INTUIT_AUTH_URL}?${params.toString()}`;

    // Return the URL + state so the frontend can store state and redirect
    return new Response(
      JSON.stringify({ ok: true, auth_url: authUrl, state }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
