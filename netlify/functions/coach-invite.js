// Netlify function: emails a coach their catalog invite when staff OR another
// coach invite them in the portal. Sends via Brevo; the coach clicks through to
// /adidas and signs in with the magic link (their email is pre-filled).
//
// When a team_id is supplied (roster-order invites), this also provisions the
// coach_accounts row and the roster_team_coaches assignment using the service
// role — that path bypasses RLS so a signed-in coach can invite a teammate even
// though coach_accounts INSERT is otherwise staff-only.
const { verifyUser, resolveCustomerFamily, rosterTeamCustomerId, getSupabaseAdmin: _getSupabaseAdmin } = require('./_shared');
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Shared factory throws when creds are missing; this endpoint's callers expect null.
function getSupabaseAdmin() {
  try { return _getSupabaseAdmin(); } catch { return null; }
}

// Ensure a coach_accounts row exists for `email`, then assign them to the team.
// Returns { coach_id } or { error }. No-op-safe if service creds are absent.
async function provisionRosterCoach({ email, name, customerId, teamId, role }) {
  const admin = getSupabaseAdmin();
  if (!admin) return { error: 'service-creds-missing' };
  const lower = email.toLowerCase();
  let coachId;
  const { data: existing } = await admin.from('coach_accounts').select('id').ilike('email', lower).maybeSingle();
  if (existing?.id) {
    coachId = existing.id;
  } else {
    const { data: created, error: ce } = await admin.from('coach_accounts')
      .insert({ email, name: name || email, customer_id: customerId || null, status: 'invited' })
      .select('id').single();
    if (ce) return { error: ce.message };
    coachId = created?.id;
  }
  // Grant account-level access (many-to-many; a coach can belong to several
  // clubs). This is what makes "Add coach" stick even when the email already
  // exists under another customer — coach_accounts.customer_id is single-valued
  // and may point elsewhere, so access lives in coach_customer_access.
  if (coachId && customerId) {
    await admin.from('coach_customer_access')
      .upsert({ coach_id: coachId, customer_id: customerId, role: role || 'editor' }, { onConflict: 'coach_id,customer_id' });
  }
  if (coachId && teamId) {
    await admin.from('roster_team_coaches')
      .upsert({ team_id: teamId, coach_id: coachId, role: role || 'editor' }, { onConflict: 'team_id,coach_id' });
  }
  return { coach_id: coachId };
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const email = String(body.email || '').trim();
    const name = String(body.name || '').trim();
    const team = String(body.team || '').trim();
    const teamId = String(body.team_id || '').trim();
    const customerId = String(body.customer_id || '').trim();
    const role = String(body.role || 'editor').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Valid email required' }) };
    }

    // Authorization (audit #3 + #11): this endpoint provisions coach_accounts +
    // coach_customer_access + roster_team_coaches with the service role, so it must never
    // be callable anonymously, and a coach-portal caller must not reach OUTSIDE its own
    // club family. Accept EITHER:
    //   (a) a signed-in staff member (Bearer JWT) — staff can already write these tables
    //       directly under RLS, so their scope is unrestricted (unchanged behavior); OR
    //   (b) a coach-portal caller presenting an alpha_tag. That path is scoped to the
    //       tag's customer family (parent + sub-customers, via the shared resolver — the
    //       old inline check was parents-only and silently rejected sub-customer invites):
    //       BOTH the target customer_id AND the target team_id (if any) must resolve into
    //       that family. Validating team_id is the fix for the hole where a caller with
    //       their own valid tag could pass another club's team_id and get provisioned as
    //       an editor on it — latent only while roster_team_coaches still allows direct
    //       anon writes (migration 00176 closes that and makes this the live path).
    let authed = false;
    let scopeFam = null; // null = staff (unrestricted); a Set = coach-portal family bound
    try { const v = await verifyUser(event); if (v && v.ok) authed = true; } catch (_) {}
    if (!authed) {
      const alphaTag = String(body.alpha_tag || '').trim();
      if (alphaTag && customerId) {
        const adminAuth = getSupabaseAdmin();
        if (adminAuth) {
          const famRes = await resolveCustomerFamily(adminAuth, alphaTag);
          if (famRes.error && !famRes.notFound) {
            return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: famRes.error }) };
          }
          if (famRes.fam && famRes.fam.has(customerId)) { authed = true; scopeFam = famRes.fam; }
        }
      }
    }
    if (!authed) {
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'Not authorized' }) };
    }

    // Coach-portal callers may only assign to a team owned by a customer in their family.
    // (Staff — scopeFam null — are unrestricted, matching their direct-RLS write ability.)
    if (scopeFam && teamId) {
      const adminChk = getSupabaseAdmin();
      const owned = adminChk ? await rosterTeamCustomerId(adminChk, teamId) : { error: 'service-creds-missing' };
      if (owned.error) {
        return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: owned.error }) };
      }
      if (!owned.customerId || !scopeFam.has(owned.customerId)) {
        return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'Not authorized for this team' }) };
      }
    }

    // Roster-order invites: provision the coach account (+ team assignment when a
    // team is given) server-side. A customer_id with no team_id just grants the
    // coach access to that account so they can self-serve (bootstrap the lead coach).
    let coachId = null;
    if (teamId || customerId) {
      const prov = await provisionRosterCoach({ email, name, customerId, teamId, role });
      if (prov.error && prov.error !== 'service-creds-missing') {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: prov.error }) };
      }
      coachId = prov.coach_id || null;
    }

    const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
    if (!brevoKey) return { statusCode: 200, headers, body: JSON.stringify({ ok: !!coachId, coach_id: coachId, emailed: false, error: 'Email not configured' }) };

    // Look up the customer's alpha_tag so we can link to the coach portal
    // (?portal=<tag>) rather than the generic LiveLook catalog. The portal link
    // is the gate — no sign-in needed. Falls back to /adidas if the customer
    // can't be found (e.g. no customer_id supplied).
    const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');
    let link = `${portal}/adidas?signin=${encodeURIComponent(email)}`;
    if (customerId) {
      const admin = getSupabaseAdmin();
      if (admin) {
        const { data: cust } = await admin.from('customers').select('alpha_tag').eq('id', customerId).maybeSingle();
        if (cust?.alpha_tag) link = `${portal}/?portal=${encodeURIComponent(cust.alpha_tag)}`;
      }
    }
    const hello = name ? `Hi ${esc(name.split(' ')[0])},` : 'Hi Coach,';

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email, name: name || email }],
        subject: 'Your National Sports Apparel team portal access',
        htmlContent: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto">
            <div style="background:#191919;color:white;padding:20px 22px;border-radius:8px 8px 0 0">
              <h2 style="margin:0;font-size:18px">Your NSA team portal is ready</h2>
            </div>
            <div style="background:white;padding:22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
              <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 14px">
                ${hello}
              </p>
              <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 16px">
                National Sports Apparel set up your team portal${team ? ` for <strong>${esc(team)}</strong>` : ''}.
                Fill out roster sizes, view your orders &amp; invoices, and browse the live catalog — all in one place.
              </p>
              <a href="${esc(link)}" style="display:inline-block;background:#191919;color:#fff;border-radius:8px;padding:12px 26px;font-weight:700;text-decoration:none;font-size:15px">Open my team portal</a>
              <p style="font-size:12.5px;color:#64748b;line-height:1.6;margin:18px 0 0">
                Just tap the button — no password to remember. Bookmark the page so you can jump back in anytime.
              </p>
              <p style="font-size:11.5px;color:#94a3b8;margin-top:16px">Questions? Just reply to this email and your rep will help.</p>
            </div>
          </div>`,
      }),
    });
    if (!res.ok) {
      console.error('[coach-invite] Brevo error:', res.status, await res.text());
      return { statusCode: 200, headers, body: JSON.stringify({ ok: !!coachId, coach_id: coachId, emailed: false, error: 'Send failed' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, coach_id: coachId, emailed: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
