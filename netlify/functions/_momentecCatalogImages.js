const NO_PICTURE = /(?:^|[/_])NoPicture(?:[_.]|$)/i;

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

function splitColorwaySku(sku) {
  const value = String(sku || '').trim();
  const dot = value.indexOf('.');
  return dot < 0
    ? { design: value, colorCode: null }
    : { design: value.slice(0, dot), colorCode: value.slice(dot + 1) || null };
}

function usableUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) && !NO_PICTURE.test(url);
}

function urlMatchesColor(url, design, colorCode) {
  if (!usableUrl(url) || !design || !colorCode) return false;
  let filename;
  try {
    filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
  } catch {
    return false;
  }
  return filename.toLowerCase().startsWith(`${design}_${colorCode}_`.toLowerCase())
    || filename.toLowerCase() === `${design}_${colorCode}.jpg`.toLowerCase();
}

// Momentec currently serves two catalog shapes:
//   Images.front/back/... for newer records, and Images.imageURL for older ones.
// A design-level legacy product may use the catalog's hero color. A colorway
// product may only use a URL that names its own color code.
function extractCatalogImages(data, sku) {
  const { design, colorCode } = splitColorwaySku(sku);
  const productInfo = asArray(data && data.productInfo);

  for (const product of productInfo) {
    const images = (product && product.Images) || {};
    const allowed = (url) => usableUrl(url) && (!colorCode || urlMatchesColor(url, design, colorCode));
    const first = (urls) => urls.find(allowed) || null;

    // Prefer flat product shots. Quarter/hero shots are only a last resort for
    // old design-level rows; they are never borrowed across colorways.
    const front = first([
      images.front,
      images.imageURL,
      ...(!colorCode ? [images.lquarter, images.rquarter, images.heroImage] : []),
    ]);
    const back = first([images.back]);
    if (front || back) return { front, back };
  }
  return { front: null, back: null };
}

module.exports = {
  extractCatalogImages,
  splitColorwaySku,
  urlMatchesColor,
  usableUrl,
};
