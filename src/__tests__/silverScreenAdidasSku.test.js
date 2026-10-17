// The adidas article swap in netlify/functions/silverscreen-job.js.
//
// We buy adidas Team goods through S&S under S&S style numbers (AT101-50); S&S ships
// them without re-tagging, so the garment reaching Silver Screen carries adidas' own
// article number (JX4452). Sending our purchase style meant their packing slip never
// matched the tag and packers could not confirm a piece was right (Trinity Lyle,
// 2026-08-25). These tests lock in the three properties that make the fix safe:
//
//   • only KNOWN adidas styles are rewritten — non-adidas goods and adidas styles with
//     no catalogued counterpart keep their own SKU, so nothing is silently renamed;
//   • the S&S style survives on the job sheet, so the line still ties back to our PO
//     and to Silver Screen's invoice;
//   • a cross-reference lookup failure is NOT fatal — the job still goes out with S&S
//     numbers exactly as it did before, rather than the send dying on a dependency.
//
// Same harness as silverScreenBillParser.test.js: run the real module source with a
// stubbed require, so the function file needs no test-only exports.
const fs = require('fs');
const path = require('path');

const FN = path.join(__dirname, '..', '..', 'netlify', 'functions', 'silverscreen-job.js');

// Loads the module with ./_shared stubbed, and hands back the two internals under test.
function loadFn(xrefResult) {
  const src = fs.readFileSync(FN, 'utf8');
  const shared = {
    corsHeaders: () => ({}),
    verifyUser: async () => ({}),
    getSupabaseAdmin: () => ({
      from: () => {
        const q = {
          select: () => q, eq: () => q, in: () => q,
          then: (res) => Promise.resolve(xrefResult).then(res)
        };
        return q;
      }
    })
  };
  const shimRequire = (id) => (id === './_shared' ? shared : require(id));
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', '__filename', '__dirname',
    src + '\nmodule.exports.__test = { applyAdidasArticles, buildJobSheet };')
    (mod, mod.exports, shimRequire, FN, path.dirname(FN));
  return mod.exports.__test;
}

const XREF_OK = { data: [
  { ss_sku: 'AT101-50', adidas_article: 'JX4452' },   // Pregame tee, black
  { ss_sku: 'AT104-50', adidas_article: 'JX4476' }    // Pregame LS, black
], error: null };

const body = () => ({
  po: { po_id: 'DPO 3516 OLuST', deco_type: 'screen_print', qty: 5 },
  items: [
    { sku: 'AT101-50', name: "Men's Pregame T-Shirt", color: 'Black/ White', sizes: { M: 1, L: 1 }, qty: 2 },
    { sku: 'AT104-50', name: 'Pregame Long Sleeve', color: 'Black/ White', sizes: { L: 1 }, qty: 1 },
    { sku: 'PC61', name: 'Port & Company Tee', color: 'Red', sizes: { M: 1 }, qty: 1 },
    { sku: 'AT999-99', name: 'Uncatalogued adidas', color: 'Black', sizes: { S: 1 }, qty: 1 }
  ],
  deco_instructions: [{ sku: 'AT101-50', position: 'Full Front', type: 'screen_print', notes: '2 color' }]
});

describe('Silver Screen job — adidas article numbers', () => {
  test('rewrites S&S styles to the adidas article printed on the tag', async () => {
    const { applyAdidasArticles } = loadFn(XREF_OK);
    const b = body();
    await applyAdidasArticles(b, {});
    expect(b.items[0].sku).toBe('JX4452');
    expect(b.items[1].sku).toBe('JX4476');
  });

  test('keeps the S&S style alongside it, so the line still ties back to our PO', async () => {
    const { applyAdidasArticles } = loadFn(XREF_OK);
    const b = body();
    await applyAdidasArticles(b, {});
    expect(b.items[0].ss_sku).toBe('AT101-50');
  });

  test('leaves non-adidas goods and uncatalogued styles untouched', async () => {
    const { applyAdidasArticles } = loadFn(XREF_OK);
    const b = body();
    await applyAdidasArticles(b, {});
    expect(b.items[2].sku).toBe('PC61');
    expect(b.items[2].ss_sku).toBeUndefined();
    expect(b.items[3].sku).toBe('AT999-99');
    expect(b.items[3].ss_sku).toBeUndefined();
  });

  test('rewrites the decoration instructions too, so they cite the same number', async () => {
    const { applyAdidasArticles } = loadFn(XREF_OK);
    const b = body();
    await applyAdidasArticles(b, {});
    expect(b.deco_instructions[0].sku).toBe('JX4452');
  });

  test('a cross-reference failure still sends the job, on S&S numbers', async () => {
    const { applyAdidasArticles } = loadFn({ data: null, error: { message: 'relation missing' } });
    const b = body();
    const diag = {};
    await applyAdidasArticles(b, diag);
    expect(b.items[0].sku).toBe('AT101-50');
    expect(diag.skuXref).toMatch(/lookup failed/);
  });

  test('no matches is a clean no-op', async () => {
    const { applyAdidasArticles } = loadFn({ data: [], error: null });
    const b = body();
    const diag = {};
    await applyAdidasArticles(b, diag);
    expect(b.items[0].sku).toBe('AT101-50');
    expect(diag.skuXref).toBeUndefined();
  });

  test('the job sheet shows both numbers and says which is which', async () => {
    const { applyAdidasArticles, buildJobSheet } = loadFn(XREF_OK);
    const b = body();
    await applyAdidasArticles(b, {});
    const sheet = buildJobSheet(b);
    expect(sheet).toContain('JX4452 (S&S AT101-50)');
    expect(sheet).toMatch(/adidas article numbers printed on the garment tags/);
    // A line we did not rewrite must not gain a bracket implying a cross-reference.
    expect(sheet).toContain('PC61 — Port & Company Tee');
    expect(sheet).not.toContain('PC61 (S&S');
  });
});
