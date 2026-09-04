import fs from 'fs';
import path from 'path';

describe('data-loss alert classification', () => {
  const appSource=fs.readFileSync(path.join(__dirname,'..','App.js'),'utf8');

  test('verified and pre-verification item shrink observations are audit-only', () => {
    expect(appSource).toContain("if(kind==='hydrated_shrink'||kind==='lost')");
    expect(appSource).toContain("kind==='hydrated_shrink'?'items_removed_verified':'item_shrink_observed'");

    const auditOnlyBranch=appSource.match(/if\(kind==='hydrated_shrink'\|\|kind==='lost'\)\{([\s\S]*?)\n\s*\}/)?.[1]||'';
    expect(auditOnlyBranch).toContain('logChange(');
    expect(auditOnlyBranch).toContain('return;');
    expect(auditOnlyBranch).not.toContain('sendBrevoEmail');
  });

  test('the generic Items lost email remains after the audit-only return', () => {
    const auditOnlyAt=appSource.indexOf("if(kind==='hydrated_shrink'||kind==='lost')");
    const genericEmailAt=appSource.indexOf("'🚨 NSA Portal — Items lost on '");
    expect(auditOnlyAt).toBeGreaterThan(-1);
    expect(genericEmailAt).toBeGreaterThan(auditOnlyAt);
  });
});
