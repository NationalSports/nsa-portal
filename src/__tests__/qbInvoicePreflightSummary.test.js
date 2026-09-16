import { summarizeQBInvoicePreflight } from '../qbInvoiceSyncGuard';

describe('invoice preflight review gate', () => {
  const aliases = [
    {documentNumber:'INV-63133', action:'link_existing'},
    {documentNumber:'INV-63199', action:'already_synced'},
    {documentNumber:'INV-63255', action:'link_existing'},
  ];

  test('ready invoices unlock human review but do not pass unattended acceptance', () => {
    expect(summarizeQBInvoicePreflight([{action:'ready'}], aliases)).toEqual(expect.objectContaining({
      proposedCount:1,
      safeToReview:true,
      passed:false,
    }));
  });

  test.each(['blocked', 'manual_review'])('%s rows keep every write control locked', action => {
    expect(summarizeQBInvoicePreflight([{action}], aliases)).toEqual(expect.objectContaining({
      safeToReview:false,
      passed:false,
    }));
  });

  test('alias failures keep every write control locked', () => {
    expect(summarizeQBInvoicePreflight([], [...aliases, {documentNumber:'INV-9', action:'source_not_found'}]))
      .toEqual(expect.objectContaining({safeToReview:false, passed:false}));
  });
});
