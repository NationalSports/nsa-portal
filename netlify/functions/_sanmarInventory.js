const arr = (value) => (Array.isArray(value) ? value : value != null ? [value] : []);
const num = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const inventoryKey = (color, size) =>
  String(color || '').toLowerCase().replace(/\s+/g, '') + '|' + String(size || '').trim().toUpperCase();

const productInfo = (raw) => ({
  ...(raw && raw.productBasicInfo ? raw.productBasicInfo : {}),
  ...(raw || {}),
});

const partId = (raw) => {
  const info = productInfo(raw);
  return String(info.uniqueKey || info.Unique_Key || info.UniqueKey || info.partId || '').trim();
};

const partQuantity = (part) => {
  const locations = arr(
    part?.InventoryLocationArray?.InventoryLocation ||
    part?.inventoryLocationArray?.inventoryLocation
  );
  if (locations.length) {
    return locations.reduce((sum, location) => sum + num(
      location?.inventoryLocationQuantity?.Quantity?.value ??
      location?.inventoryLocationQuantity?.quantity?.value ??
      location?.inventoryLocationQuantity?.Quantity ??
      location?.inventoryLocationQuantity?.quantity
    ), 0);
  }
  return num(
    part?.quantityAvailable?.Quantity?.value ??
    part?.quantityAvailable?.Quantity ??
    part?.quantityAvailable?.quantity?.value ??
    part?.quantityAvailable?.quantity ??
    part?.quantityAvailable ??
    part?.totalQty ??
    part?.qty
  );
};

// Inventory 2.0 is keyed by SanMar's per-variant Unique_Key rather than color/size.
// Join it back to the product response so every catalog color and size receives the
// correct warehouse total. V1's ProductVariation shape is retained as a fallback.
const stockByColorSize = (inventory, productItems) => {
  const result = {};
  const parts = arr(
    inventory?.Inventory?.PartInventoryArray?.PartInventory ||
    inventory?.PartInventoryArray?.PartInventory
  );
  if (parts.length) {
    const quantityByPart = new Map();
    for (const part of parts) {
      const id = String(part?.partId || part?.PartId || '').trim();
      if (id) quantityByPart.set(id, partQuantity(part));
    }
    for (const raw of arr(productItems)) {
      const info = productInfo(raw);
      const id = partId(raw);
      if (!id || !quantityByPart.has(id)) continue;
      const color = info.colorName || info.color || info.catalogColor || info.millColor;
      const size = info.size || info.labelSize || info.sizeName || info.apparelSize;
      if (!color || !size) continue;
      const key = inventoryKey(color, size);
      result[key] = (result[key] || 0) + quantityByPart.get(id);
    }
    return result;
  }

  const variations = arr(
    inventory?.Inventory?.ProductVariationInventoryArray?.ProductVariationInventory ||
    inventory?.ProductVariationInventoryArray?.ProductVariationInventory ||
    inventory?.inventory || inventory?.items
  );
  for (const variation of variations) {
    const color = variation?.attributeColor || variation?.color;
    const size = variation?.attributeSize || variation?.size || variation?.labelSize || 'OSFA';
    let quantity = arr(
      variation?.partInventoryArray?.partInventory ||
      variation?.PartInventoryArray?.PartInventory
    ).reduce((sum, part) => sum + partQuantity(part), 0);
    if (quantity <= 0) quantity = partQuantity(variation);
    if (quantity > 0) {
      const key = inventoryKey(color, size);
      result[key] = (result[key] || 0) + quantity;
    }
  }
  return result;
};

module.exports = { inventoryKey, stockByColorSize };
