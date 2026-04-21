// Richardson Sports Level 4 wholesale pricing (576+ dealer tier).
// Source: Richardson dealer price list PDF.
// Last updated: 2026-04-21
//
// To refresh: replace the entries below with the latest Level 4 column values
// from Richardson's dealer price list. The feed style groups variants under a
// shared prefix (e.g. feed "PTS20" includes both PTS20M and PTS20S catalog
// models), so getRichardsonLevel4Price does prefix matching and picks the
// lowest matching price as the "from $X.XX" anchor.

const RICHARDSON_LEVEL4_PRICES = {
  // Stock Headwear — Pulse / R-series
  'PTS20M': 7.44, 'PTS20S': 7.65, 'PTS30S': 8.08, 'PTS50S': 8.50, 'PTS65': 9.14,
  'R15': 2.51, 'R18': 3.40, 'R20': 3.83, 'R22': 3.61,
  'R45': 3.83, 'R55': 3.83, 'R65S': 3.40, 'R75S': 3.61,

  // 110 / 111 / 112 truckers
  '110': 6.66,
  '111': 5.87, '111P': 6.53, '111PT': 7.83, '111T': 7.18,
  '112': 5.66, '112FP': 5.66, '112FPC': 5.66, '112FPR': 5.87,
  '112PT': 7.83, '112T': 7.18, '112P': 6.74, '112PFP': 6.74, '112PM': 6.74,
  '112+': 6.96, '112RE': 6.09, '112WF': 6.53, '112WH': 8.27, '112LN': 6.53,

  // 113 / 115 foamie + low-pro
  '113': 5.66, '115': 5.66, '115CH': 6.74,

  // 121-149 beanies + knits
  '121': 5.22, '126': 8.27, '130': 5.00, '134': 6.74, '135': 6.74,
  '137': 3.92, '139RE': 7.40, '141': 8.27, '143': 7.61, '145': 6.09,
  '146': 4.57, '147': 5.22, '148': 7.18, '149': 5.22, '154': 10.44, '157': 8.27,

  // 160-185 performance / 7-panel
  '160': 7.61, '163': 7.61, '168': 6.31, '168P': 7.18, '169': 8.27,
  '172': 8.05, '173': 8.05, '176': 7.83, '185': 7.18,

  // 200-series snapbacks + performance
  '203': 6.09, '212': 5.00, '213': 5.66, '214': 4.79, '217': 6.09,
  '220': 6.53, '222': 6.74, '224RE': 6.31, '225': 6.53,
  '252': 6.09, '252L': 6.09, '253': 8.27, '254RE': 7.18, '255': 5.87,
  '256': 7.83, '256P': 8.05, '257': 6.74, '258': 6.31, '262': 6.09,

  // 300-series canvas / washed
  '309': 6.53, '312': 5.87, '320T': 5.22, '323FPC': 6.09,
  '324': 5.44, '324RE': 5.87, '326': 5.44, '336': 6.74,
  '355': 8.48, '356': 5.66, '380': 7.40, '382': 6.53,

  // 400-series
  '414': 6.96, '420': 8.05, '435': 9.35, '436': 6.96,
  '485': 8.48, '487': 8.27, '495': 7.61,

  // 500-series umpire / surge
  '510': 7.18, '511': 6.74, '512': 7.18, '514': 7.61,
  '525': 7.40, '530': 8.05, '533': 8.70, '535': 7.40,
  '540': 8.05, '543': 8.70, '545': 7.40, '550': 8.05, '585': 8.48,

  // 600-700 performance / officials
  '632': 8.48, '633': 8.48, '634': 6.74, '643': 8.48, '653': 8.48,
  '675': 6.96, '707': 5.66, '709': 7.40, '712': 6.74, '715': 7.40,
  '733': 8.92, '740': 6.31, '743': 8.92, '753': 8.92,
  '785': 9.35, '787': 9.35,

  // 800-series brimmed / straw
  '810': 16.31, '822': 15.66, '824': 14.79, '827': 14.79, '828': 17.40,
  '835': 7.18, '840': 6.74, '843': 6.74, '862': 7.83, '863': 8.48,
  '865': 10.44, '870': 8.48, '874': 8.48, '882': 5.66, '882FP': 5.66, '884': 6.09,

  // 900-series
  '909': 18.27, '910': 20.01, '930': 6.31, '931': 7.18, '932': 6.31,
  '933': 7.83, '934': 7.40, '935': 7.18, '937': 10.01, '938': 7.83,
  '939': 6.74, '942': 8.27,
};

// Returns the Level 4 wholesale price for a Richardson feed style.
// Feed styles sometimes wrap multiple catalog models (e.g. "PTS20" covers
// PTS20M + PTS20S), so exact-match falls back to prefix match (lowest price
// wins — the "from $X.XX" semantic) and finally to longest-prefix-of-style.
export const getRichardsonLevel4Price = (style) => {
  if (!style) return 0;
  const s = String(style).toUpperCase().trim();
  if (RICHARDSON_LEVEL4_PRICES[s] != null) return RICHARDSON_LEVEL4_PRICES[s];
  const startsWithStyle = Object.entries(RICHARDSON_LEVEL4_PRICES).filter(([k]) => k.startsWith(s));
  if (startsWithStyle.length) return Math.min(...startsWithStyle.map(([, v]) => v));
  const styleStartsWith = Object.entries(RICHARDSON_LEVEL4_PRICES).filter(([k]) => s.startsWith(k));
  if (styleStartsWith.length) {
    styleStartsWith.sort((a, b) => b[0].length - a[0].length);
    return styleStartsWith[0][1];
  }
  return 0;
};

export { RICHARDSON_LEVEL4_PRICES };
