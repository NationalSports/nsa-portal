const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  return value;
};

// Same-style colors may share one storefront card only when their decoration
// instructions are identical. A different logo, placement, or colorway is a
// different sellable item and must remain on its own card.
export const decorationSignature = (decorations) =>
  JSON.stringify(stableValue(Array.isArray(decorations) ? decorations : []));

export const haveSameDecorations = (left, right) =>
  decorationSignature(left) === decorationSignature(right);

export const variantGroupFields = (groupId, separate) =>
  separate ? {} : { variant_group_id: groupId };

const SHARED_CARD_FIELDS = new Set([
  'retail_price', 'fundraise_amount', 'deco_upcharge', 'deco_cost_estimate',
  'decorations', 'options', 'track_inventory',
]);

export const sharedCardFields = (fields) => Object.fromEntries(
  Object.entries(fields || {}).filter(([key]) => SHARED_CARD_FIELDS.has(key))
);

// A missing value is a legacy row and keeps the historical $5 default. Saved
// zero is intentional and must not be mistaken for a missing value.
export const webstoreDecorationCost = (savedCost, decorated) =>
  savedCost == null ? (decorated ? 5 : 0) : Math.max(0, Number(savedCost) || 0);
