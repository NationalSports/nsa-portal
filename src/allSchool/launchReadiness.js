import { methodSetupError } from './methodReadiness.shared';
export function schoolLaunchError(catalog = [], transfers = [], art = []) {
  const active = catalog.filter((item) => item.active !== false);
  if (!active.length) return 'Add at least one active offering before launching this 24/7 store.';
  const pending = active.map((item) => ({ item, error: methodSetupError(item, transfers, art) })).filter((row) => row.error);
  if (!pending.length) return '';
  return `Complete setup for ${pending.length} active offering(s) before launch: ${pending.slice(0, 4).map(({item, error}) => `${item.display_name || item.sku}: ${error}`).join(' ')}`;
}
