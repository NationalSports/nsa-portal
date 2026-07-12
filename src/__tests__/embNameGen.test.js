/* eslint-disable */
/**
 * NSA Portal — Embroidery name/number auto-generation core (embNameGen.js)
 *
 * The deterministic brain: job decorations -> ordered per-piece stitch-file plan
 * (sew order, grouped by size), CODE39-safe sew-order filenames, and a
 * change-detection fingerprint. Pure logic; no Ink/Stitch, no network.
 */

const { buildEmbNameGen, embNameGenNeeded } = require('../embNameGen');

const nameDeco = (names, method = 'embroidery') => ({ kind: 'names', name_method: method, names });
const numDeco = (roster, extra = {}) => ({ kind: 'numbers', num_method: 'embroidery', roster, ...extra });

describe('embNameGenNeeded', () => {
  test('true when an embroidery name/number roster has content', () => {
    expect(embNameGenNeeded([nameDeco({ L: ['Smith'] })])).toBe(true);
    expect(embNameGenNeeded([numDeco({ M: ['12'] })])).toBe(true);
  });
  test('false for empty rosters, non-embroidery methods, or no decos', () => {
    expect(embNameGenNeeded([nameDeco({ L: ['', '  '] })])).toBe(false);
    expect(embNameGenNeeded([nameDeco({ L: ['Smith'] }, 'heat_press')])).toBe(false);
    expect(embNameGenNeeded([numDeco({}, { num_method: 'screen_print' })])).toBe(false);
    expect(embNameGenNeeded([])).toBe(false);
    expect(embNameGenNeeded(null)).toBe(false);
  });
});

describe('buildEmbNameGen — ordering & grouping', () => {
  test('orders by SZ_ORD (S before L before 2XL), names before numbers within a size', () => {
    const decos = [
      nameDeco({ '2XL': ['Zulu'], L: ['Smith', 'Jones'], S: ['Adams'] }),
      numDeco({ L: ['12', '7'], S: ['3'], '2XL': ['99'] }),
    ];
    const { pieces } = buildEmbNameGen(decos);
    // Sizes must come out S, L, 2XL; within each, all names then all numbers.
    expect(pieces.map((p) => `${p.size}:${p.kind}:${p.text}`)).toEqual([
      'S:name:Adams', 'S:number:3',
      'L:name:Smith', 'L:name:Jones', 'L:number:12', 'L:number:7',
      '2XL:name:Zulu', '2XL:number:99',
    ]);
    // Sequence is contiguous 1..N in that exact order.
    expect(pieces.map((p) => p.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('skips empty roster slots but keeps slot index of filled ones', () => {
    const { pieces } = buildEmbNameGen([nameDeco({ L: ['Smith', '', 'Lee'] })]);
    expect(pieces.map((p) => [p.slot, p.text])).toEqual([[0, 'Smith'], [2, 'Lee']]);
    expect(pieces.map((p) => p.seq)).toEqual([1, 2]);
  });

  test('unknown sizes sort last and raise a warning', () => {
    const { pieces, warnings } = buildEmbNameGen([nameDeco({ BOGUS: ['X'], M: [' Available'] })]);
    expect(pieces.map((p) => p.size)).toEqual(['M', 'BOGUS']);
    expect(warnings.join(' ')).toMatch(/Unknown size "BOGUS"/);
  });
});

describe('buildEmbNameGen — filenames (CODE39-safe, sew-order)', () => {
  test('3-digit sew sequence + size + kind + identity; underscores/spaces become dashes', () => {
    const { pieces } = buildEmbNameGen([
      nameDeco({ L: ['Mc Smith_Jr'] }),
      numDeco({ L: ['12'] }),
    ]);
    expect(pieces[0].filename).toBe('001-L-NAME-MC-SMITH-JR');
    expect(pieces[1].filename).toBe('002-L-NUM-12');
    // No underscores anywhere (CODE39 can't encode them).
    expect(pieces.every((p) => !p.filename.includes('_'))).toBe(true);
    // Uppercase, alphanumeric + dashes only.
    expect(pieces.every((p) => /^[A-Z0-9-]+$/.test(p.filename))).toBe(true);
  });

  test('leading sequence pads so alphabetical listing == sew order past 9 pieces', () => {
    const names = Array.from({ length: 12 }, (_, i) => `P${i}`);
    const { pieces } = buildEmbNameGen([nameDeco({ L: names })]);
    const sortedByName = [...pieces].sort((a, b) => (a.filename < b.filename ? -1 : 1));
    expect(sortedByName.map((p) => p.seq)).toEqual(pieces.map((p) => p.seq)); // already in order
    expect(pieces[9].filename.startsWith('010-')).toBe(true);
  });
});

describe('buildEmbNameGen — font & size resolution', () => {
  test('numbers use their own num_size (inches) and num_font; names fall back to defaults', () => {
    const { pieces } = buildEmbNameGen(
      [nameDeco({ L: ['Smith'] }), numDeco({ L: ['12'] }, { num_size: '1.5"', num_font: 'serif' })],
      { defaultFont: 'block', defaultHeightIn: 1.25 },
    );
    const name = pieces.find((p) => p.kind === 'name');
    const num = pieces.find((p) => p.kind === 'number');
    expect(name).toMatchObject({ font: 'block', heightIn: 1.25 });
    expect(num).toMatchObject({ font: 'serif', heightIn: 1.5 });
  });

  test('embroidery number with no font defaults to block', () => {
    const { pieces } = buildEmbNameGen([numDeco({ L: ['7'] }, { num_size: '2"' })]);
    expect(pieces[0]).toMatchObject({ font: 'block', heightIn: 2 });
  });

  test('defaulted font/height are flagged per-piece AND summarized in warnings (not silent)', () => {
    const { pieces, warnings } = buildEmbNameGen([
      nameDeco({ L: ['Smith'] }), // names carry no font/size today → both defaulted
      numDeco({ L: ['12'] }, { num_size: '1"', num_font: 'serif' }), // fully specified
    ]);
    const name = pieces.find((p) => p.kind === 'name');
    const num = pieces.find((p) => p.kind === 'number');
    expect(name.fontDefaulted).toBe(true);
    expect(name.heightDefaulted).toBe(true);
    expect(num.fontDefaulted).toBeUndefined();
    expect(num.heightDefaulted).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/no font on the deco/);
    expect(warnings.join(' ')).toMatch(/no size on the deco/);
  });

  test('accented roster names keep their letters in the filename identity (José → JOSE)', () => {
    const { pieces } = buildEmbNameGen([nameDeco({ L: ['José'] })]);
    expect(pieces[0].filename).toBe('001-L-NAME-JOSE');
    expect(pieces[0].text).toBe('José'); // stitched text is untouched
  });
});

describe('buildEmbNameGen — fingerprint (change detection)', () => {
  const base = [nameDeco({ L: ['Smith', 'Jones'] }), numDeco({ L: ['12', '7'] }, { num_size: '1"' })];

  test('stable across calls for identical input', () => {
    expect(buildEmbNameGen(base).fingerprint).toBe(buildEmbNameGen(base).fingerprint);
  });
  test('changes when a name is edited, added, or the size changes', () => {
    const fp = buildEmbNameGen(base).fingerprint;
    expect(buildEmbNameGen([nameDeco({ L: ['Smyth', 'Jones'] }), base[1]]).fingerprint).not.toBe(fp); // spelling
    expect(buildEmbNameGen([nameDeco({ L: ['Smith', 'Jones', 'Lee'] }), base[1]]).fingerprint).not.toBe(fp); // added player
    expect(buildEmbNameGen([base[0], numDeco({ L: ['12', '7'] }, { num_size: '2"' })]).fingerprint).not.toBe(fp); // size
  });
  test('ignores non-embroidery decos entirely', () => {
    const withHeatPress = [...base, nameDeco({ L: ['Ignored'] }, 'heat_press')];
    expect(buildEmbNameGen(withHeatPress).fingerprint).toBe(buildEmbNameGen(base).fingerprint);
  });
});
