const { getSupabaseAdmin } = require('./_shared');
const { processQueuedMessage } = require('./_aiInboxProcessor');
exports.handler = async (event) => {
  const scheduled = event.headers?.['x-nf-event'] === 'schedule';
  let scheduledBody = false;
  try { scheduledBody = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const secret = process.env.GMAIL_AI_SYNC_SECRET;
  if (!scheduled && !scheduledBody && !(secret && event.headers?.['x-gmail-ai-secret'] === secret)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  try { return { statusCode: 200, body: JSON.stringify(await processQueuedMessage(getSupabaseAdmin())) }; }
  catch (error) { return { statusCode: 500, body: JSON.stringify({ error: error.message }) }; }
};
