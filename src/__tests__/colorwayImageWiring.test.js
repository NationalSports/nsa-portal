/* Wiring for the excluded-catalog garment photos, in BOTH order editors.
 *
 * SanMar/S&S/Richardson/Momentec are excluded from the in-memory `prod` catalog, so a line
 * for one of them resolved no product row and reached the Quick Mock Builder as "Not in
 * system" — reps hand-uploaded a photo the catalog already held, on every mock. The fix
 * fetches the line's own style on demand. These tests pin the parts that are easy to break
 * later and expensive to notice: the resolution ORDER, and the classic/redesign parity that
 * CLAUDE.md requires (a fix in only one file is invisible to half the users — and classic is
 * the default, so "only the new editor" means effectively nobody).
 */
const fs = require('fs');
const path = require('path');

const EDITORS = ['OrderEditorClassic.js', 'OrderEditor.js'];
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// The block of image-resolution logic both editors must carry verbatim.
const sharedBlock = (s) => {
  const start = s.indexOf('// ── Catalog photos for the API-catalog vendors');
  const end = s.indexOf('const fetchVendorImage=');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return s.slice(start, end);
};

describe.each(EDITORS)('%s — colorway image wiring', (file) => {
  const s = src(file);

  test('_itemImg prefers the local catalog row, then the colorway row, then session/live fallbacks', () => {
    const line = s.split('\n').find((l) => l.includes('const _itemImg=('));
    expect(line).toBeTruthy();
    const order = ['prd?.image_front_url', '_styleImg(it,prd)?.front', 'it._colorImage', "_vImg(it,'front')"];
    let at = -1;
    order.forEach((token) => {
      const i = line.indexOf(token);
      expect(i).toBeGreaterThan(at); // each source appears after the one that outranks it
      at = i;
    });
  });

  test('_itemBackImg mirrors that order for the back image', () => {
    const line = s.split('\n').find((l) => l.includes('const _itemBackImg=('));
    expect(line).toBeTruthy();
    const order = ['prd?.image_back_url', '_styleImg(it,prd)?.back', 'it?._colorBackImage', "_vImg(it,'back')"];
    let at = -1;
    order.forEach((token) => { const i = line.indexOf(token); expect(i).toBeGreaterThan(at); at = i; });
  });

  test('the mock builders share one back-image helper instead of redeclaring it', () => {
    // Two local `const _back=` copies per editor (four across both) was the drift risk that
    // let the classic and redesign builders disagree about where a photo comes from.
    expect(s).not.toMatch(/const _back=full=>/);
    expect(s.split('const _itemBackImg=(').length - 1).toBe(1);
  });

  test('both QuickMockBuilder call sites persist an uploaded photo and can show a spinner', () => {
    // The job-wizard builder previously had no onSaveProductImage at all, so a photo a rep
    // uploaded there was discarded on close.
    expect(s.split('onSaveProductImage={_saveGarmentProductImage}').length - 1).toBe(2);
    expect(s.split('pending:_garmentImgPending(').length - 1).toBe(2);
  });

  test('the style query is fetched through the anchored, injection-safe filter helper', () => {
    // A bare prefix ('DT630*') would return DT6300/DT6302/DT6303YG — different garments.
    expect(s).toMatch(/styleSkuOrFilter/);
    expect(s).not.toMatch(/sku\.like\.\$\{/); // never hand-built from a sku
  });

  test('a failed lookup resolves to null so the builder stops spinning', () => {
    expect(sharedBlock(s)).toMatch(/setStyleImgs\(prev=>\(\{\.\.\.prev,\[sku\]:null\}\)\)/);
  });
});

test('both editors carry byte-identical colorway logic', () => {
  const [classic, redesign] = EDITORS.map((f) => sharedBlock(src(f)));
  expect(classic).toBe(redesign);
});
