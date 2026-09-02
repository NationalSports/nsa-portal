const fs = require('fs');
const path = require('path');

const editors = [
  'OrderEditor.js',
  'OrderEditorClassic.js',
].map(name => ({
  name,
  source: fs.readFileSync(path.join(__dirname, '..', name), 'utf8'),
}));

describe.each(editors)('$name Change SKU options', ({ source }) => {
  test('passes the selected size run and price mode to catalog and live-vendor replacements', () => {
    expect(source).toMatch(/changeItemSku\(copySkuModal\.itemIdx,p,newSz,copyPrice\)/);
    expect(source).toMatch(/changeItemWithVendorResult\(copySkuModal\.itemIdx,st,c,src,newSz,copyPrice\)/);
  });

  test('applies both options after replacement product data is populated', () => {
    expect(source.match(/_applyCopySizes\(next,newSz\);_applyCopyPrice\(next,x,copyPrice\);/g)).toHaveLength(2);
  });

  test('shows customer-price and adjustable-size controls for Change SKU', () => {
    expect(source).toContain('const canNewSz=(isCopy||isReplace)&&!srcIt.qty_only;');
    expect(source).toContain('{(isCopy||isMove||isReplace)&&<div');
    expect(source).toContain("{isReplace?'Adjust sizes':'New sizes'}");
  });
});
