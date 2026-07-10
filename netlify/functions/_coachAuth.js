// Shared coach authentication helpers for coach-facing endpoints (underscore
// prefix = internal module, not an endpoint — same convention as _shared.js).
// Extracted verbatim from quickorder-quote.js so future coach endpoints (e.g.
// order placement) share one auth implementation instead of a hand-synced copy.

// Resolve the bearer token to an active coach account. Returns { coach } or { status, error }.
async function verifyCoach(admin, event) {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) return { status: 401, error: 'Missing bearer token' };
  const { data: userData, error } = await admin.auth.getUser(auth.substring(7));
  if (error || !userData?.user) return { status: 401, error: 'Invalid token' };
  const u = userData.user;
  let { data: coach, error: cErr } = await admin.from('coach_accounts')
    .select('id,email,name,status,customer_id,auth_user_id')
    .eq('auth_user_id', u.id).maybeSingle();
  if (cErr) return { status: 500, error: cErr.message };
  if (!coach && u.email) {
    // Not claimed yet — match by the signed-in email (same rule as the coach RLS policies).
    const res = await admin.from('coach_accounts')
      .select('id,email,name,status,customer_id,auth_user_id')
      .ilike('email', String(u.email).replace(/([%_\\])/g, '\\$1')).maybeSingle();
    if (res.error) return { status: 500, error: res.error.message };
    coach = res.data;
  }
  if (!coach) return { status: 403, error: 'No coach account for this sign-in' };
  if (coach.status && coach.status !== 'active' && coach.status !== 'invited') return { status: 403, error: 'Coach account is disabled' };
  return { coach };
}

// May this coach act for customerId? coach_customer_access is the source of truth;
// the account's own customer_id is the legacy single-customer link.
async function coachHasCustomerAccess(admin, coach, customerId) {
  if (coach.customer_id && String(coach.customer_id) === String(customerId)) return { ok: true };
  const { data, error } = await admin.from('coach_customer_access')
    .select('customer_id').eq('coach_id', coach.id).eq('customer_id', customerId).maybeSingle();
  if (error) return { error: error.message };
  return { ok: !!data };
}

module.exports = { verifyCoach, coachHasCustomerAccess };
