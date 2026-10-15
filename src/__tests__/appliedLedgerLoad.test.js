// Bill History and the QuickBooks backfill read the applied_bills ledger. Each row
// carries ~11KB of raw_meta, so 1,000-row pages hit the 8s statement timeout and the
// whole load failed silently (2026-10-15: Andrea saw 2 bills waiting, the ledger had 105).
import fs from 'fs';
import path from 'path';

const APP = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const loader = APP.slice(APP.indexOf('const loadAppliedLedger=async()=>{'), APP.indexOf('const loadAppliedLedger=async()=>{') + 3000);

describe('applied bills ledger load', () => {
  it('pages the ledger in small pages and retries each page', () => {
    expect(loader).toContain('const PAGE=200;');
    expect(loader).toContain(".from('applied_bills').select('*')");
    expect(loader).toContain('.range(from,from+PAGE-1)');
    expect(loader).toContain('attempt<3');
    expect(loader).not.toContain('from+999');
  });
  it('tells the user when the ledger cannot load instead of failing silently', () => {
    expect(loader).toMatch(/catch\(e\)\{_appliedLedgerLoaded\.current=false;console\.warn\([^)]*\);nf\('Bill history could not load/);
  });
});
