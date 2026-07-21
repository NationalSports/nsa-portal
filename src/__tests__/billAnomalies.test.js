// Shared supplier-bill anomaly rules — the post-push review net (client pill,
// ledger resolution.flags, and the daily anomaly email all use these).
const { billAnomalyFlags, isAdidasUaVendor } = require('../lib/billAnomalies');

const codes = (p) => billAnomalyFlags(p).map((f) => f.code);

describe('isAdidasUaVendor', () => {
  it('matches the adidas/UA family, licensees included', () => {
    ['ADIDAS US TEAM SERVICES', 'AGRON INC.', 'UNDER ARMOUR', 'BADGER FOR UNDER ARMOUR', 'POWERS MANUFACTURING UA', 'adidas'].forEach((v) => expect(isAdidasUaVendor(v)).toBe(true));
  });
  it('leaves other vendors alone (UA must be a standalone word)', () => {
    ['SANMAR', 'RICHARDSON CAP CO', 'S&S Activewear', 'AUGUSTA SPORTSWEAR/ASI', 'QUAKER CITY', ''].forEach((v) => expect(isAdidasUaVendor(v)).toBe(false));
  });
});

describe('freight >10% of merchandise (adidas/UA only)', () => {
  it('flags adidas freight above the cap and reports the percentage', () => {
    const fl = billAnomalyFlags({ vendor: 'ADIDAS US TEAM SERVICES', merchandise_total: 1000, freight: 150, doc_total: 1150 });
    expect(fl.map((f) => f.code)).toEqual(['freight_gt10']);
    expect(fl[0].detail).toContain('15%');
  });
  it('does not flag at or under the cap, non-adidas/UA vendors, or $0 freight', () => {
    expect(codes({ vendor: 'UNDER ARMOUR', merchandise_total: 1000, freight: 100, doc_total: 1100 })).toEqual([]); // exactly 10% = ok
    expect(codes({ vendor: 'SANMAR', merchandise_total: 100, freight: 40, doc_total: 140 })).toEqual([]);          // rule is adidas/UA only
    expect(codes({ vendor: 'AGRON INC.', merchandise_total: 1000, freight: 0, doc_total: 1000 })).toEqual([]);
  });
  it('falls back to doc_total - freight - upcharge when merchandise_total is missing', () => {
    expect(codes({ vendor: 'UNDER ARMOUR', freight: 200, si_upcharge: 0, doc_total: 1200 })).toEqual(['freight_gt10']); // merch=1000
  });
});

describe('sharp price / overage / total mismatch', () => {
  it('flags billed unit prices >25% off the order cost, naming the worst line', () => {
    const fl = billAnomalyFlags({ vendor: 'SANMAR', _lineMappings: [
      { sku: 'A1', unit_cost: 41.25, bill_unit: 111.37 },
      { sku: 'A2', unit_cost: 10, bill_unit: 10.5 }, // 5% — fine
    ] });
    expect(fl.map((f) => f.code)).toEqual(['sharp_price']);
    expect(fl[0].detail).toContain('A1');
  });
  it('flags approved overage pushes for after-the-fact review', () => {
    expect(codes({ vendor: 'SANMAR', _overage_ok: true })).toEqual(['overage']);
  });
  it('flags a document total that does not equal lines + freight + upcharge', () => {
    expect(codes({ vendor: 'SANMAR', merchandise_total: 500, freight: 20, si_upcharge: 5, doc_total: 600 })).toEqual(['total_mismatch']);
    expect(codes({ vendor: 'SANMAR', merchandise_total: 500, freight: 20, si_upcharge: 5, doc_total: 525 })).toEqual([]);
  });
  it('a clean bill raises nothing; a bad one can stack flags', () => {
    expect(codes({ vendor: 'ADIDAS US TEAM SERVICES', merchandise_total: 1000, freight: 50, doc_total: 1050 })).toEqual([]);
    expect(codes({ vendor: 'ADIDAS US TEAM SERVICES', merchandise_total: 1000, freight: 300, doc_total: 2000, _overage_ok: true })).toEqual(['freight_gt10', 'overage', 'total_mismatch']);
  });
  it('handles garbage without throwing', () => {
    expect(billAnomalyFlags(null)).toEqual([]);
    expect(billAnomalyFlags({})).toEqual([]);
    expect(codes({ vendor: 'UNDER ARMOUR', merchandise_total: 'abc', freight: 'x', doc_total: null })).toEqual([]);
  });
});
