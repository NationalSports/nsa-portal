// Shared by the staff UI and server-side Showcase pipeline.
const PROMPT_VERSION = 'showcase-v7-decoration-hero';
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

module.exports = { PROMPT_VERSION, DECORATION_FINISHES, normalizeDecorationType, normalizeShowcaseSettings, showcaseSettingsChanged };
