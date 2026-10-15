import { normalizeAllSchoolSettings } from './adminHelpers';
import { artworkSetup, colorKey, variantCode } from './atOnceArtwork.shared';
import { methodSetupError, resolveSchoolSetup, schoolArtwork } from './methodReadiness.shared';

const expectedProductState = (item, stock, inventorySource) => ({
  active: item.active !== false,
  kind: item.kind || null,
  product_id: item.product_id || null,
  sku: item.sku || null,
  image_url: item.image_url || null,
  image_back_url: item.image_back_url || null,
  decorations: item.decorations || [],
  transfer_codes: item.transfer_codes || [],
  transfer_code: item.transfer_code || null,
  track_inventory: item.track_inventory !== false,
  takes_name: item.takes_name === true,
  takes_number: item.takes_number === true,
  personalization_template: item.personalization_template || null,
  num_transfer_sets: item.num_transfer_sets || [],
  num_transfer_size: item.num_transfer_size || null,
  num_transfer_color: item.num_transfer_color || null,
  school_style_group_id: item.school_style_group_id || null,
  variant_group_id: item.variant_group_id || null,
  school_design_label: item.school_design_label || null,
  blank_color: stock.color || item.color || null,
  inventory_source: inventorySource || null,
});

function mapScreenPrintDecorations(item, transfers, artwork) {
  const artById = new Map(artwork.map((art) => [art.id, art]));
  const codes = new Set([...(item.transfer_codes || []), item.transfer_code].filter(Boolean));
  let changed = false;
  let error = '';
  const decorations = (item.decorations || []).map((deco) => {
    if (!deco || ['perso_name', 'perso_number'].includes(deco.kind)) return deco;
    const artId = deco.art_id || deco.art_file_id;
    const art = artById.get(artId);
    const method = deco.deco_type || deco.type || art?.deco_type || art?.decoration_type || '';
    if (method !== 'screen_print') return deco;
    changed = true;
    if (!art) error ||= 'Link every logo to its art folder.';
    else if (!colorKey(item.color)) error ||= `Choose the exact garment color for ${art.name || artId}.`;
    if (deco.transfer_code) codes.delete(deco.transfer_code);
    codes.delete(`store-art-${encodeURIComponent(String(artId || ''))}`);
    const variants = (art?.dtf_variants || []).filter((variant) => colorKey(variant.garment_color) === colorKey(item.color));
    if (art && colorKey(item.color) && variants.length !== 1) error ||= `Save one DTF production variant for ${art.name || artId} on ${item.color} in its art folder.`;
    const code = variants.length === 1 && variants[0]?.id ? variantCode(artId, variants[0]) : null;
    if (code && !transfers.some((transfer) => transfer.code === code)) error ||= `Add the exact DTF variant inventory for ${art.name || artId} on ${item.color}.`;
    if (code) codes.add(code);
    return { ...deco, type: 'dtf', deco_type: 'dtf', transfer_code: code || null };
  });
  return { item: changed ? { ...item, decorations, transfer_code: null, transfer_codes: [...codes] } : item, changed, error };
}

export function classifyTeamStoreProduct(raw, { transfers = [], art = [], stock = {}, inventorySource = null } = {}) {
  const item = { ...raw, color: stock.color || raw.color || '' };
  const label = item.display_name || stock.name || item.sku || 'Unnamed item';
  const expected_product = expectedProductState(raw, stock, inventorySource);
  if (item.active === false) return { id: item.id, label, action: 'keep_hidden', reason: 'Already hidden; it will remain available for admin review.', expected_product };
  if (item.kind === 'bundle') return { id: item.id, label, action: 'deactivate', reason: 'Packages need their components rebuilt for the 24/7 per-item production recipe.', expected_product };
  if (!item.product_id || !item.sku) return { id: item.id, label, action: 'deactivate', reason: 'No exact blank garment and SKU are linked.', expected_product };
  if (item.track_inventory !== false && (!inventorySource || inventorySource === 'manual')) {
    return { id: item.id, label, action: 'deactivate', reason: 'No supported garment stock source is linked for 24/7 purchasing.', expected_product };
  }

  const artwork = schoolArtwork(art);
  const mapped = mapScreenPrintDecorations(item, transfers, artwork);
  if (mapped.error) return { id: item.id, label, action: 'deactivate', reason: mapped.error, expected_product };
  const resolved = artworkSetup(resolveSchoolSetup(mapped.item, transfers, artwork), transfers, artwork);
  const error = resolved.error || methodSetupError(resolved.item, transfers, artwork);
  if (error) return { id: item.id, label, action: 'deactivate', reason: error, expected_product };

  const mappedToDtf = mapped.changed;
  const expected_transfers = resolved.item.transfer_codes.map((code) => transfers.find((transfer) => transfer.code === code)).filter(Boolean);
  return {
    id: item.id,
    label,
    action: mappedToDtf ? 'map_dtf' : 'keep_active',
    reason: mappedToDtf ? 'Existing artwork has an exact reviewed DTF variant and inventory record for this garment color.' : 'Production setup is compatible with 24/7 fulfillment.',
    expected_product,
    ...(mappedToDtf ? { decorations: resolved.item.decorations, transfer_codes: resolved.item.transfer_codes } : {}),
    expected_transfers,
  };
}

export function buildTeamStoreConversionPlan({ store, catalog = [], transfers = [], art = [], stockByWp = {}, inventorySourceByProductId = {}, orders = [] }) {
  const actions = catalog.map((item) => classifyTeamStoreProduct(item, {
    transfers,
    art,
    stock: stockByWp[item.id] || {},
    inventorySource: inventorySourceByProductId[item.product_id] || null,
  }));
  const pendingOrders = orders.filter((order) => !order.so_id && !['cancelled', 'refunded'].includes(order.status));
  const settings = normalizeAllSchoolSettings(store?.all_school_settings);
  return {
    storePatch: {
      org_type: 'all_school',
      status: 'closed',
      close_at: null,
      delivery_mode: 'ship_home',
      number_unique: false,
      so_creation: 'daily',
      theme: 'showcase',
      all_school_settings: settings,
    },
    actions,
    readyCount: actions.filter((action) => ['keep_active', 'map_dtf'].includes(action.action)).length,
    mappedCount: actions.filter((action) => action.action === 'map_dtf').length,
    deactivatedCount: actions.filter((action) => action.action === 'deactivate').length,
    blockers: pendingOrders.length ? [`Batch or otherwise resolve ${pendingOrders.length} existing team order(s) before conversion. The 24/7 workflow cannot batch legacy team orders.`] : [],
    warnings: [
      ...(store?.status === 'open' ? ['The store is currently open. Conversion will close it before the 24/7 setup is reviewed and launched.'] : []),
    ],
  };
}

export function conversionRpcActions(plan) {
  return plan.actions.map((action) => ({
    id: action.id,
    action: action.action,
    expected_product: action.expected_product,
    expected_transfers: action.expected_transfers || [],
    ...(action.action === 'map_dtf' ? { decorations: action.decorations, transfer_codes: action.transfer_codes } : {}),
  }));
}
