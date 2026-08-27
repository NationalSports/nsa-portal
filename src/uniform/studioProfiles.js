export const STUDIO_DEFAULTS = {
  key: 0.94,
  fill: 0.08,
  back: 0.34,
  hemi: 0.06,
  exposure: 0.82,
  env: 0.08,
  sheen: 0.08,
  aoRadius: 0.075,
  aoScale: 2.8,
  bg: 0.92,
};

// Opt-in comparison profile for evaluating the cleaner, softer product-render
// treatment used by premium apparel configurators. It deliberately does not
// replace the calibrated production defaults.
export const LACOSTE_TEST_PROFILE = {
  key: 0.88,
  fill: 0.14,
  back: 0.30,
  hemi: 0.08,
  exposure: 0.84,
  env: 0.14,
  sheen: 0.16,
  aoRadius: 0.06,
  aoScale: 2.4,
  bg: 0.90,
};

export function resolveStudioProfile(mode, savedProfile = null) {
  if (String(mode || '').toLowerCase() === 'lacoste') return { ...LACOSTE_TEST_PROFILE };
  return { ...STUDIO_DEFAULTS, ...(savedProfile || {}) };
}
