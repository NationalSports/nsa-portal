export function approvableImageIds(items) {
  return items.filter(({asset}) => asset?.status === 'review' && asset.showcase_image_url && !asset.needs_regeneration)
    .map(item => item.webstore_product_id);
}

// Use the existing per-image authorization, catalog checks and concurrency guard.
export async function approveImages(call, ids) {
  let approved = 0;
  const failures = [];
  for (const id of [...new Set(ids)]) {
    try {
      await call('approve', {webstore_product_id:id});
      approved++;
    } catch (error) {
      failures.push({id, message:error.message || String(error)});
    }
  }
  return {approved, failures};
}
