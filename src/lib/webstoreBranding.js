// Shared by the staff editor and the public Netlify endpoint. Keep this
// CommonJS so the server can require it directly.
const SCHOOL_COLOR_HEX = Object.freeze({
  Black: '#191919',
  White: '#FFFFFF',
  Grey: '#9AA1AC',
  Silver: '#C0C0C0',
  Navy: '#1B2A4A',
  Royal: '#2148C7',
  Blue: '#3B82F6',
  Red: '#BA0C2F',
  Cardinal: '#8C1515',
  Maroon: '#6B1F2A',
  Orange: '#EA580C',
  Gold: '#C9A227',
  Yellow: '#EAB308',
  Green: '#15803D',
  Purple: '#3B1464',
  Pink: '#EC4899',
  Brown: '#7C4A21',
});

const PRIMARY_PREFERENCE = ['Navy', 'Maroon', 'Cardinal', 'Purple', 'Green', 'Royal', 'Brown', 'Red', 'Black', 'Blue'];
const ACCENT_PREFERENCE = ['Orange', 'Red', 'Cardinal', 'Gold', 'Yellow', 'Royal', 'Blue', 'Green', 'Pink', 'Purple', 'Maroon', 'Navy'];

const COLOR_NAMES = Object.keys(SCHOOL_COLOR_HEX);

function canonicalColorName(value) {
  const normalized = String(value || '').trim().replace(/^gray$/i, 'Grey');
  return COLOR_NAMES.find((name) => name.toLowerCase() === normalized.toLowerCase()) || null;
}

function namedSchoolColors(customer, parent) {
  const own = Array.isArray(customer?.school_colors) ? customer.school_colors : [];
  const inherited = Array.isArray(parent?.school_colors) ? parent.school_colors : [];
  const source = own.length ? own : inherited;
  const seen = new Set();
  return source.map(canonicalColorName).filter((name) => name && !seen.has(name) && seen.add(name));
}

function preferredColor(colors, preference, excluded) {
  return preference.find((name) => colors.includes(name) && name !== excluded)
    || colors.find((name) => name !== excluded)
    || null;
}

function customerSchoolColorTheme(customer, parent) {
  const colors = namedSchoolColors(customer, parent);
  if (!colors.length) return { primary: null, accent: null };
  const primaryName = preferredColor(colors, PRIMARY_PREFERENCE);
  const accentName = preferredColor(colors, ACCENT_PREFERENCE, primaryName);
  return {
    primary: primaryName ? SCHOOL_COLOR_HEX[primaryName] : null,
    accent: accentName ? SCHOOL_COLOR_HEX[accentName] : null,
  };
}

function effectiveWebstoreColors(store, customer, parent) {
  const inherited = customerSchoolColorTheme(customer, parent);
  return {
    primary: store?.primary_color || inherited.primary,
    accent: store?.accent_color || inherited.accent,
  };
}

module.exports = {
  SCHOOL_COLOR_HEX,
  canonicalColorName,
  namedSchoolColors,
  customerSchoolColorTheme,
  effectiveWebstoreColors,
};
