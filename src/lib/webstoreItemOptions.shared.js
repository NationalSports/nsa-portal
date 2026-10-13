const COMBO_TOP_SIZE = 'combo_top_size';
const COMBO_BOTTOM_SIZE = 'combo_bottom_size';
const COMBO_CONFIG_KIND = 'combo';
const COMBO_SIZE_PURPOSES = new Set([COMBO_TOP_SIZE, COMBO_BOTTOM_SIZE]);

const cleanSizeList = (values) => [...new Set((Array.isArray(values) ? values : [])
  .map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))];

const comboSizeOptions = (options) => (Array.isArray(options) ? options : [])
  .filter((option) => option && COMBO_SIZE_PURPOSES.has(option.purpose));

const isComboSizeOption = (option) => !!(option && COMBO_SIZE_PURPOSES.has(option.purpose));
const comboConfig = (options) => (Array.isArray(options) ? options : [])
  .find((option) => option && option.kind === COMBO_CONFIG_KIND) || null;
const isComboItem = (options) => !!comboConfig(options);

const comboOption = (purpose, label, sizes) => ({
  id: purpose === COMBO_TOP_SIZE ? 'combo-top-size' : 'combo-bottom-size',
  label,
  kind: 'choice',
  purpose,
  required: true,
  upcharge: 0,
  choices: cleanSizeList(sizes).map((size) => ({ label: size, upcharge: 0 })),
});

const withComboConfig = (options, enabled, config = {}) => {
  const regular = (Array.isArray(options) ? options : [])
    .filter((option) => !isComboSizeOption(option) && option.kind !== COMBO_CONFIG_KIND);
  if (!enabled) return regular;
  const pieces = config.pieces || config;
  const top = pieces.top || {};
  const bottom = pieces.bottom || {};
  const topSizes = cleanSizeList(top.sizes);
  const bottomSizes = cleanSizeList(bottom.sizes);
  return [
    ...regular,
    {
      id: 'combo-config',
      label: 'Combo pieces',
      kind: COMBO_CONFIG_KIND,
      pieces: {
        top: { webstore_product_id: top.webstore_product_id || null, sizes: topSizes, price_share: top.price_share == null || top.price_share === '' ? null : Number(top.price_share) },
        bottom: { webstore_product_id: bottom.webstore_product_id || null, sizes: bottomSizes, price_share: bottom.price_share == null || bottom.price_share === '' ? null : Number(bottom.price_share) },
      },
    },
    comboOption(COMBO_TOP_SIZE, 'Top size', topSizes),
    comboOption(COMBO_BOTTOM_SIZE, 'Bottom size', bottomSizes),
  ];
};

const allocateComboPrice = (price, config, costs = {}) => {
  const totalCents = Math.max(0, Math.round((Number(price) || 0) * 100));
  const pieces = (config && config.pieces) || {};
  const topRaw = pieces.top && pieces.top.price_share;
  const bottomRaw = pieces.bottom && pieces.bottom.price_share;
  const topSet = topRaw !== null && topRaw !== undefined && topRaw !== '';
  const bottomSet = bottomRaw !== null && bottomRaw !== undefined && bottomRaw !== '';
  let topCents;
  if (topSet && bottomSet) {
    topCents = Math.round((Number(topRaw) || 0) * 100);
    const bottomCents = Math.round((Number(bottomRaw) || 0) * 100);
    if (topCents < 0 || bottomCents < 0 || topCents + bottomCents !== totalCents) {
      return { error: 'Top and bottom price shares must add up to the combo price.' };
    }
  } else if (topSet || bottomSet) {
    const setCents = Math.round((Number(topSet ? topRaw : bottomRaw) || 0) * 100);
    if (setCents < 0 || setCents > totalCents) return { error: 'A combo price share cannot exceed the combo price.' };
    topCents = topSet ? setCents : totalCents - setCents;
  } else {
    const topCost = Math.max(0, Number(costs.top) || 0);
    const bottomCost = Math.max(0, Number(costs.bottom) || 0);
    const totalCost = topCost + bottomCost;
    topCents = totalCost > 0 ? Math.round(totalCents * topCost / totalCost) : Math.round(totalCents / 2);
  }
  const bottomCents = totalCents - topCents;
  return { top: topCents / 100, bottom: bottomCents / 100 };
};

const comboConfigError = (options, price, costs = {}) => {
  const config = comboConfig(options);
  if (!config) return null;
  const pieces = config.pieces || {};
  if (!pieces.top?.webstore_product_id || !pieces.bottom?.webstore_product_id) return 'Choose both the top item and the bottom item.';
  if (pieces.top.webstore_product_id === pieces.bottom.webstore_product_id) return 'Choose different store items for the top and bottom.';
  if (!cleanSizeList(pieces.top.sizes).length || !cleanSizeList(pieces.bottom.sizes).length) return 'Enter at least one top size and one bottom size.';
  return allocateComboPrice(price, config, costs).error || null;
};

module.exports = {
  COMBO_TOP_SIZE,
  COMBO_BOTTOM_SIZE,
  COMBO_CONFIG_KIND,
  cleanSizeList,
  comboConfig,
  comboSizeOptions,
  isComboSizeOption,
  isComboItem,
  withComboConfig,
  allocateComboPrice,
  comboConfigError,
};
