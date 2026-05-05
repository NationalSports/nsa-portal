// Richardson Sports Elite tier wholesale pricing.
// Source: Richardson dealer price list (Elite column).
// Last updated: 2026-05-05
//
// To refresh: replace the entries below with the latest Elite column values
// from Richardson's dealer price list. The feed style groups variants under a
// shared prefix (e.g. feed "PTS20" includes both PTS20M and PTS20S catalog
// models), so getRichardsonLevel4Price does prefix matching and picks the
// lowest matching price as the "from $X.XX" anchor.

const RICHARDSON_LEVEL4_PRICES = {
  // Stock Headwear — Pulse / Score / R-series
  'PTS20': 8.71, 'PTS20M': 7.44, 'PTS30': 9.35, 'PTS50': 8.50, 'PTS65': 9.35, 'PTS75': 8.93,
  'R15': 2.51, 'R18': 3.40, 'R20': 3.83, 'R22': 3.61,
  'R45': 4.04, 'R55': 4.25, 'R65S': 3.61, 'R75S': 4.04,

  // 110 / 111 / 112 truckers
  '110': 6.80,
  '111': 5.95, '111P': 6.59, '111PT': 8.08, '111T': 7.44,
  '112': 5.74, '112FP': 5.74, '112FPC': 5.74, '112FPR': 5.95,
  '112LN': 6.80, '112LTD': 7.23, '112P': 7.01, '112PFP': 7.01, '112PL': 7.23,
  '112PM': 7.01, '112PT': 8.71, '112RE': 6.38, '112T': 7.44,
  '112WF': 6.80, '112WH': 8.50,

  // 113 / 115 foamie + low-pro
  '113': 5.74, '115': 5.74, '115CH': 7.01,

  // 121-149 beanies + knits
  '121': 5.31, '126': 8.50, '130': 5.10, '134': 7.01, '135': 7.01,
  '137': 3.83, '139RE': 7.65, '141': 8.50, '143': 7.86, '145': 6.16,
  '146': 4.68, '147': 5.31, '148': 7.44, '149': 5.31, '154': 10.41, '157': 8.29,

  // 160-185 performance / 7-panel
  '160': 7.44, '163': 7.86, '168': 6.38, '168P': 7.23, '169': 8.50,
  '172': 8.29, '173': 8.29, '185': 7.44,

  // 200-series snapbacks + performance
  '203': 6.38, '212': 5.10, '213': 5.74, '214': 4.89, '217': 6.38,
  '220': 6.80, '222': 7.01, '224RE': 6.59, '225': 6.80,
  '226': 7.23, '228': 7.23,
  '252': 6.38, '253': 8.93, '254RE': 7.44, '255': 5.95,
  '256': 7.86, '256P': 8.08, '257': 7.23, '258': 6.38, '262': 6.16,

  // 300-series canvas / washed
  '309': 6.80, '312': 5.95, '320T': 5.31, '323FPC': 6.16,
  '324': 5.53, '324RE': 6.16, '326': 5.53, '336': 7.01,
  '355': 8.93, '356': 5.74, '380': 7.23, '382': 6.80,

  // 400-series referee / waxed
  '420': 8.29, '435': 9.56, '436': 7.23,
  '485': 8.71, '487': 8.50, '495': 7.44,

  // 500-series umpire / surge
  '510': 7.44, '511': 7.01, '512': 7.44, '514': 7.44,
  '525': 7.65, '530': 8.29, '533': 8.93, '535': 7.65,
  '540': 8.29, '543': 8.93, '545': 7.65, '550': 8.29, '585': 8.71,

  // 600-700 performance / officials
  '632': 8.93, '633': 8.71, '634': 8.50, '643': 8.71, '653': 8.71,
  '675': 7.44, '709': 7.65, '712': 7.01, '715': 7.44,
  '733': 9.14, '740': 6.38, '743': 9.14, '753': 9.14,
  '785': 9.56, '787': 9.56,

  // 800-series brimmed / straw
  '810': 17.00, '822': 16.15, '824': 14.66, '827': 15.09, '828': 19.55,
  '835': 7.44, '843': 6.59, '862': 7.65, '865': 10.20,
  '882': 5.53, '882FP': 5.53,

  // 900-series
  '909': 18.70, '910': 20.40, '930': 6.59, '931': 7.44, '934': 7.23,
  '935': 7.44, '937': 10.20, '938': 8.29, '939': 7.01, '942': 8.50,
};

// Returns the Elite tier wholesale price for a Richardson feed style.
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
