import { applyTaxRemittanceLedger, reversedTaxRemittanceIds, signedTaxLedgerCents } from '../lib/taxRemittanceLedger';

describe('append-only tax remittance calculations', () => {
  const source = [{ id: 'ws:store-1:CA', state: 'CA', tax: 144.15 }];
  const filing = {
    id: 'file-1', entry_type: 'remittance', source_key: 'ws:store-1:CA',
    jurisdiction: 'CA', amount_cents: 10000,
  };

  test('later collections remain outstanding after an earlier partial filing', () => {
    const [row] = applyTaxRemittanceLedger(source, [filing]);
    expect(row).toMatchObject({ collectedCents: 14415, remittedCents: 10000, outstandingCents: 4415 });
    expect(row.remitted).toBe(false);
  });

  test('a reversal offsets rather than deleting the original entry', () => {
    const reversal = { ...filing, id: 'reverse-1', entry_type: 'reversal', reversal_of: filing.id };
    const [row] = applyTaxRemittanceLedger(source, [filing, reversal]);
    expect(signedTaxLedgerCents(reversal)).toBe(-10000);
    expect(row).toMatchObject({ remittedCents: 0, outstandingCents: 14415 });
    expect(reversedTaxRemittanceIds([filing, reversal])).toEqual(new Set(['file-1']));
  });
});
