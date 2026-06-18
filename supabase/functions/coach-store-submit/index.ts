// supabase/functions/coach-store-submit/index.ts
// ─────────────────────────────────────────────────────────
// A coach builds a team store in their (public) portal and submits it for
// approval. The portal is link-gated, not auth-gated, so this function is the
// real guard: it runs with the service role and re-validates EVERYTHING the
// client sent before writing anything.
//
//  • Identity   — the customer must exist and its alpha_tag must match the
//                 portal link the coach is using.
//  • Pool       — every chosen item must belong to the allowed pool: a staff
//                 template's items if a template_id is given, otherwise the
//                 coach_store_config allow-list (brands/categories).
//  • Pricing    — prices/fundraising are taken from the template/config on the
//                 SERVER and re-applied, so a tampered client price is ignored.
//  • Stock      — anything not in stock right now (in-house OR vendor) is dropped.
//
// On success it inserts a webstores row as status='draft', created_via='coach'
// (so staff can review and publish it from the admin builder) plus its products.
// ─────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return bad("Server is not configured (missing service role).");
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const alphaTag = str(body?.alpha_tag);
    const customerId = str(body?.customer_id);
    const name = str(body?.name);
    const templateId = body?.template_id ? str(body.template_id) : null;
    const productIds: string[] = Array.isArray(body?.item_product_ids) ? body.item_product_ids.map((x: unknown) => String(x)) : [];
    const branding = (body?.branding && typeof body.branding === "object") ? body.branding : {};

    if (!customerId || !alphaTag) return bad("Missing team identity.");
    if (!name) return bad("Please name your store.");
    if (!productIds.length) return bad("Pick at least one item for your store.");

    // 1) Identity — the alpha_tag the portal was opened with must match the team.
    const { data: cust } = await admin.from("customers").select("id,alpha_tag,name").eq("id", customerId).maybeSingle();
    if (!cust) return bad("We couldn't find your team.");
    if (str(cust.alpha_tag).toLowerCase() !== alphaTag.toLowerCase()) return bad("This store link doesn't match your team.");

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
      const { data: cfg } = await admin.from("coach_store_config").select("*").eq("id", 1).maybeSingle();
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

    // 3) In-stock enforcement — drop anything with nothing on hand right now
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

    // 5) Insert the draft store (awaiting staff approval).
    const storeRow: Record<string, unknown> = {
      customer_id: customerId, name, slug, status: "draft", created_via: "coach", source: "webstore",
      primary_color: str((branding as any).primary_color) || null,
      accent_color: str((branding as any).accent_color) || null,
      logo_url: str((branding as any).logo_url) || null,
      hero_blurb: str((branding as any).hero_blurb) || null,
      coach_contact_email: str((branding as any).coach_contact_email) || null,
    };
    const { data: store, error: sErr } = await admin.from("webstores").insert(storeRow).select("id,slug").single();
    if (sErr || !store) return bad(`Could not create the store: ${sErr?.message || "unknown error"}`);

    // 6) Insert products with the SERVER-LOCKED prices, preserving chosen order.
    const rows = chosen.map((id, i) => {
      const a = allowed.get(id)!;
      return {
        store_id: store.id, product_id: id, sku: a.sku, kind: "single",
        display_name: a.display_name, image_url: a.image_url,
        retail_price: a.retail_price, fundraise_amount: a.fundraise_amount,
        takes_number: a.takes_number, takes_name: a.takes_name, name_upcharge: a.name_upcharge,
        sort_order: i, active: true,
      };
    });
    const { error: pErr } = await admin.from("webstore_products").insert(rows);
    if (pErr) return bad(`Your store was created but items couldn't be added: ${pErr.message}`, { store_id: store.id });

    return ok({ store_id: store.id, slug: store.slug, count: rows.length, dropped: productIds.length - rows.length });
  } catch (e) {
    return bad((e as Error).message);
  }
});
