// supabase/functions/_shared/auth.ts
// ─────────────────────────────────────────────────────────
// Shared caller-authorization for edge functions that were previously open
// (any holder of the public anon key could invoke them). One implementation so
// the rule can't drift between functions.
//
// Two accepted callers:
//   • Service role — server-to-server / pg_cron, which sends the service_role
//     key as the bearer token (see the taxcloud cron migrations 00011/00075/00094).
//   • Authenticated staff — a browser session JWT whose user is an active row in
//     public.team_members. This mirrors the SQL public.is_team_member() used by
//     RLS (migration 00173: team_members.auth_id = auth.uid() AND is_active).
//     auth.uid() is null under the service client, so we can't call that RPC
//     here — we resolve the same predicate explicitly. Keep the two in sync.
// ─────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

export interface AuthResult {
  ok: boolean;
  status?: number;        // HTTP status to return when !ok
  error?: string;         // client-safe message when !ok
  userId?: string | null; // the staff user's id (null for the service path)
  via?: "service" | "staff";
}

export function bearerToken(req: Request): string {
  return (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

// True when the presented bearer token is exactly the project service-role key —
// the credential pg_cron and other trusted server callers send. Never exposed to
// the browser, so a match means the caller is trusted infrastructure.
export function isServiceRole(token: string): boolean {
  return !!SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY;
}

// Authorize a caller as service-role OR active staff. Returns {ok:true} to proceed,
// or {ok:false,status,error} to return verbatim. Fails closed on any config/lookup
// problem — a function guarded by this never runs for an unauthenticated caller.
export async function requireStaffOrService(req: Request): Promise<AuthResult> {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: "Missing Authorization bearer token." };

  if (isServiceRole(token)) return { ok: true, via: "service", userId: null };

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return { ok: false, status: 500, error: "Server auth is not configured." };
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // getUser validates the JWT signature + expiry server-side. A bare anon key is a
  // valid JWT but carries no user, so it resolves to null here and is rejected.
  let userId: string;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user?.id) return { ok: false, status: 401, error: "Invalid or expired session." };
    userId = data.user.id;
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }

  // Same predicate as public.is_team_member() (migration 00173) — keep in sync.
  const { data: rows, error: tmErr } = await admin
    .from("team_members").select("auth_id,is_active").eq("auth_id", userId).limit(1);
  if (tmErr) return { ok: false, status: 500, error: "Could not verify staff access." };
  const isStaff = (rows || []).some((r) => r.is_active !== false);
  if (!isStaff) return { ok: false, status: 403, error: "Staff access required." };

  return { ok: true, via: "staff", userId };
}
