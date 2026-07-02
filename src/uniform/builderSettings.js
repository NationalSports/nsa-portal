// Uniform Builder — admin-managed builder settings.
//
// Three registries the staff can edit from Settings → Uniform Builder without a
// code change, each stored as one JSONB row in uniform_settings:
//   • numberStyles — the lettering styles coaches pick from (font + treatment)
//   • palette      — the team-color swatches offered everywhere in the wizard
//   • presets      — the per-sport "pick a starting design" gallery
//
// The wizard renders instantly from the built-in defaults, then re-renders if
// the fetch returns admin overrides — so an empty/unreachable table (or a coach
// on a flaky connection) always still gets a working builder. Values are
// sanitized on load: a half-edited row can never crash the coach flow.

import { FONTS as FONT_LIBRARY } from './fonts';

export const DEFAULT_NUMBER_STYLES = [
  { id: 'block', label: 'Block', font: 'anton', hollow: false },
  { id: 'varsity', label: 'Varsity', font: 'squada', hollow: false },
  { id: 'outline', label: 'Outline', font: 'anton', hollow: true },
];

export const DEFAULT_PALETTE = [
  { hex: '#192853', name: 'Navy' }, { hex: '#962C32', name: 'Red' }, { hex: '#0B0B0B', name: 'Black' },
  { hex: '#FFFFFF', name: 'White' }, { hex: '#1E4D8C', name: 'Royal' }, { hex: '#7CB0E0', name: 'Sky' },
  { hex: '#0B6E4F', name: 'Forest' }, { hex: '#F2B705', name: 'Gold' }, { hex: '#5B2A86', name: 'Purple' },
  { hex: '#7A1F3D', name: 'Maroon' }, { hex: '#D9631E', name: 'Orange' }, { hex: '#0EA5A5', name: 'Teal' },
];

const sec = (color, pattern = 'solid', color2 = '#FFFFFF') => ({ color, color2, pattern });
export const DEFAULT_PRESETS = [
  { id: 'bold', name: 'Bold Stripes', sports: [], config: { numberColor: '#192853', sections: { body: sec('#7CB0E0', 'boldstripe'), sleeves: sec('#192853'), collar: sec('#192853') } } },
  { id: 'classic', name: 'Classic Solid', sports: [], config: { numberColor: '#FFFFFF', sections: { body: sec('#192853'), sleeves: sec('#962C32'), collar: sec('#962C32') } } },
  { id: 'pinstripe', name: 'Pinstripe', sports: [], config: { numberColor: '#192853', sections: { body: sec('#FFFFFF', 'pinstripe', '#192853'), sleeves: sec('#192853'), collar: sec('#192853') } } },
  { id: 'camo', name: 'Camo Sleeves', sports: [], config: { numberColor: '#FFFFFF', sections: { body: sec('#0B0B0B'), sleeves: sec('#0B6E4F', 'camo', '#0B0B0B'), collar: sec('#0B0B0B') } } },
  { id: 'royalgold', name: 'Royal & Gold', sports: [], config: { numberColor: '#F2B705', sections: { body: sec('#1E4D8C'), sleeves: sec('#F2B705'), collar: sec('#F2B705') } } },
  { id: 'fade', name: 'Sunset Fade', sports: [], config: { numberColor: '#FFFFFF', sections: { body: sec('#962C32', 'fade', '#D9631E'), sleeves: sec('#0B0B0B'), collar: sec('#0B0B0B') } } },
  { id: 'blackout', name: 'Blackout', sports: [], config: { numberColor: '#FFFFFF', sections: { body: sec('#0B0B0B'), sleeves: sec('#0B0B0B', 'carbon', '#4A4A4A'), collar: sec('#4A4A4A') } } },
  { id: 'maroon', name: 'Maroon Stripes', sports: [], config: { numberColor: '#FFFFFF', sections: { body: sec('#7A1F3D', 'boldstripe'), sleeves: sec('#0B0B0B'), collar: sec('#0B0B0B') } } },
];

const FONT_IDS = new Set(FONT_LIBRARY.map((f) => f.id));
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// ── sanitizers — a broken admin row must never break the coach builder ──────
function cleanStyles(raw) {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .filter((s) => s && typeof s === 'object' && FONT_IDS.has(s.font))
    .map((s, i) => ({
      id: typeof s.id === 'string' && s.id ? s.id : `style${i}`,
      label: (typeof s.label === 'string' && s.label.trim()) ? s.label.trim().slice(0, 18) : 'Style',
      font: s.font,
      hollow: !!s.hollow,
    }));
  return out.length ? out : null;
}
function cleanPalette(raw) {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .filter((p) => p && typeof p === 'object' && HEX_RE.test(p.hex))
    .map((p) => ({ hex: p.hex.toUpperCase(), name: (typeof p.name === 'string' && p.name.trim()) ? p.name.trim().slice(0, 18) : 'Custom' }));
  return out.length >= 2 ? out : null;
}
function cleanPresets(raw) {
  if (!Array.isArray(raw)) return null;
  const zone = (z, fallback) => (z && typeof z === 'object' && HEX_RE.test(z.color || ''))
    ? { color: z.color, color2: HEX_RE.test(z.color2 || '') ? z.color2 : '#FFFFFF', pattern: typeof z.pattern === 'string' ? z.pattern : 'solid', ...(z.pattern === 'custom' && typeof z.patternImage === 'string' ? { patternImage: z.patternImage, patternName: z.patternName } : {}) }
    : fallback;
  const out = raw
    .filter((p) => p && typeof p === 'object' && p.config && p.config.sections)
    .map((p, i) => {
      const S = p.config.sections;
      return {
        id: typeof p.id === 'string' && p.id ? p.id : `preset${i}`,
        name: (typeof p.name === 'string' && p.name.trim()) ? p.name.trim().slice(0, 26) : 'Design',
        sports: Array.isArray(p.sports) ? p.sports.filter((x) => typeof x === 'string') : [],
        config: {
          numberColor: HEX_RE.test(p.config.numberColor || '') ? p.config.numberColor : '#FFFFFF',
          sections: {
            body: zone(S.body, sec('#192853')),
            sleeves: zone(S.sleeves || S.sleeveL, sec('#FFFFFF')),
            collar: zone(S.collar, sec('#FFFFFF')),
          },
        },
      };
    });
  return out.length ? out : null;
}

export const SETTINGS_DEFAULTS = {
  numberStyles: DEFAULT_NUMBER_STYLES,
  palette: DEFAULT_PALETTE,
  presets: DEFAULT_PRESETS,
};

const CLEANERS = { numberStyles: cleanStyles, palette: cleanPalette, presets: cleanPresets };

let _cache = null;
let _inflight = null;

// Load admin overrides (cached per session). Always resolves to a complete,
// safe settings object.
export function loadBuilderSettings() {
  if (_cache) return Promise.resolve(_cache);
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const out = { ...SETTINGS_DEFAULTS };
    try {
      const mod = await import('../lib/supabase');
      if (mod.supabase) {
        const { data } = await mod.supabase.from('uniform_settings').select('key,value');
        for (const row of data || []) {
          const clean = CLEANERS[row.key];
          const v = clean && clean(row.value);
          if (v) out[row.key] = v;
        }
      }
    } catch (_e) { /* defaults stand */ }
    _cache = out;
    _inflight = null;
    return out;
  })();
  return _inflight;
}

// Save one registry (admin screens). Refreshes the session cache on success.
export async function saveBuilderSetting(key, value) {
  const clean = CLEANERS[key] && CLEANERS[key](value);
  if (!clean) throw new Error('Invalid ' + key + ' payload');
  const mod = await import('../lib/supabase');
  if (!mod.supabase) throw new Error('Not connected');
  const { error } = await mod.supabase.from('uniform_settings').upsert({ key, value: clean, updated_at: new Date().toISOString() });
  if (error) throw error;
  if (_cache) _cache = { ..._cache, [key]: clean };
  return clean;
}
