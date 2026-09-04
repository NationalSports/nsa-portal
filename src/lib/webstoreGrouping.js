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
