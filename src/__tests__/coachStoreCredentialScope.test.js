const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(
  __dirname, '..', '..', 'supabase', 'functions', 'coach-store-submit', 'index.ts'
), 'utf8');

describe('coach-store-submit credential scope', () => {
  test('resolves domain-separated hash-only credentials and fails closed after migration', () => {
    expect(source).toContain('portal_access_credentials');
    expect(source).toContain('portal-token-v1:');
    expect(source).toContain('portal-legacy-v1:');
    expect(source).toContain('code === "PGRST205"');
    expect(source).not.toContain('code === "PGRST204"');
  });

  test('checks the target customer against the resolved family before creating a store', () => {
    const scopeCheck = source.indexOf('family.familyIds?.includes(customerId)');
    const insert = source.indexOf('.from("webstores").insert(storeRow)');
    expect(scopeCheck).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(scopeCheck);
    expect(source).not.toContain('str(cust.alpha_tag).toLowerCase() !== alphaTag.toLowerCase()');
  });
});
