import { supabaseCoach } from '../lib/supabaseCoach';

// Cold-load product-by-sku fetch for the /product/:sku route (deep link /
// refresh / forward-nav re-entry — TeamShopApp's route-keyed guard effect).
// Explicit, non-sensitive column list (not `select('*')`): mirrors the
// search_products RPC projection ProductPage already consumes from a
// catalog/search card click, so ProductPage renders identically whichever
// way it got here, and never surfaces nsa_cost/qb_item_id/vendor_sku/upc to
// an anonymous cold load. Anon-RLS read: products_select `for select using
// (true)` (supabase/migrations/00002_rls_policies.sql), same policy
// reorderProduct already relies on.
const PRODUCT_COLUMNS = 'id,sku,name,brand,color,category,retail_price,available_sizes,image_front_url,image_back_url,_colors,pricing_group';

export async function getProductBySku(sku) {
  if (!sku) return null;
  const { data, error } = await supabaseCoach.from('products')
    .select(PRODUCT_COLUMNS)
    .eq('sku', sku)
    .limit(1);
  if (error || !data || !data[0]) return null;
  return data[0];
}
