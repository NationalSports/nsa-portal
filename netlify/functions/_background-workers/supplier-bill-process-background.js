// Authenticated 15-minute worker started by supplier-bill-process-scheduled.
// The public Netlify route is protected by a server-only internal secret; there
// is no anonymous or browser write path.
const { safeEqualStr } = require('../_shared');
const { alertCronFailure } = require('../_cronAlert');
const { runSupplierBillBacklog } = require('../_supplierBillProcessor');

const createRun = ({ runBacklog = runSupplierBillBacklog, alert = alertCronFailure } = {}) => async () => {
  try {
    const result = await runBacklog();
    console.log('[supplier-bill-background]', JSON.stringify(result));
    if (result.portal.failed || result.quickbooks.failed) {
      const error = new Error(`Supplier bill rows failed: ${JSON.stringify(result)}`);
      await alert(
        'Supplier bill background processor',
        error.message,
        'The daily supplier-bill backlog did not finish; safe rows remain leased or queued for the automatic retry.',
      );
      throw error; // a thrown background execution is retried by Netlify
    }
    if (result.time_budget_reached) throw new Error('Supplier bill backlog reached its time budget before draining');
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    // Do not convert execution failures into ordinary HTTP responses: Netlify
    // retries thrown background failures. Non-row errors still get one alert.
    if (!/Supplier bill rows failed|time budget/.test(error.message || '')) {
      await alert(
        'Supplier bill background processor',
        error.message || String(error),
        'The daily supplier-bill backlog did not finish; safe rows remain queued for the automatic retry.',
      );
    }
    throw error;
  }
};

const createHandler = (deps = {}) => {
  const run = createRun(deps);
  return async event => {
    if (event?.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
    const provided = event.headers?.['x-internal-secret'] || event.headers?.['X-Internal-Secret'];
    const expected = deps.secret || process.env.INTERNAL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!provided || !expected || !safeEqualStr(provided, expected)) {
      return { statusCode: 401, body: 'Unauthorized' };
    }
    return run(event);
  };
};

exports.createHandler = createHandler;
exports.handler = createHandler();
