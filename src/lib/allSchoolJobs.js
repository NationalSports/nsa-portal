// All School jobs are created from paid recipe snapshots by the conversion RPC.
// Staff can advance/review the stored jobs, while item edits must not silently
// reconstruct their sport/art identity from the mutable product catalog.
function isAllSchoolRecipeOrder(order) {
  return Array.isArray(order?.items) && order.items.some(item => {
    const recipe = item?.recipe_snapshot;
    return recipe && typeof recipe === 'object' && !Array.isArray(recipe)
      && typeof recipe.webstore_product_id === 'string' && recipe.webstore_product_id.length > 0;
  });
}
module.exports = { isAllSchoolRecipeOrder };
