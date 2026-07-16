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
// Build order (safety-review hardening, 2026-07): resolve/create customer -> insert the
// store as status:'draft' ALWAYS -> clone products + bundle items -> sanity-check the
// clone -> only THEN, if publish was requested and the checks pass, flip the store live
// with a second update. This closes two failure modes a single-insert "maybe live"
// version had: a $0-priced template going live in one click, and a store that died
// mid-clone still ending up live with half its items.
//
// Idempotency: a lead can only be built once. If lead_id already has a webstore_id, this
// returns the existing replay response as before. Beyond that, the lead is CLAIMED
// (status -> 'building') before any work starts, so two staff racing the same lead (or a
// retried click) can't both clone it — the loser gets a 409. If the build doesn't reach a
// created store (guard trip, validation failure, thrown error), the claim is released
// back to the lead's prior status on the way out.
const { verifyUser, getSupabaseAdmin } = require('./_shared');

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'team-store';
}

// Escape ilike wildcards (and the escape char itself) so a literal string can be matched
// case-insensitively via ilike with no unintended wildcarding — same approach as
// resolveCustomerFamily in _shared.js.
function escapeIlike(s) {
  return String(s || '').replace(/([%_\\])/g, '\\$1');
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
// ALWAYS a draft: status/open_at never depend on whether publish was requested. The
// handler makes a second, sanity-checked update to flip a store live (see sanityCheckClone
// + the handler's publish step) — a template row here is never a shortcut back to 'open'.
function buildStoreRow(tplRow, input) {
  const { id, created_at, updated_at, ...rest } = tplRow || {};
  return {
    ...rest,
    name: input.store_name,
    slug: input.slug,
    status: 'draft',
    open_at: null,
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
    // Quick Build's coach IS the store's director/family contact in this flow. The launch
    // email (launchEmailHtml / notifyCoachPublished + emailDirector in src/Webstores.js)
    // addresses the recipient by director_name and falls back to director_email/phone —
    // leaving these blank made every auto-built store's launch email greet nobody.
    director_name: input.coach_name || null,
    director_email: input.coach_email || null,
    director_phone: input.coach_phone || null,
  };
}

// Copy webstore_products row-at-a-time (so one bad row becomes a warning, not an abort),
// returning the old->new id map, per-row warnings, and the rows that actually landed
// (id + retail_price + a label), tracked here rather than re-queried after the fact so the
// pre-publish sanity check below has no extra round trip.
async function cloneProducts(admin, templateId, newStoreId) {
  const { data: srcProducts, error } = await admin
    .from('webstore_products').select('*').eq('store_id', templateId).order('sort_order');
  if (error) return { idMap: {}, srcProducts: [], clonedRows: [], warnings: [`Reading template items failed: ${error.message}`] };

  const idMap = {};
  const clonedRows = [];
  const warnings = [];
  for (const p of (srcProducts || [])) {
    const { id: pid, created_at, updated_at, store_id, ...rest } = p;
    const { data: np, error: insErr } = await admin
      .from('webstore_products').insert({ ...rest, store_id: newStoreId }).select('id').single();
    if (insErr) { warnings.push(`Item "${p.display_name || p.sku || pid}" failed to copy: ${insErr.message}`); continue; }
    idMap[pid] = np.id;
    clonedRows.push({ id: np.id, retail_price: p.retail_price, label: p.display_name || p.sku || pid });
  }
  return { idMap, srcProducts: srcProducts || [], clonedRows, warnings };
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

// Pre-flip-live gate: a build may only go straight to 'open' if at least one product
// actually cloned AND none of the cloned products has a non-positive retail price. Runs
// against the rows that actually landed (cloneProducts' clonedRows), not the template's
// source count, so a clone that dies partway through is judged on what really landed in
// the new store. Pure/exported for testing.
function sanityCheckClone(clonedRows) {
  const rows = clonedRows || [];
  if (!rows.length) return { ok: false, reason: 'No products were cloned into the store' };
  const zero = rows.find((r) => !(Number(r.retail_price) > 0));
  if (zero) return { ok: false, reason: `Item "${zero.label}" has a retail price of $0` };
  return { ok: true };
}

// Throw-able "respond with this HTTP response" — lets deeply-nested validation/DB-error
// branches bail out through one catch block, which is also the one place that releases a
// claimed lead (see the handler). statusCode 200 is valid here (the duplicate-store guard
// responds 200 with ok:false so the UI can offer an override instead of treating it as a
// hard failure).
function abort(statusCode, body) {
  const e = new Error((body && body.error) || 'error');
  e.statusCode = statusCode;
  e.body = body;
  return e;
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
  const duplicateOk = body.duplicate_ok === true;
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

  // Tracked across the whole try block so the single catch below can release a claimed
  // lead on any exit that didn't reach a created store.
  let leadClaimed = false;
  let priorLeadStatus = null;
  let storeCreated = false;

  try {
    // Lead idempotency + claim ------------------------------------------------------
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

      // Claim: atomically flip status -> 'building' so two staff (or a retried click)
      // racing the same lead can't both clone it. A row only comes back if this call won
      // the race — no row means someone else is already mid-build (or stuck there).
      priorLeadStatus = lead ? lead.status : null;
      const { data: claimedRows, error: claimErr } = await admin.from('coach_leads')
        .update({ status: 'building' })
        .eq('id', leadId)
        .is('webstore_id', null)
        .neq('status', 'building')
        .select('id');
      if (claimErr) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: claimErr.message }) };
      if (!claimedRows || !claimedRows.length) {
        return { statusCode: 409, headers, body: JSON.stringify({ ok: false, error: 'This lead is already being built by someone else' }) };
      }
      leadClaimed = true;
    }

    // Resolve template ---------------------------------------------------------------
    const { data: tpl, error: tplErr } = await admin.from('webstores').select('*').eq('id', templateStoreId).maybeSingle();
    if (tplErr) throw abort(500, { ok: false, error: tplErr.message });
    if (!tpl || tpl.is_template !== true) throw abort(400, { ok: false, error: 'template_store_id is not a known template store' });

    const warnings = [];
    let createdCustomer = false;
    let resolvedCustomerId = customerId;

    // Resolve/create customer ---------------------------------------------------------
    if (hasCustomerId) {
      const { data: cust, error: custErr } = await admin.from('customers').select('id').eq('id', customerId).maybeSingle();
      if (custErr) throw abort(500, { ok: false, error: custErr.message });
      if (!cust) throw abort(400, { ok: false, error: 'customer_id not found' });
    } else {
      // Existing-customer guard: two staff members typing the same school name must land
      // on the same customer row, not two duplicates. Trim/case-insensitive EXACT match
      // (escaped ilike, no wildcards) — not a substring search.
      const { data: matchRows, error: matchErr } = await admin.from('customers')
        .select('id,name').ilike('name', escapeIlike(newCustomerName)).limit(1);
      if (matchErr) throw abort(500, { ok: false, error: matchErr.message });

      if (matchRows && matchRows.length) {
        resolvedCustomerId = matchRows[0].id;
        warnings.push(`Matched existing customer ${matchRows[0].name}`);
      } else {
        // New customer: generate a unique alpha_tag, then apply lead colors/logo if
        // present. Collision set is prefix-filtered — an unbounded select silently caps at
        // the API's default row limit (1000), which would blind the uniqueness check on a
        // big customer table. When the name yields no usable base (symbols-only, etc.)
        // fall back to 'TEAM' rather than skipping the filter — an unfiltered select is
        // exactly the blind-uniqueness-check case this guards against.
        const tagBase = alphaTagBase(newCustomerName);
        const effectiveBase = tagBase || 'TEAM';
        const { data: existingTags, error: tagErr } = await admin.from('customers').select('alpha_tag')
          .ilike('alpha_tag', effectiveBase.slice(0, 8) + '%');
        if (tagErr) throw abort(500, { ok: false, error: tagErr.message });
        const alphaTag = nextAlphaTag(effectiveBase, (existingTags || []).map((r) => r.alpha_tag));

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
        if (insErr) throw abort(500, { ok: false, error: `Could not create customer: ${insErr.message}` });
        resolvedCustomerId = newCust.id;
        createdCustomer = true;
      }
    }

    // Customer+sport duplicate guard ---------------------------------------------------
    // Skipped when no sport was given (nothing meaningful to compare) or the caller
    // already confirmed they want another one.
    if (sport && !duplicateOk) {
      const { data: dupRows, error: dupErr } = await admin.from('webstores')
        .select('id,slug,name,status')
        .eq('customer_id', resolvedCustomerId)
        .eq('sport', sport)
        .eq('is_template', false)
        .in('status', ['draft', 'open'])
        .limit(1);
      if (dupErr) throw abort(500, { ok: false, error: dupErr.message });
      if (dupRows && dupRows.length) {
        throw abort(200, {
          ok: false, duplicate: true, existing_store: dupRows[0],
          error: `Customer already has a ${sport} store — pass duplicate_ok:true to build another`,
        });
      }
    }

    // Insert the store as a draft — ALWAYS, even when publish was requested. Going live
    // (if earned) happens as a separate, guarded update below, once the clone is verified.
    const slug = await uniqueSlug(admin, storeName);
    const storeRow = buildStoreRow(tpl, {
      store_name: storeName, slug, sport, customer_id: resolvedCustomerId,
      logo_url: logoUrl, primary_color: primaryColor, accent_color: accentColor,
      coach_name: coachName, coach_email: coachEmail, coach_phone: coachPhone,
    });
    const { data: newStore, error: storeErr } = await admin.from('webstores').insert(storeRow).select('id,slug,name,status').single();
    if (storeErr) {
      // A new customer may have just been created/matched right before this failed — hand
      // its id back so a retry can link to it instead of minting a duplicate.
      throw abort(500, {
        ok: false, error: `Could not create store: ${storeErr.message}`,
        customer_id: resolvedCustomerId, created_customer: createdCustomer,
      });
    }
    storeCreated = true;

    // Clone products + bundle items ---------------------------------------------------
    const { idMap, srcProducts, clonedRows, warnings: productWarnings } = await cloneProducts(admin, templateStoreId, newStore.id);
    warnings.push(...productWarnings);
    if (!srcProducts.length) warnings.push('Template has no items — the store was created empty.');
    const { warnings: bundleWarnings } = await cloneBundleItems(admin, srcProducts, idMap);
    warnings.push(...bundleWarnings);

    // Sanity-checked publish ------------------------------------------------------------
    // Only after the clone is verified do we flip a requested publish live, via a second
    // update — never as part of the original insert.
    let published = false;
    if (publish) {
      const check = sanityCheckClone(clonedRows);
      if (!check.ok) {
        warnings.push(`Published as draft instead: ${check.reason}`);
      } else {
        const { error: flipErr } = await admin.from('webstores')
          .update({ status: 'open', open_at: new Date().toISOString() })
          .eq('id', newStore.id);
        if (flipErr) {
          warnings.push(`Published as draft instead: ${flipErr.message}`);
        } else {
          published = true;
          newStore.status = 'open';
        }
      }
    }

    // Link the lead (best-effort — a failure here must not fail the build; the store
    // exists). On success this overwrites the 'building' claim with 'store_built'.
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

    console.log(`[store-quick-build] built store ${newStore.id} (${newStore.slug}) from template ${templateStoreId}, customer=${resolvedCustomerId}, created_customer=${createdCustomer}, published=${published}, invited=${invited}, warnings=${warnings.length}`);
    return {
      statusCode: 200, headers, body: JSON.stringify({
        ok: true, already_built: false, store: newStore, customer_id: resolvedCustomerId,
        created_customer: createdCustomer, published, invited, lead_updated: leadUpdated, warnings,
      }),
    };
  } catch (err) {
    // Any exit past this point that never reached a created store releases the claimed
    // lead back to its prior status — otherwise a guard trip or a mid-build error would
    // strand the lead at 'building' forever (the status='new' query excludes it from
    // future enrichment/build runs, and a future claim attempt would 409 against itself).
    if (leadClaimed && !storeCreated) {
      try { await admin.from('coach_leads').update({ status: priorLeadStatus }).eq('id', leadId); } catch (_) { /* best effort */ }
    }
    if (err && err.statusCode && err.body) {
      return { statusCode: err.statusCode, headers, body: JSON.stringify(err.body) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: (err && err.message) || 'Server error' }) };
  }
};

// Exposed for tests (mirrors coach-leads-sheet-sync.js's _internals pattern).
exports._internals = { slugify, nextAlphaTag, buildStoreRow, sanityCheckClone, escapeIlike, alphaTagBase };
