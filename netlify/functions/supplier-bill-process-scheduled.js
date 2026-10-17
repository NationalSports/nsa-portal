// Private Netlify scheduled function: scheduled functions have no production URL,
// so this financial worker cannot be invoked anonymously. Staff keep using the
// existing authenticated browser flow; both paths share database/QBO leases.
const { withCronAlert } = require('./_cronAlert');
const { runSupplierBillProcessor } = require('./_supplierBillProcessor');

exports.handler = withCronAlert(
  'Supplier bill processor',
  'Exact supplier bills are not applying costs or reaching QuickBooks automatically; review bills remain safely queued.',
  async () => {
    const result = await runSupplierBillProcessor();
    console.log('[supplier-bill-process]', JSON.stringify(result));
    if (result.portal.failed || result.quickbooks.failed) {
      return { statusCode: 500, body: JSON.stringify(result) };
    }
    return { statusCode: 200, body: JSON.stringify(result) };
  },
);
