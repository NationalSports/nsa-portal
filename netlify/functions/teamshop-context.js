// Coach-facing Team Shop context — resolves a signed-in coach's own profile
// plus every customer (team) they may act for, so the Team Shop storefront
// (src/teamshop/TeamPicker.js) knows what to show after sign-in.
//
// POST (empty body)
//   Authorization: Bearer <coach Supabase session JWT>
//
// Auth mirrors netlify/functions/quickorder-quote.js exactly: verifyCoach
// resolves the bearer token to an active coach_accounts row (./_coachAuth,
// shared with every coach-facing endpoint). Read-only — this function never
// writes anything.
//
// Customers this coach can act for = the union of:
//   - coach_customer_access rows for this coach (the source of truth for
//     multi-customer access, see coach-invite.js), and
//   - the coach_accounts row's own (legacy single-customer) customer_id.
// Each candidate id is re-checked with coachHasCustomerAccess (the same
// helper quickorder-quote.js gates a quote on) rather than trusted at face
// value, so this endpoint can never list a customer the shared auth helper
// wouldn't also authorize a quote for.
const { corsHeaders, getSupabaseAdmin } = require('./_shared');
const { verifyCoach, coachHasCustomerAccess } = require('./_coachAuth');

const bad = (status, error) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error }) });

// Candidate customer ids for this coach (own customer_id + every
// coach_customer_access row), deduplicated. Returns { ids } or { error }.
async function candidateCustomerIds(admin, coach) {
  const ids = new Set();
  if (coach.customer_id) ids.add(String(coach.customer_id));
  const { data, error } = await admin.from('coach_customer_access').select('customer_id').eq('coach_id', coach.id);
  if (error) return { error: error.message };
  (data || []).forEach((r) => { if (r && r.customer_id) ids.add(String(r.customer_id)); });
  return { ids: [...ids] };
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');
  try {
    let admin;
    try { admin = getSupabaseAdmin(); } catch (e) { return bad(500, 'Service not configured'); }

    const v = await verifyCoach(admin, event);
    if (!v.coach) return bad(v.status, v.error);
    const coach = v.coach;

    const idsRes = await candidateCustomerIds(admin, coach);
    if (idsRes.error) return bad(500, idsRes.error);

    // Defense-in-depth: re-verify each candidate through the same helper
    // quickorder-quote.js gates a quote on, rather than trusting the union above.
    const checked = await Promise.all(idsRes.ids.map(async (id) => {
      const acc = await coachHasCustomerAccess(admin, coach, id);
      return acc.error ? { id, error: acc.error } : { id, ok: acc.ok };
    }));
    const err = checked.find((c) => c.error);
    if (err) return bad(500, err.error);
    const allowedIds = checked.filter((c) => c.ok).map((c) => c.id);

    let customers = [];
    if (allowedIds.length) {
      const { data, error } = await admin.from('customers').select('id,name').in('id', allowedIds);
      if (error) return bad(500, error.message);
      customers = (data || []).map((c) => ({ id: c.id, name: c.name || '' }));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        coach: { id: coach.id, email: coach.email, name: coach.name || '' },
        customers,
      }),
    };
  } catch (e) {
    return bad(500, e.message);
  }
};

// Exported for tests (src/__tests__/teamshopContext.test.js) — same pattern as quickorder-quote.
module.exports.verifyCoach = verifyCoach;
module.exports.coachHasCustomerAccess = coachHasCustomerAccess;
module.exports.candidateCustomerIds = candidateCustomerIds;
