// Shared by the staff UI and server-side Showcase pipeline.
const PROMPT_VERSION = 'showcase-v9-fit-and-laterality';
const DECORATION_FINISHES = [
  ['auto', 'Use existing decoration'],
  ['tackle_twill', 'Tackle twill'],
  ['embroidery', 'Embroidery'],
  ['chenille', 'Chenille'],
  ['screen_print', 'Screen print'],
];

function normalizeDecorationType(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ({ twill: 'tackle_twill', tackle_twill: 'tackle_twill', embroidery: 'embroidery',
    embroidered: 'embroidery', chenile: 'chenille', chenille: 'chenille',
    screenprint: 'screen_print', screen_print: 'screen_print', screen_printing: 'screen_print',
    dtf: 'heat_transfer', heat_transfer: 'heat_transfer', sublimation: 'sublimation' })[key] || null;
}

function normalizeShowcaseSettings(value) {
  return {
    decoration_type: DECORATION_FINISHES.some(([key]) => key === value?.decoration_type) ? value.decoration_type : 'auto',
    revision_notes: String(value?.revision_notes || '').trim().slice(0, 1000),
  };
}

function showcaseSettingsChanged(analysis) {
  return JSON.stringify(normalizeShowcaseSettings(analysis?.showcase_settings))
    !== JSON.stringify(normalizeShowcaseSettings(analysis?.generated_showcase_settings));
}

// Only the artwork assigned to this garment/color is a generation reference.
// Never send other colorways or unrelated designs from the store art library.
function resolveShowcaseArtwork(decoration, color, storeArt = []) {
  const d = decoration || {};
  const pick = d.cw_by_color?.[String(color || '').trim().toLowerCase()];
  const url = typeof pick === 'string' ? pick : pick?.url;
  const art = (Array.isArray(storeArt) ? storeArt : []).find((a) => a.id === (d.art_id || d.art_file_id));
  return url || d.art_url || d.source_url || d.orig_url || d.url || d.image_url || d.web_logo_url || d.artwork_url
    || art?.web_logo_url || art?.url || art?.image_url || null;
}

module.exports = { PROMPT_VERSION, DECORATION_FINISHES, normalizeDecorationType, normalizeShowcaseSettings, showcaseSettingsChanged, resolveShowcaseArtwork };
