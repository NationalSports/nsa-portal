import { webstoreProductionKey } from './storeSkuGrouping';
import { sizeSkuCode } from './sizeSkuOverrides';

const arr = (value) => (Array.isArray(value) ? value : []);
const colorKey = (value) => String(value || '').trim().toLowerCase();
const placeKey = (d) => `${d?.art_id || d?.art_url || ''}@${d?.placement || ''}@${d?.side || 'front'}`;
const POS_LABEL = { left_chest: 'Left Chest', full_front: 'Front', full_back: 'Back', left_sleeve: 'Left Sleeve', right_sleeve: 'Right Sleeve' };
const positionOf = (d) => POS_LABEL[d?.placement] || (d?.side === 'back' ? 'Back' : 'Front');

// New purchases use the immutable order-line snapshot. Rows written before that
// snapshot existed retain the exact former behavior: catalog decorations are
// appended under product_id and sku, then product_id wins at lookup time.
export function createTimedTeamDecorationLookup(catalog = []) {
  const byId = new Map();
  const legacyByKey = {};
  catalog.forEach((listing) => {
    if (listing?.id) byId.set(listing.id, listing);
    const decorations = arr(listing?.decorations).filter((d) => d && (d.art_url || d.art_id));
    if (!decorations.length) return;
    [listing?.product_id, listing?.sku].filter(Boolean).forEach((key) => {
      (legacyByKey[key] = legacyByKey[key] || []).push(...decorations);
    });
  });
  const listingFor = (line) => (line?.webstore_product_id ? byId.get(line.webstore_product_id) || null : null);
  const snapshotFor = (line) => {
    if (Array.isArray(line?.decoration_snapshot)) return { version: 0, decorations: line.decoration_snapshot };
    return line?.decoration_snapshot && typeof line.decoration_snapshot === 'object' ? line.decoration_snapshot : null;
  };
  const decorationsFor = (line) => {
    const snapshot = snapshotFor(line);
    if (snapshot && Array.isArray(snapshot.decorations)) return snapshot.decorations;
    const exact = listingFor(line);
    if (exact) return arr(exact.decorations).filter((d) => d && (d.art_url || d.art_id));
    return legacyByKey[line?.product_id] || legacyByKey[line?.sku] || [];
  };
  return { byId, legacyByKey, listingFor, snapshotFor, decorationsFor };
}

export function timedTeamLineTreatment(line, lookup, legacyPersonalize = {}, legacyTransfers = {}) {
  const listing = lookup.listingFor(line);
  const snapshot = lookup.snapshotFor(line);
  const legacy = legacyPersonalize[line?.product_id] || {};
  return {
    webstore_product_id: line?.webstore_product_id || null,
    listing,
    decorations: lookup.decorationsFor(line),
    personalize: snapshot
      ? { num: snapshot.takes_number === true, name: snapshot.takes_name === true }
      : listing
      ? { num: !!listing.takes_number, name: !!listing.takes_name }
      : { num: !!legacy.num, name: !!legacy.name },
    transferCodes: snapshot && Array.isArray(snapshot.transfer_codes)
      ? snapshot.transfer_codes
      : listing
      ? [...new Set([...(arr(listing.transfer_codes)), listing.transfer_code].filter(Boolean))]
      : [...(legacyTransfers[line?.product_id] || [])],
    sizeSkus: snapshot && snapshot.size_skus && typeof snapshot.size_skus === 'object'
      ? snapshot.size_skus
      : listing?.size_skus && typeof listing.size_skus === 'object'
      ? listing.size_skus
      : {},
  };
}

export function timedTeamDecorationReview(lines = [], lookup) {
  const rows = new Map();
  lines.forEach((line) => {
    const seen = new Set();
    lookup.decorationsFor(line).forEach((decoration) => {
      const key = decoration?.art_id || decoration?.art_url;
      if (!key || seen.has(key)) return;
      seen.add(key);
      const current = rows.get(key) || { key, units: 0, decoration };
      current.units += Number(line?.qty) || 1;
      rows.set(key, current);
    });
  });
  return [...rows.values()];
}

export function timedTeamOverrideSkuCodes(lines = [], {
  lookup, legacyPersonalize = {}, legacyTransfers = {}, inlineOverrides = {},
  skuLinks = {}, legacySizeSkus = {},
} = {}) {
  return [...new Set(lines.map((line) => {
    const size = line?.size || 'OS';
    const treatment = timedTeamLineTreatment(line, lookup, legacyPersonalize, legacyTransfers);
    const raw = inlineOverrides[`${line?.product_id || line?.sku}|${size}`]
      || (!line?.product_id && skuLinks[line?.sku])
      || treatment.sizeSkus[size]
      || legacySizeSkus[line?.product_id]?.[size];
    return sizeSkuCode(raw);
  }).filter(Boolean))];
}

export function timedTeamMockCatalog({ webstoreProductId, lookup, catalog = [], sourceProductId, sku }) {
  if (webstoreProductId) {
    const exact = lookup.byId.get(webstoreProductId);
    return exact ? { catalog: exact, ambiguous: false } : { catalog: {}, ambiguous: true };
  }
  const matches = catalog.filter((row) => sourceProductId ? row.product_id === sourceProductId : row.sku === sku);
  return { catalog: matches.length === 1 ? matches[0] : {}, ambiguous: matches.length > 1 };
}

// Sourcing resolution stays with the caller (it can require vendor/catalog data).
// This helper owns the production identity and all size/roster aggregation.
export function groupTimedTeamLines(lines = [], resolve) {
  const groups = {};
  lines.forEach((line) => {
    const spec = resolve(line);
    const qty = Number(line?.qty) || 1;
    const size = line?.size || 'OS';
    const collected = Number(spec.collected) || 0;
    const unitCollected = Number.isFinite(Number(spec.unitCollected)) ? Number(spec.unitCollected) : collected / qty;
    const baseKey = webstoreProductionKey({
      sku: spec.sku,
      color: spec.color,
      vendorId: spec.vendor_id,
      decorations: spec.treatment.decorations,
      personalize: spec.treatment.personalize,
      transferCodes: spec.treatment.transferCodes,
    });
    const key = `${baseKey}§$${unitCollected.toFixed(2)}`;
    if (!groups[key]) groups[key] = {
      _baseKey: baseKey,
      source_product_id: spec.source_product_id || null,
      product_id: spec.product_id || null,
      vendor_id: spec.vendor_id || null,
      sku: spec.sku || '',
      color: spec.color || '',
      webstore_product_id: spec.treatment.webstore_product_id,
      decorations: spec.treatment.decorations,
      personalize: spec.treatment.personalize,
      transferCodes: spec.treatment.transferCodes,
      sizes: {},
      numbers: {},
      names: {},
      collected: 0,
    };
    const group = groups[key];
    group.sizes[size] = (group.sizes[size] || 0) + qty;
    group.collected = Math.round((group.collected + collected) * 100) / 100;
    for (let unit = 0; unit < qty; unit++) {
      if (group.personalize.num) (group.numbers[size] = group.numbers[size] || []).push(line?.player_number ? String(line.player_number) : '');
      if (group.personalize.name) (group.names[size] = group.names[size] || []).push(line?.player_name || '');
    }
  });
  return groups;
}

export function resolveTimedTeamColorWayId(decoration, art, garmentColor) {
  const colorWays = arr(art?.color_ways);
  const valid = (id) => id && colorWays.some((cw) => cw?.id === id);
  if (valid(decoration?.color_way_id)) return decoration.color_way_id;
  const perColor = decoration?.cw_by_color?.[colorKey(garmentColor)];
  if (typeof perColor === 'object' && valid(perColor?.color_way_id)) return perColor.color_way_id;
  if (!colorWays.length) return null;
  const garment = colorKey(garmentColor);
  const exact = garment && colorWays.find((cw) => colorKey(cw?.garment_color) === garment);
  const fuzzy = garment && colorWays.find((cw) => {
    const candidate = colorKey(cw?.garment_color);
    return candidate && (candidate.includes(garment) || garment.includes(candidate));
  });
  return exact?.id || fuzzy?.id || (colorWays.length === 1 ? colorWays[0]?.id || null : null);
}

export function buildTimedTeamSoArtDecorations({
  decorations = [], garmentColor = '', artById = {}, methodOverrides = {},
  routing = {}, decorationUrl = (d) => d?.art_url || '',
  makeArtId = () => '',
  approvedAt = null,
  uploadedDate = '',
}) {
  const seen = new Set();
  const artFiles = [];
  const soDecorations = [];
  decorations.forEach((decoration) => {
    const key = placeKey(decoration);
    if (seen.has(key)) return;
    seen.add(key);
    const libraryArt = decoration?.art_id ? artById[decoration.art_id] : null;
    const overrideType = methodOverrides[decoration?.art_id || decoration?.art_url] || null;
    const artId = libraryArt?.id || decoration?.art_id || makeArtId();
    if (libraryArt) {
      const { _srcLabel, _srcCustId, ...clean } = libraryArt;
      const art = { ...clean, id: artId, ...(overrideType ? { deco_type: overrideType } : {}) };
      if (!art.web_logo_url && decoration.art_url) art.web_logo_url = decoration.art_url;
      art.prod_files_attached = false;
      if (art.status !== 'approved' && art.status !== 'art_complete') {
        art.status = 'approved';
        if (!art.approved_at && approvedAt) art.approved_at = approvedAt;
      }
      artFiles.push(art);
    } else {
      artFiles.push({ id: artId, name: 'Store logo', deco_type: overrideType || 'screen_print', web_logo_url: decoration?.art_url || '', files: decoration?.source_url ? [{ url: decoration.source_url, name: 'logo' }] : [], mockup_files: [], color_ways: [], status: 'approved', uploaded: uploadedDate });
    }
    soDecorations.push({
      kind: 'art',
      art_file_id: artId,
      position: positionOf(decoration),
      type: overrideType || libraryArt?.deco_type || 'screen_print',
      color_way_id: resolveTimedTeamColorWayId(decoration, libraryArt, garmentColor),
      web_url: decorationUrl(decoration, garmentColor, libraryArt?.web_logos) || decoration?.art_url || '',
      placement: decoration?.placement || '',
      side: decoration?.side || 'front',
      color_label: decoration?.color_label || 'original',
      sell_override: 0,
      sell_each: 0,
      cost_each: 0,
      ...routing,
    });
  });
  return { artFiles, decorations: soDecorations };
}
