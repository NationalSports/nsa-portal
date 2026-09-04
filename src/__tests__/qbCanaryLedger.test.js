import {
  durableQbCanaryBillIds,
  mergeDurableQbCanaries,
  qbCanaryLedgerKey,
  qbCanaryLedgerRecord,
} from '../qbCanaryLedger';

describe('QuickBooks durable canary ledger', () => {
  test('builds one collision-safe app-state row per realm and bill', () => {
    expect(qbCanaryLedgerKey('9341456492604246', '385')).toBe('_qb_canary_bill_9341456492604246_385');
    const row = qbCanaryLedgerRecord({
      realmId: '9341456492604246', qboBillId: 385, sourceId: 'srv-2021',
      docNumber: '100404449', verifiedAt: '2026-09-04T16:00:00.000Z',
    });
    expect(JSON.parse(row.value)).toEqual({
      realm_id: '9341456492604246', qbo_bill_id: '385', source_id: 'srv-2021',
      doc_number: '100404449', verified_at: '2026-09-04T16:00:00.000Z',
    });
  });

  test('hydrates only verified canaries from the connected realm', () => {
    const appState = {
      _qb_canary_bill_111_1: {realm_id: '111', qbo_bill_id: '1', verified_at: '2026-09-04T16:00:00Z'},
      _qb_canary_bill_111_2: {realm_id: '111', qbo_bill_id: '2'},
      _qb_canary_bill_222_3: {realm_id: '222', qbo_bill_id: '3', verified_at: '2026-09-04T16:00:00Z'},
    };
    expect(durableQbCanaryBillIds(appState, '111')).toEqual(['1']);
  });

  test('merges durable rows with legacy in-blob IDs without duplicates', () => {
    const config = {realm_id: '111', _qbCanaryBillIds: ['1']};
    const appState = {
      _qb_canary_bill_111_1: {realm_id: '111', qbo_bill_id: '1', verified_at: '2026-09-04T16:00:00Z'},
      _qb_canary_bill_111_2: {realm_id: '111', qbo_bill_id: '2', verified_at: '2026-09-04T16:01:00Z'},
    };
    expect(mergeDurableQbCanaries(config, appState)._qbCanaryBillIds).toEqual(['1', '2']);
  });
});
