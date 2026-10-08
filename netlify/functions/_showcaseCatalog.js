const {resolveShowcaseArtwork} = require('../../src/lib/showcaseSettings');

async function getCatalog(admin, storeId, storeArt = []) {
  const { data: rows, error } = await admin
    .from('webstore_products')
    .select('id,store_id,product_id,kind,sku,display_name,image_url,decorations,active,sort_order,variant_group_id,school_style_group_id,school_design_label')
    .eq('store_id', storeId)
    .eq('active', true)
    .order('sort_order');
  if (error) throw new Error(error.message);
  const productIds = [...new Set((rows || []).map((r) => r.product_id).filter(Boolean))];
  let products = [];
  if (productIds.length) {
    const result = await admin
      .from('products')
      .select('id,sku,name,brand,color,category,description,image_front_url,vendor_id')
      .in('id', productIds);
    if (result.error) throw new Error(result.error.message);
    products = result.data || [];
  }
  const byProduct = Object.fromEntries(products.map((p) => [p.id, p]));
  return (rows || []).map((wp) => {
    const product = byProduct[wp.product_id] || {};
    return {
      webstore_product_id: wp.id,
      product_id: wp.product_id,
      kind: wp.kind,
      supplier_sku: product.sku, vendor_id: product.vendor_id,
      supplier_image_url: product.image_front_url,
      variant_group_id: wp.variant_group_id, school_style_group_id: wp.school_style_group_id, school_design_label: wp.school_design_label,
      sku: wp.sku || product.sku || '',
      name: wp.display_name || product.name || wp.sku || 'Store product',
      brand: product.brand || '',
      color: product.color || '',
      category: product.category || '',
      decorations: (wp.decorations || []).map((d) => ({ ...d, art_url: resolveShowcaseArtwork(d, product.color, storeArt) })),
      standard_image_url: wp.image_url || product.image_front_url || null,
      sort_order: wp.sort_order || 0,
    };
  });
}

module.exports = {getCatalog};
