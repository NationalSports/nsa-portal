// supabase/functions/qb-callback/index.ts
// ─────────────────────────────────────────────────────────
// Handles the OAuth2 callback from QuickBooks Online.
// Exchanges the authorization code for access + refresh tokens,
// fetches company info, and stores credentials in app_state.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID") || "";
const QBO_CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET") || "";
const QBO_REDIRECT_URI = Deno.env.get("QBO_REDIRECT_URI") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PORTAL_URL = Deno.env.get("PORTAL_URL") || ""; // Frontend URL to redirect back to

const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const realmId = url.searchParams.get("realmId");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      const redirectUrl = `${PORTAL_URL}?qb_error=${encodeURIComponent(error)}`;
      return Response.redirect(redirectUrl, 302);
    }

    if (!code || !realmId) {
      const redirectUrl = `${PORTAL_URL}?qb_error=${encodeURIComponent("Missing code or realmId")}`;
      return Response.redirect(redirectUrl, 302);
    }

    // Exchange authorization code for tokens
    const basicAuth = btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`);
    const tokenRes = await fetch(INTUIT_TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: QBO_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      const redirectUrl = `${PORTAL_URL}?qb_error=${encodeURIComponent("Token exchange failed: " + errText)}`;
      return Response.redirect(redirectUrl, 302);
    }

    const tokens = await tokenRes.json();

    // Fetch company info from QBO
    let companyName = "";
    try {
      const companyRes = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`,
        {
          headers: {
            "Authorization": `Bearer ${tokens.access_token}`,
            "Accept": "application/json",
          },
        }
      );
      if (companyRes.ok) {
        const companyData = await companyRes.json();
        companyName = companyData.CompanyInfo?.CompanyName || "";
      }
    } catch {
      // Non-critical — we'll just miss the company name
    }

    // Store tokens securely in app_state
    const qbTokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      realm_id: realmId,
      company_name: companyName,
      expires_in: tokens.expires_in,          // ~3600 (1 hour)
      x_refresh_token_expires_in: tokens.x_refresh_token_expires_in, // ~8726400 (100 days)
      token_created_at: new Date().toISOString(),
    };

    // Upsert into app_state table
    const { error: dbErr } = await supabase
      .from("app_state")
      .upsert(
        { key: "qb_tokens", value: qbTokens },
        { onConflict: "key" }
      );

    if (dbErr) {
      const redirectUrl = `${PORTAL_URL}?qb_error=${encodeURIComponent("Failed to save tokens: " + dbErr.message)}`;
      return Response.redirect(redirectUrl, 302);
    }

    // Redirect back to the portal with success
    const redirectUrl = `${PORTAL_URL}?qb_connected=true&qb_company=${encodeURIComponent(companyName)}&qb_realm=${realmId}`;
    return Response.redirect(redirectUrl, 302);

  } catch (err) {
    const redirectUrl = `${PORTAL_URL}?qb_error=${encodeURIComponent(String(err))}`;
    return Response.redirect(redirectUrl, 302);
  }
});
