const { corsHeaders, verifyUser } = require('./_shared');
const { getAccessToken, createReplyDraft } = require('./_gmailAi');
const { cartPayloadForMessage, newTodoId } = require('./_repEmailAgent');

const MAX_BODY_BYTES = 14 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 9 * 1024 * 1024;

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (Buffer.byteLength(event.body || '', 'utf8') > MAX_BODY_BYTES) {
    return { statusCode: 413, headers, body: JSON.stringify({ error: 'Draft payload is too large' }) };
  }

  const verified = await verifyUser(event);
  if (!verified.ok) {
    return { statusCode: verified.status, headers, body: JSON.stringify({ error: verified.error }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    if (!body.action || !body.inbox_message_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'action and inbox_message_id are required' }) };
    }

    const { data: message, error } = await verified.admin
      .from('ai_inbox_messages')
      .select('*')
      .eq('id', body.inbox_message_id)
      .maybeSingle();
    if (error) throw error;
    if (!message) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Inbox message not found' }) };

    if (body.action === 'queue_cart') {
      if (!['rep', 'admin', 'super_admin'].includes(String(verified.role || '').toLowerCase())) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'A rep or admin must approve cart commands' }) };
      }
      if (!message.is_rep_command) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Only verified rep-forwarded messages can queue cart work' }) };
      }
      if (!message.customer_id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Match the command to a customer before queuing the cart' }) };
      }
      if (message.command_task_id) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ ok: true, task_id: message.command_task_id, already_queued: true }),
        };
      }

      const payload = cartPayloadForMessage(message);
      const todoId = newTodoId();
      const lineLabel = `${payload.totals.line_count} item${payload.totals.line_count === 1 ? '' : 's'} · ${payload.totals.qty} pcs`;
      const sourceLabel = payload.source_estimate_id
        ? ` from ${payload.source_estimate_id}`
        : '';
      const todo = {
        id: todoId,
        title: `Email command: add ${lineLabel}${sourceLabel} to Adidas CLICK cart`,
        description: `Approved in AI Inbox by ${verified.teamMemberId}. Fill the Adidas CLICK cart from the reviewed structured lines. Do not submit or check out. ${payload.po_number ? `Enter PO ${payload.po_number}.` : 'No PO has been issued; leave the Customer PO field blank.'}`,
        created_by: verified.teamMemberId,
        assigned_to: 'bot-claude',
        so_id: payload.source_so_id,
        customer_id: message.customer_id,
        po_id: payload.po_number,
        priority: 1,
        status: 'open',
        source: 'ai_email',
        bot_status: 'queued',
        bot_payload: payload,
      };
      const { error: taskError } = await verified.admin.from('assigned_todos').insert(todo);
      if (taskError) {
        if (taskError.code === '23505') {
          const { data: existing } = await verified.admin
            .from('assigned_todos')
            .select('id')
            .contains('bot_payload', { source_inbox_message_id: message.id })
            .limit(1)
            .maybeSingle();
          if (existing?.id) {
            await verified.admin.from('ai_inbox_messages').update({
              command_status: 'queued',
              command_task_id: existing.id,
              reviewed_by: verified.teamMemberId,
              reviewed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq('id', message.id);
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({ ok: true, task_id: existing.id, already_queued: true }),
            };
          }
        }
        throw taskError;
      }

      const now = new Date().toISOString();
      const { error: commandUpdateError } = await verified.admin.from('ai_inbox_messages').update({
        command_status: 'queued',
        command_task_id: todoId,
        reviewed_by: verified.teamMemberId,
        reviewed_at: now,
        updated_at: now,
      }).eq('id', message.id);
      if (commandUpdateError) throw commandUpdateError;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, task_id: todoId }),
      };
    }

    if (body.action !== 'create_draft') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unsupported action' }) };
    }
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const totalBytes = attachments.reduce((sum, a) => sum + Math.ceil(String(a?.content || '').length * 0.75), 0);
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      return { statusCode: 413, headers, body: JSON.stringify({ error: 'Attachments exceed the 9 MB draft limit' }) };
    }

    const token = await getAccessToken();
    const draft = await createReplyDraft(token, message, {
      subject: body.subject || message.draft_subject || message.subject,
      text: body.text || message.draft_body_text || '',
      html: body.html || message.draft_body_html || '',
      attachments,
    });

    const now = new Date().toISOString();
    const { error: updateError } = await verified.admin
      .from('ai_inbox_messages')
      .update({
        gmail_draft_id: draft.id,
        draft_subject: body.subject || message.draft_subject,
        draft_body_text: body.text || message.draft_body_text,
        draft_body_html: body.html || message.draft_body_html,
        status: 'draft_created',
        reviewed_by: verified.teamMemberId,
        reviewed_at: now,
        updated_at: now,
        error_message: null,
      })
      .eq('id', message.id);
    if (updateError) throw updateError;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, draft_id: draft.id, gmail_thread_id: message.gmail_thread_id }),
    };
  } catch (error) {
    console.error('[gmail-ai-action]', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
