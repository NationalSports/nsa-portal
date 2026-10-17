// RETIRED 2026-10-17 (accounting audit, security leftovers).
// This Edge Function was a helper that returned a raw QuickBooks access token to any caller, with no JWT check.
// The portal's QuickBooks OAuth flow and token storage live in the Netlify functions
// (/.netlify/functions/qb-auth, qb-api, _qb.js); nothing calls this one. Deployed this same day
// as a 410 stub with verify_jwt=true. It reads no secrets. The pre-retirement source is in the
// git history of this file.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(
  JSON.stringify({ ok: false, error: "qb-refresh-token (Supabase) was retired on 2026-10-17. QuickBooks tokens are held server-side by the portal's Netlify functions." }),
  { status: 410, headers: { "Content-Type": "application/json" } },
));
