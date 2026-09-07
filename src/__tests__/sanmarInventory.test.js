const { inventoryKey, stockByColorSize } = require('../../netlify/functions/_sanmarInventory');

describe('SanMar inventory normalization', () => {
  test('joins Inventory 2.0 part quantities to product color and size', () => {
    const products = [
      { productBasicInfo: { uniqueKey: 'part-1', colorName: 'Shadow Grey Heather', size: 'M' } },
      { productBasicInfo: { uniqueKey: 'part-2', colorName: 'True Navy', size: 'XL' } },
    ];
    const inventory = { Inventory: { PartInventoryArray: { PartInventory: [
      { partId: 'part-1', InventoryLocationArray: { InventoryLocation: [
        { inventoryLocationQuantity: { Quantity: { value: '17' } } },
        { inventoryLocationQuantity: { Quantity: { value: '5' } } },
      ] } },
      { partId: 'part-2', InventoryLocationArray: { InventoryLocation: {
        inventoryLocationQuantity: { Quantity: { value: '9' } },
      } } },
    ] } } };

    expect(stockByColorSize(inventory, products)).toEqual({
      'shadowgreyheather|M': 22,
      'truenavy|XL': 9,
    });
  });

  test('keeps the older color/size response as a fallback', () => {
    const inventory = { Inventory: { ProductVariationInventoryArray: { ProductVariationInventory: {
      attributeColor: 'Iron Grey',
      attributeSize: '2xl',
      quantityAvailable: '31',
    } } } };
    expect(stockByColorSize(inventory, [])).toEqual({ 'irongrey|2XL': 31 });
    expect(inventoryKey('True Royal/ White', ' m ')).toBe('trueroyal/white|M');
  });

  test('returns an empty map when inventory parts cannot be matched', () => {
    const inventory = { Inventory: { PartInventoryArray: { PartInventory: {
      partId: 'different-part', quantityAvailable: '50',
    } } } };
    expect(stockByColorSize(inventory, [{ productBasicInfo: {
      uniqueKey: 'catalog-part', colorName: 'Navy', size: 'L',
    } }])).toEqual({});
  });
});
