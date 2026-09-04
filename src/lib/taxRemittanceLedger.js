const cents = (value) => Math.round((Number(value) || 0) * 100);

export const taxLedgerKey = (sourceKey, jurisdiction) =>
  String(sourceKey || '') + '|' + String(jurisdiction || '').toUpperCase();

export const signedTaxLedgerCents = (entry) => {
  const amount = Number(entry?.amount_cents) || 0;
  return entry?.entry_type === 'reversal' ? -amount : amount;
};

// The source report is cumulative. Subtracting signed append-only entries keeps
// later collections outstanding even when an earlier filing covered the same
// store/state combination.
export const applyTaxRemittanceLedger = (rows, entries) => {
  const filedByKey = new Map();
  (entries || []).forEach((entry) => {
    const key = taxLedgerKey(entry.source_key, entry.jurisdiction);
    filedByKey.set(key, (filedByKey.get(key) || 0) + signedTaxLedgerCents(entry));
  });
  return (rows || []).map((row) => {
    const collectedCents = cents(row.tax);
    const remittedCents = filedByKey.get(taxLedgerKey(row.id, row.state)) || 0;
    const outstandingCents = collectedCents - remittedCents;
    return {
      ...row,
      collectedCents,
      remittedCents,
      outstandingCents,
      remitted: remittedCents > 0 && outstandingCents <= 0,
      remittedAmount: remittedCents / 100,
      outstanding: outstandingCents / 100,
    };
  });
};

export const reversedTaxRemittanceIds = (entries) => new Set(
  (entries || []).filter((entry) => entry.entry_type === 'reversal' && entry.reversal_of)
    .map((entry) => entry.reversal_of),
);
