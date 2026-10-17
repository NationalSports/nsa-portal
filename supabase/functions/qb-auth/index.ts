// RETIRED 2026-10-17 (accounting audit, security leftovers).
// This Edge Function was an early QuickBooks OAuth helper deployed without JWT verification.
// The portal's QuickBooks OAuth flow and token storage live in the Netlify functions
// (/.netlify/functions/qb-auth, qb-api, _qb.js); nothing calls this one. Deployed this same day
// as a 410 stub with verify_jwt=true. It reads no secrets. The pre-retirement source is in the
// git history of this file.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(
  JSON.stringify({ ok: false, error: "qb-auth (Supabase) was retired on 2026-10-17. QuickBooks OAuth is handled by the portal's Netlify qb-auth function." }),
  { status: 410, headers: { "Content-Type": "application/json" } },
));
