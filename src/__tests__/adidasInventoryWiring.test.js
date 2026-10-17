import fs from 'fs';
import path from 'path';

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('App uses successful-run freshness with row timestamp fallback', () => {
  const source = read('App.js');
  expect(source).toContain("from('adidas_inventory_freshness').select('source,last_success_at')");
  expect(source).toContain("if(freshness['api-materials'])return freshness['api-materials']");
  expect(source).toContain("from('adidas_inventory').select('last_synced')");
});

test('classic and redesigned order screens use the same normalized size lookup', () => {
  for (const file of ['OrderEditor.js', 'OrderEditorClassic.js']) {
    const source = read(file);
    expect(source).toContain("import { adidasInventorySizeEntry } from './lib/adidasInventory'");
    expect(source).toContain('const cell=adidasInventorySizeEntry(ai.sizes,sz)');
    expect(source).not.toContain('const cell=ai.sizes?.[sz]');
  }
});
