const { analyzeEmail } = require('./gmail-ai-sync');
const { resolvePortalContext, findAuthorizedRep, extractForwardedMessage } = require('./_repEmailAgent');

async function processQueuedMessage(admin) {
  const { data: rows, error } = await admin.from('ai_inbox_messages')
    .select('*').eq('status', 'queued').order('received_at', { ascending: true }).limit(1);
  if (error) throw error;
  const message = rows?.[0];
  if (!message) return { processed: 0 };
  const { data: claim, error: claimError } = await admin.from('ai_inbox_messages')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', message.id).eq('status', 'queued').select('id').maybeSingle();
  if (claimError) throw claimError;
  if (!claim) return { processed: 0 };
  try {
    let context = null;
    if (message.source_channel === 'webstore') {
      const { data: order, error: orderError } = await admin.from('webstore_orders')
        .select('id,store_id,so_id,buyer_name,status,omg_order_number').eq('id', message.webstore_order_id).single();
      if (orderError) throw orderError;
      const { data: store } = await admin.from('webstores').select('id,name').eq('id', order.store_id).maybeSingle();
      context = { webstore_order: order, webstore: store };
    }
    let repContext = context ? { portal_context: context } : null;
    if (message.is_rep_command) {
      const rep = await findAuthorizedRep(admin, message.sender_email);
      if (!rep) throw new Error('Request sender is no longer an active rep');
      const forwarded = extractForwardedMessage(message.text_body);
      context = await resolvePortalContext(admin, forwarded);
      repContext = { ...forwarded, rep, portal_context: context };
    }
    const analysis = await analyzeEmail(message, repContext);
    const { error: saveError } = await admin.from('ai_inbox_messages').update({
      status: 'needs_review', intent: analysis.intent, needs_estimate: analysis.needs_estimate,
      analysis: { ...analysis, portal_context: context }, stock_checks: analysis.stock_checks || [],
      draft_subject: analysis.draft?.subject, draft_body_text: analysis.draft?.text,
      draft_body_html: analysis.draft?.html, error_message: null,
      command_type: message.is_rep_command ? analysis.command?.type : null,
      command_payload: message.is_rep_command ? analysis.command || {} : {},
      processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', message.id);
    if (saveError) throw saveError;
    return { processed: 1 };
  } catch (error) {
    await admin.from('ai_inbox_messages').update({ status: 'failed', error_message: error.message,
      updated_at: new Date().toISOString() }).eq('id', message.id);
    throw error;
  }
}
module.exports = { processQueuedMessage };
