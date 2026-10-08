// Only canonical sequence IDs participate in minting. Eight-digit date-like IDs
// and test IDs already exist in the table, but must not advance the sequence.
export const salesOrderSequenceNumber = id => {
  const match = /^SO-([0-9]{4,7})$/.exec(String(id || ''));
  return match ? Number(match[1]) : 0;
};

export const nextSalesOrderId = (orders, dbMax = 0) => {
  const localMax = (orders || []).reduce((max, order) => Math.max(max, salesOrderSequenceNumber(order?.id)), 0);
  return 'SO-' + (Math.max(localMax, salesOrderSequenceNumber('SO-' + dbMax), 1000) + 1);
};
