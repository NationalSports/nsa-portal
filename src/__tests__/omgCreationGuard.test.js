import { acquireOmgCreationGuard, omgCollectedUnitPrice, omgInvoiceIdempotencyKey, webstoreInvoiceIdempotencyKey } from '../lib/omgCreationGuard';

describe('OMG creation idempotency',()=>{
  test('only the first synchronous caller acquires a creation key',()=>{
    const active=new Set();
    expect(acquireOmgCreationGuard(active,'OMG-sale_U4QHX')).toBe(true);
    expect(acquireOmgCreationGuard(active,'OMG-sale_U4QHX')).toBe(false);
    expect(active.size).toBe(1);
  });

  test('invoice keys are stable for retries but distinct by source',()=>{
    const so={id:'SO-2277',omg_store_id:'OMG-sale_U4QHX'};
    expect(omgInvoiceIdempotencyKey(so)).toBe('omg:OMG-sale_U4QHX');
    expect(omgInvoiceIdempotencyKey({...so,id:'SO-9999'})).toBe('omg:OMG-sale_U4QHX');
    expect(webstoreInvoiceIdempotencyKey(so)).toBe('webstore:SO-2277');
  });

  test('collected revenue, including size upcharges, determines the OMG sell',()=>{
    expect(omgCollectedUnitPrice(501,11,45)).toBeCloseTo(45.5454545);
    expect(omgCollectedUnitPrice(0,11,45)).toBe(45);
  });
});
