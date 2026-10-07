// Production approval is invalidated by the database when the exact setup changes.
export function schoolLaunchError(catalog = []) {
  const active = catalog.filter((item) => item.active !== false);
  if (!active.length) return 'Add at least one active offering before launching this 24/7 store.';
  const pending = active.filter((item) => !item.production_approved_at || !item.production_approved_by || !item.image_url);
  if (!pending.length) return '';
  return `Finish and approve production art for ${pending.length} active offering(s) before launch: ${pending.slice(0, 4).map((item) => item.display_name || item.sku || 'Unnamed offering').join(', ')}. Review each setup in Categories.`;
}
