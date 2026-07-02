// Momentec order payload — recipient name on the ship-to address.
// Momentec's spec requires firstName or lastName on every order address; orders sent
// with both blank land nameless in their system (July 2026 support inquiry #MC0CEA).
import { buildMomentecOrderPayload, buildMomentecOrderLines } from '../momentecOrder';

const LINE = { key: '790|080|S', style: '790', color: '080', size: 'S', sku: '790.080.S', quantity: 2, unitPrice: 5 };

const addr = (shipTo) => buildMomentecOrderPayload({ poNumber: 'NSA 1', lineItems: [LINE], shipTo }).order.addresses[0];

describe('buildMomentecOrderPayload recipient name', () => {
  test('passes explicit firstName/lastName through', () => {
    const a = addr({ companyName: 'National Sports Apparel', attentionTo: 'Receiving', firstName: 'NSA', lastName: 'Receiving' });
    expect(a.firstName).toBe('NSA');
    expect(a.lastName).toBe('Receiving');
  });

  test('splits a multi-word attention into first/last when no explicit name', () => {
    const a = addr({ companyName: 'Acme Deco', attentionTo: 'Mary Jane Watson' });
    expect(a.firstName).toBe('Mary Jane');
    expect(a.lastName).toBe('Watson');
  });

  test('falls back to company name when attention is a single word', () => {
    const a = addr({ companyName: 'National Sports Apparel', attentionTo: 'Receiving' });
    expect(a.firstName).toBe('');
    expect(a.lastName).toBe('National Sports Apparel');
  });

  test('never sends both name fields blank when any name info exists', () => {
    const a = addr({ companyName: '', attentionTo: 'Receiving' });
    expect(a.firstName || a.lastName).toBeTruthy();
  });

  test('keeps shipTo (company) and attention mapped as before', () => {
    const a = addr({ companyName: 'National Sports Apparel', attentionTo: 'Receiving', address1: '210 E Emerson Ave' });
    expect(a.shipTo).toBe('National Sports Apparel');
    expect(a.attention).toBe('Receiving');
    expect(a.shipAddress1).toBe('210 E Emerson Ave');
  });
});

describe('buildMomentecOrderLines SKU stamping', () => {
  test('uses the stamped per-size SKU when present', () => {
    const { lines, warnings } = buildMomentecOrderLines([{
      so_id: 'SO-1', items: [{ sku: '510000', _mt_style: '510000', _mt_color: 'F006', _mt_sku: '510000.F006', _mt_skus: { S: '510000.F006.S', M: '510000.F006.M' }, sizes: { S: 2, M: 3 } }],
    }]);
    expect(lines.map(l => l.sku)).toEqual(['510000.F006.S', '510000.F006.M']);
    expect(warnings).toHaveLength(0);
  });

  test('leaves the SKU blank (never the size-less colorway) when a size has no stamped SKU', () => {
    // A size-less _mt_sku fallback ("510000.F006") is an invalid order SKU AND skips the
    // order modal's live resolution + missing-SKU submit block.
    const { lines, warnings } = buildMomentecOrderLines([{
      so_id: 'SO-1', items: [{ sku: '510000', _mt_style: '510000', _mt_sku: '510000.F006', _mt_skus: { S: '510000.F006.S' }, sizes: { S: 1, '2XL': 2 } }],
    }]);
    const bad = lines.find(l => l.size === '2XL');
    expect(bad.sku).toBe('');
    expect(warnings).toHaveLength(1);
  });
});
