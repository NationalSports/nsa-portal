// supabase/functions/coach-store-submit/index.ts
// A coach builds a team store in their (public, link-gated) portal and submits
// it for approval. This function runs with the service role and re-validates
// everything the client sent before writing:
//   - Identity: the customer must exist and its alpha_tag must match the link.
//   - Pool: every item must be in the allowed pool (a template's items if a
//     template_id is given, else the coach_store_config allow-list).
//   - Pricing: prices/fundraising are taken from the server, so a tampered
//     client price is ignored; the coach fundraise is clamped to the cap.
//   - Stock: anything not in stock right now (in-house OR vendor) is dropped.
// On success it inserts a draft store (created_via='coach') plus its products,
// then best-effort emails staff that there's a submission to review.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") || "";
// Ops inbox to alert on every coach submission. The rep (passed as notify_to by
// the portal) is also alerted; if neither resolves, we just skip the email.
const NOTIFY_EMAIL = Deno.env.get("COACH_STORE_NOTIFY_EMAIL") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const ok = (b: unknown) => new Response(JSON.stringify({ ok: true, ...(b as object) }), { status: 200, headers: CORS });
const bad = (error: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ ok: false, error, ...extra }), { status: 200, headers: CORS });
const str = (v: unknown) => (typeof v === "string" ? v : "").trim();

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "team-store";
}

const esc = (s: string) => String(s || "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));

// Best-effort staff alert when a coach submits a store. Never throws - a failed
// email must not fail the submission (the admin badge is the durable signal).
// `contact` carries the public lead's typed-in name/email/phone (empty for the
// logged-in coach path, where the team is already a known customer).
async function notifyStaff(
  teamName: string, storeName: string, count: number, extraRecipients: string[],
  contact: { name?: string; email?: string; phone?: string } = {},
) {
  if (!BREVO_API_KEY) return;
  const to = [...new Set([NOTIFY_EMAIL, ...extraRecipients].map((e) => (e || "").trim()).filter((e) => e.includes("@")))];
  if (!to.length) return;
  const contactLine = (contact.name || contact.email || contact.phone)
    ? `<li><b>Contact:</b> ${esc(contact.name || "")}${contact.email ? ` &lt;${esc(contact.email)}&gt;` : ""}${contact.phone ? ` &middot; ${esc(contact.phone)}` : ""}</li>`
    : "";
  const html = `<p>A coach just submitted a team store for approval.</p>
<ul><li><b>Team:</b> ${esc(teamName)}</li><li><b>Store:</b> ${esc(storeName)}</li><li><b>Items:</b> ${count}</li>${contactLine}</ul>
<p>Open the Webstores admin and look for the amber &ldquo;Coach submission &mdash; review&rdquo; badge to set shipping &amp; sale dates and publish it.</p>`;
  try {
    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "api-key": BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: "NSA Store Builder", email: Deno.env.get("BREVO_DEFAULT_SENDER") || "hello@nationalsportsapparel.com" },
        to: to.map((email) => ({ email })),
        subject: `New coach store to review: ${storeName}`,
        htmlContent: html,
      }),
    });
  } catch (_) { /* best-effort */ }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return bad("Server is not configured (missing service role).");
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    // Public lead: a coach building from the login-free /team-stores "Build" flow.
    // There's no customer/rep to anchor to, so identity is replaced by typed-in
    // contact info and the store is filed with customer_id=null for staff to claim.
    const isPublic = body?.public === true;
    const alphaTag = str(body?.alpha_tag);
    const customerId = str(body?.customer_id);
    const name = str(body?.name);
    // Anon has no access to staff templates (webstores is authenticated-only), so a
    // public submission always builds from the allow-list pool — ignore template_id.
    const templateId = !isPublic && body?.template_id ? str(body.template_id) : null;
    const productIds: string[] = Array.isArray(body?.item_product_ids) ? body.item_product_ids.map((x: unknown) => String(x)) : [];
    const branding = (body?.branding && typeof body.branding === "object") ? body.branding : {};
    const contact = (body?.contact && typeof body.contact === "object") ? body.contact : {};
    const contactName = str((contact as any)?.name);
    const contactEmail = str((contact as any)?.email) || str((branding as any).coach_contact_email);
    const contactPhone = str((contact as any)?.phone);

    if (!name) return bad("Please name your store.");
    if (!productIds.length) return bad("Pick at least one item for your store.");
    if (productIds.length > 200) return bad("That's too many items for one store.");

    // 1) Identity. Logged-in coach: the alpha_tag the portal opened with must match
    //    the team. Public lead: no customer, but we require reachable contact info.
    let teamLabel: string;
    if (isPublic) {
      if (!contactName) return bad("Please tell us your name so we can reach you.");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) return bad("Please enter a valid email so we can reach you.");
      teamLabel = str((contact as any)?.org) || name;
    } else {
      if (!customerId || !alphaTag) return bad("Missing team identity.");
      const { data: cust } = await admin.from("customers").select("id,alpha_tag,name").eq("id", customerId).maybeSingle();
      if (!cust) return bad("We couldn't find your team.");
      if (str(cust.alpha_tag).toLowerCase() !== alphaTag.toLowerCase()) return bad("This store link doesn't match your team.");
      teamLabel = cust.name || alphaTag;
    }

    // Coach pool config (loaded once - also gives us the fundraise cap on both paths).
    const { data: cfg } = await admin.from("coach_store_config").select("*").eq("id", 1).maybeSingle();
    const fundCap = Number.isFinite(Number(cfg?.max_fundraise)) ? Number(cfg?.max_fundraise) : 25;
    // Store-wide per-item fundraise the coach asked for, clamped to the cap.
    // 0 (or unset) = leave each item's own/template fundraise untouched.
    const coachFund = Math.min(Math.max(0, Number(body?.fundraise) || 0), fundCap);

    // 2) Allowed pool + LOCKED prices (server-authoritative).
    type Locked = { retail_price: number; fundraise_amount: number; sku: string | null; display_name: string | null; image_url: string | null; takes_number: boolean; takes_name: boolean; name_upcharge: number };
    const allowed = new Map<string, Locked>();

    if (templateId) {
      const { data: tpl } = await admin.from("webstores").select("id,is_template").eq("id", templateId).maybeSingle();
      if (!tpl || !tpl.is_template) return bad("That store template is no longer available.");
      const { data: tItems } = await admin.from("webstore_products")
        .select("product_id,sku,display_name,image_url,retail_price,fundraise_amount,takes_number,takes_name,name_upcharge")
        .eq("store_id", templateId).eq("active", true).eq("kind", "single");
      for (const it of tItems || []) {
        if (!it.product_id) continue;
        allowed.set(String(it.product_id), {
          retail_price: Number(it.retail_price) || 0,
          fundraise_amount: Number(it.fundraise_amount) || 0,
          sku: it.sku ?? null, display_name: it.display_name ?? null, image_url: it.image_url ?? null,
          takes_number: !!it.takes_number, takes_name: !!it.takes_name, name_upcharge: Number(it.name_upcharge) || 0,
        });
      }
    } else {
      const brands: string[] = cfg?.allowed_brands || [];
      const cats: string[] = cfg?.allowed_categories || [];
      const dFund = Number(cfg?.default_fundraise) || 0;
      const { data: prods } = await admin.from("products")
        .select("id,sku,name,brand,category,retail_price,catalog_sell_price,image_front_url")
        .in("id", productIds);
      for (const p of prods || []) {
        if (brands.length && !brands.includes(p.brand)) continue;
        if (cats.length && !cats.includes(p.category)) continue;
        const price = p.catalog_sell_price != null ? Number(p.catalog_sell_price) : Number(p.retail_price) || 0;
        allowed.set(String(p.id), {
          retail_price: price, fundraise_amount: dFund, sku: p.sku ?? null,
          display_name: p.name ?? null, image_url: p.image_front_url ?? null,
          takes_number: false, takes_name: false, name_upcharge: 0,
        });
      }
    }

    let chosen = productIds.filter((id) => allowed.has(id));
    if (!chosen.length) return bad("None of the selected items are available for self-serve stores.");

    // 3) In-stock enforcement - drop anything with nothing on hand right now
    //    (in-house warehouse OR vendor). Coaches never get to list dead stock.
    const skuById = new Map<string, string | null>();
    for (const id of chosen) skuById.set(id, allowed.get(id)!.sku);
    const skus = [...new Set([...skuById.values()].filter(Boolean) as string[])];
    const [vend, inh] = await Promise.all([
      skus.length ? admin.from("inventory_unified").select("sku,stock_qty").in("sku", skus).gt("stock_qty", 0) : Promise.resolve({ data: [] as any[] }),
      admin.from("product_inventory").select("product_id,quantity").in("product_id", chosen).gt("quantity", 0),
    ]);
    const inStockSku = new Set((vend.data || []).map((r: any) => r.sku));
    const inStockPid = new Set((inh.data || []).map((r: any) => String(r.product_id)));
    chosen = chosen.filter((id) => inStockPid.has(id) || inStockSku.has(skuById.get(id) as string));
    if (!chosen.length) return bad("The items you picked are out of stock right now.");

    // 4) Unique slug.
    const base = slugify(name);
    let slug = base;
    for (let n = 2; ; n++) {
      const { data: ex } = await admin.from("webstores").select("id").eq("slug", slug).maybeSingle();
      if (!ex) break;
      slug = `${base}-${n}`;
      if (n > 50) { slug = `${base}-${Date.now().toString(36)}`; break; }
    }

    // 5) Insert the draft store (awaiting staff approval). A public lead has no
    //    customer yet (customer_id=null); staff link it to a customer on review.
    const storeRow: Record<string, unknown> = {
      customer_id: isPublic ? null : customerId, name, slug, status: "draft", created_via: "coach", source: "webstore",
      primary_color: str((branding as any).primary_color) || null,
      accent_color: str((branding as any).accent_color) || null,
      logo_url: str((branding as any).logo_url) || null,
      hero_blurb: str((branding as any).hero_blurb) || null,
      coach_contact_email: contactEmail || null,
      coach_contact_name: contactName || null,
      coach_contact_phone: contactPhone || null,
    };
    const { data: store, error: sErr } = await admin.from("webstores").insert(storeRow).select("id,slug").single();
    if (sErr || !store) return bad(`Could not create the store: ${sErr?.message || "unknown error"}`);

    // 6) Insert products with the SERVER-LOCKED prices, preserving chosen order.
    const rows = chosen.map((id, i) => {
      const a = allowed.get(id)!;
      return {
        store_id: store.id, product_id: id, sku: a.sku, kind: "single",
        display_name: a.display_name, image_url: a.image_url,
        retail_price: a.retail_price, fundraise_amount: coachFund > 0 ? coachFund : a.fundraise_amount,
        takes_number: a.takes_number, takes_name: a.takes_name, name_upcharge: a.name_upcharge,
        sort_order: i, active: true,
      };
    });
    const { error: pErr } = await admin.from("webstore_products").insert(rows);
    if (pErr) return bad(`Your store was created but items couldn't be added: ${pErr.message}`, { store_id: store.id });

    const notifyExtra: string[] = Array.isArray(body?.notify_to) ? body.notify_to.map((x: any) => (typeof x === "string" ? x : x?.email)).filter(Boolean) : [];
    await notifyStaff(teamLabel, name, rows.length, notifyExtra, { name: contactName, email: contactEmail, phone: contactPhone });

    return ok({ store_id: store.id, slug: store.slug, count: rows.length, dropped: productIds.length - rows.length });
  } catch (e) {
    return bad((e as Error).message);
  }
});
