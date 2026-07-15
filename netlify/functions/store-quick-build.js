// Quick Build — staff "one click, whole store" engine. Given a template store + a
// customer (existing or new) + branding, this clones the template into a real draft (or
// live) store server-side, links a coach_leads row if the build came from the lead funnel,
// and optionally invites the coach. It is the server side of the admin Quick Build modal
// (built separately) and is meant to replace the manual "duplicate template → set customer
// → set colors → invite" click-path with one request.
//
// Clone recipe mirrors src/Webstores.js duplicateStore's template-start path (products +
// bundle items, row-at-a-time so a single bad row becomes a warning, not a failed build) —
// see that function's comments for why transfers are never copied and why bundle
// webstore_product_id remaps through an id map. Slug + alpha_tag uniqueness loops mirror
// supabase/functions/coach-store-submit/index.ts.
//
// This function never sends the launch/congrats email — that stays client-side via the
// existing notifyCoachPublished, fired from the publishing UI once staff review the store.
//
// Idempotency: a lead can only be built once. If lead_id already has a webstore_id, this
// returns the existing store instead of cloning again (a retried click, or two staff members
// racing the same lead, must not mint two stores).
const { verifyUser, getSupabaseAdmin } = require('./_shared');

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'team-store';
}

// Unique slug against webstores.slug — same probe-then-suffix loop as coach-store-submit.
async function uniqueSlug(admin, name) {
  const base = slugify(name);
  let slug = base;
  for (let n = 2; ; n++) {
    const { data: ex } = await admin.from('webstores').select('id').eq('slug', slug).maybeSingle();
    if (!ex) return slug;
    slug = `${base}-${n}`;
    if (n > 50) return `${base}-${Date.now().toString(36)}`;
  }
}

// Base for an alpha_tag: first two "words" of the name, alnum only, upper, ≤12 chars.
// Alnum+space only — safe to embed in an ilike pattern without escaping.
function alphaTagBase(name) {
  return String(name || '').replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/).slice(0, 2).join(' ').toUpperCase().slice(0, 12);
}

// Generate an alpha_tag from a customer name, suffixing " 2", " 3"... against a
// case-insensitive-trimmed collision set until unique. alpha_tag has no DB unique
// constraint — uniqueness is app-level only.
function nextAlphaTag(name, existingTags) {
  const base = alphaTagBase(name);
  const taken = new Set((existingTags || []).map((t) => String(t || '').trim().toLowerCase()));
  if (base && !taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = ' ' + n;
    const candidate = (base.slice(0, Math.max(0, 12 - suffix.length)) + suffix).trim();
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base || 'TEAM'; // pathological fallback, should be unreachable
}

// Build the new webstores insert row from a template row + request input. Pure/exported
// for testing — branding fields fall back to the template's own values, per the spec.
function buildStoreRow(tplRow, input) {
  const { id, created_at, updated_at, ...rest } = tplRow || {};
  const publish = !!input.publish;
  return {
    ...rest,
    name: input.store_name,
    slug: input.slug,
    status: publish ? 'open' : 'draft',
    open_at: publish ? new Date().toISOString() : null,
    close_at: null,
    is_template: false,
    featured_product_ids: null,
    closed_notified_at: null,
    customer_id: input.customer_id,
    created_via: 'auto',
    sport: input.sport || rest.sport || null,
    logo_url: input.logo_url || rest.logo_url || null,
    primary_color: input.primary_color || rest.primary_color || null,
    accent_color: input.accent_color || rest.accent_color || null,
    coach_contact_name: input.coach_name || null,
    coach_contact_email: input.coach_email || null,
    coach_contact_phone: input.coach_phone || null,
  };
}

// Copy webstore_products row-at-a-time (so one bad row becomes a warning, not an abort),
// returning the old->new id map plus any per-row warnings.
async function cloneProducts(admin, templateId, newStoreId) {
  const { data: srcProducts, error } = await admin
    .from('webstore_products').select('*').eq('store_id', templateId).order('sort_order');
  if (error) return { idMap: {}, srcProducts: [], warnings: [`Reading template items failed: ${error.message}`] };

  const idMap = {};
  const warnings = [];
  for (const p of (srcProducts || [])) {
    const { id: pid, created_at, updated_at, store_id, ...rest } = p;
    const { data: np, error: insErr } = await admin
      .from('webstore_products').insert({ ...rest, store_id: newStoreId }).select('id').single();
    if (insErr) { warnings.push(`Item "${p.display_name || p.sku || pid}" failed to copy: ${insErr.message}`); continue; }
    idMap[pid] = np.id;
  }
  return { idMap, srcProducts: srcProducts || [], warnings };
}

// Copy webstore_bundle_items for bundle products, remapping bundle_id + webstore_product_id
// through idMap. A bundle whose own row failed to copy is skipped entirely (no bundle_id to
// remap to); a component whose linked single failed to copy gets webstore_product_id: null.
async function cloneBundleItems(admin, srcProducts, idMap) {
  const bundleIds = srcProducts.filter((p) => p.kind === 'bundle').map((p) => p.id);
  if (!bundleIds.length) return { warnings: [] };
  const { data: items, error } = await admin.from('webstore_bundle_items').select('*').in('bundle_id', bundleIds);
  if (error) return { warnings: [`Reading template bundle items failed: ${error.message}`] };

  const rows = (items || [])
    .map((it) => {
      const { id, created_at, updated_at, bundle_id, webstore_product_id, ...rest } = it;
      return { ...rest, bundle_id: idMap[bundle_id], webstore_product_id: idMap[webstore_product_id] || null };
    })
    .filter((r) => r.bundle_id);
  if (!rows.length) return { warnings: [] };
  const { error: insErr } = await admin.from('webstore_bundle_items').insert(rows);
  if (insErr) return { warnings: [`Bundle items copy failed: ${insErr.message}`] };
  return { warnings: [] };
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };

  const auth = await verifyUser(event);
  if (!auth.ok) return { statusCode: auth.status || 401, headers, body: JSON.stringify({ ok: false, error: auth.error || 'Not authorized' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const templateStoreId = str(body.template_store_id);
  const storeName = str(body.store_name);
  const customerId = body.customer_id != null ? str(body.customer_id) : '';
  const newCustomer = body.new_customer && typeof body.new_customer === 'object' ? body.new_customer : null;
  const newCustomerName = newCustomer ? str(newCustomer.name) : '';
  const leadId = body.lead_id != null ? str(body.lead_id) : '';
  const publish = !!body.publish;
  const inviteCoach = !!body.invite_coach;
  const coachName = body.coach_name != null ? str(body.coach_name) : '';
  const coachEmail = body.coach_email != null ? str(body.coach_email) : '';
  const coachPhone = body.coach_phone != null ? str(body.coach_phone) : '';
  const sport = body.sport != null ? str(body.sport) : '';
  const logoUrl = body.logo_url != null ? str(body.logo_url) : '';
  const primaryColor = body.primary_color != null ? str(body.primary_color) : '';
  const accentColor = body.accent_color != null ? str(body.accent_color) : '';

  if (!templateStoreId) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'template_store_id is required' }) };
  if (!storeName) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'store_name is required' }) };
  const hasCustomerId = !!customerId;
  const hasNewCustomer = !!newCustomer;
  if (hasCustomerId === hasNewCustomer) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Provide exactly one of customer_id or new_customer' }) };
  if (hasNewCustomer && !newCustomerName) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'new_customer.name is required' }) };

  const admin = getSupabaseAdmin();

  try {
    // Lead idempotency first — a lead already built must return the existing store, never
    // clone a second time (retried click / two staff racing the same lead).
    let lead = null;
    if (leadId) {
      const { data: leadRow, error: leadErr } = await admin.from('coach_leads').select('*').eq('id', leadId).maybeSingle();
      if (leadErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: leadErr.message }) };
      lead = leadRow || null;
      if (lead && lead.webstore_id) {
        const { data: existingStore, error: sErr } = await admin.from('webstores').select('id,slug,name,status').eq('id', lead.webstore_id).maybeSingle();
        if (sErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: sErr.message }) };
        console.log(`[store-quick-build] lead ${leadId} already built -> store ${lead.webstore_id}`);
        return {
          statusCode: 200, headers, body: JSON.stringify({
            ok: true, already_built: true, store: existingStore || null, customer_id: lead.customer_id,
            created_customer: false, invited: false, lead_updated: false, warnings: [],
          }),
        };
      }
    }

    // Resolve template.
    const { data: tpl, error: tplErr } = await admin.from('webstores').select('*').eq('id', templateStoreId).maybeSingle();
    if (tplErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: tplErr.message }) };
    if (!tpl || tpl.is_template !== true) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'template_store_id is not a known template store' }) };

    const warnings = [];
    let createdCustomer = false;
    let resolvedCustomerId = customerId;

    if (hasCustomerId) {
      const { data: cust, error: custErr } = await admin.from('customers').select('id').eq('id', customerId).maybeSingle();
      if (custErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: custErr.message }) };
      if (!cust) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'customer_id not found' }) };
    } else {
      // New customer: generate a unique alpha_tag, then apply lead colors/logo if present.
      // Collision set is prefix-filtered — an unbounded select silently caps at the API's
      // default row limit (1000), which would blind the uniqueness check on a big customer
      // table. Every collision candidate (base or trimmed-base + " n") shares the base's
      // first 8 chars, and the base is alnum+space only, so the ilike pattern needs no escaping.
      const tagBase = alphaTagBase(newCustomerName);
      let tagQuery = admin.from('customers').select('alpha_tag');
      if (tagBase) tagQuery = tagQuery.ilike('alpha_tag', tagBase.slice(0, 8) + '%');
      const { data: existing, error: tagErr } = await tagQuery;
      if (tagErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: tagErr.message }) };
      const alphaTag = nextAlphaTag(newCustomerName, (existing || []).map((r) => r.alpha_tag));

      const newId = 'c' + Date.now();
      const nowIso = new Date().toISOString();
      const customerRow = {
        id: newId,
        name: newCustomerName,
        alpha_tag: alphaTag,
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso,
        primary_rep_id: auth.teamMemberId || null,
        logo_url: logoUrl || null,
      };
      if (Array.isArray(lead?.colors) && lead.colors.length) customerRow.school_colors = lead.colors;

      const { data: newCust, error: insErr } = await admin.from('customers').insert(customerRow).select('id').single();
      if (insErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: `Could not create customer: ${insErr.message}` }) };
      resolvedCustomerId = newCust.id;
      createdCustomer = true;
    }

    // Clone the template into a real store.
    const slug = await uniqueSlug(admin, storeName);
    const storeRow = buildStoreRow(tpl, {
      store_name: storeName, slug, publish, sport, customer_id: resolvedCustomerId,
      logo_url: logoUrl, primary_color: primaryColor, accent_color: accentColor,
      coach_name: coachName, coach_email: coachEmail, coach_phone: coachPhone,
    });
    const { data: newStore, error: storeErr } = await admin.from('webstores').insert(storeRow).select('id,slug,name,status').single();
    if (storeErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: `Could not create store: ${storeErr.message}` }) };

    const { idMap, srcProducts, warnings: productWarnings } = await cloneProducts(admin, templateStoreId, newStore.id);
    warnings.push(...productWarnings);
    if (!srcProducts.length) warnings.push('Template has no items — the store was created empty.');
    const { warnings: bundleWarnings } = await cloneBundleItems(admin, srcProducts, idMap);
    warnings.push(...bundleWarnings);

    // Link the lead (best-effort — a failure here must not fail the build; the store exists).
    let leadUpdated = false;
    if (leadId) {
      const { error: leadUpdErr } = await admin.from('coach_leads')
        .update({ customer_id: resolvedCustomerId, webstore_id: newStore.id, status: 'store_built' })
        .eq('id', leadId);
      if (leadUpdErr) warnings.push(`Lead update failed: ${leadUpdErr.message}`);
      else leadUpdated = true;
    }

    // Coach invite (conditional, best-effort — reuses coach-invite.js rather than duplicating
    // its magic-link logic; forwards the caller's own auth so it authorizes the same way).
    let invited = false;
    if (inviteCoach && coachEmail) {
      try {
        const resp = await fetch((process.env.URL || '') + '/.netlify/functions/coach-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: event.headers.authorization || event.headers.Authorization },
          body: JSON.stringify({ email: coachEmail, name: coachName, customer_id: resolvedCustomerId }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.ok !== false) invited = true;
        else warnings.push(`Coach invite failed: ${data.error || resp.status}`);
      } catch (e) {
        warnings.push(`Coach invite failed: ${e.message}`);
      }
    }

    console.log(`[store-quick-build] built store ${newStore.id} (${newStore.slug}) from template ${templateStoreId}, customer=${resolvedCustomerId}, created_customer=${createdCustomer}, invited=${invited}, warnings=${warnings.length}`);
    return {
      statusCode: 200, headers, body: JSON.stringify({
        ok: true, already_built: false, store: newStore, customer_id: resolvedCustomerId,
        created_customer: createdCustomer, invited, lead_updated: leadUpdated, warnings,
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message || 'Server error' }) };
  }
};

// Exposed for tests (mirrors coach-leads-sheet-sync.js's _internals pattern).
exports._internals = { slugify, nextAlphaTag, buildStoreRow };
