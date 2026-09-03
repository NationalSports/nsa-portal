const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(path.join(
  __dirname, '..', '..', 'supabase', 'migrations', '20260902194313_preserve_invoiced_line_identity.sql',
), 'utf8');
const constants = fs.readFileSync(path.join(__dirname, '..', 'constants.js'), 'utf8');

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

  test('retains invoice identity on an in-place change but strips it from all copy flows', () => {
    expect(source.match(/next\.invoice_line_keys=\[\.\.\.new Set/g)).toHaveLength(2);
    expect(source.match(/delete clone\.invoice_line_keys/g)).toHaveLength(3);
  });
});

test('the durable invoice identity field is persisted by an additive constrained migration', () => {
  expect(constants).toMatch(/export const _soItemCols=\[[^;]*'invoice_line_keys'\]/);
  expect(migration).toMatch(/alter table public\.so_items[\s\S]*add column if not exists invoice_line_keys jsonb not null default '\[\]'::jsonb/i);
  expect(migration).toMatch(/check \(jsonb_typeof\(invoice_line_keys\) = 'array'\)/i);
  expect(migration).toMatch(/where so_id = 'SO-2245'[\s\S]*and item_index = 1[\s\S]*and sku = 'LH0083'[\s\S]*jsonb_build_array\('A1005\|White\|1'\)/i);
});
