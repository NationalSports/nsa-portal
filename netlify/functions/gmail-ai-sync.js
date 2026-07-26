const { getSupabaseAdmin } = require('./_shared');
const { getAccessToken, listInboxMessages, getMessage, parseMessage, sendReply } = require('./_gmailAi');
const {
  extractForwardedMessage,
  findAuthorizedRep,
  resolvePortalContext,
} = require('./_repEmailAgent');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function isAuthorizedRun(event) {
  const scheduled = String(event.headers?.['x-nf-event'] || '').toLowerCase() === 'schedule';
  let scheduledBody = false;
  try { scheduledBody = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const expected = process.env.GMAIL_AI_SYNC_SECRET;
  const supplied = event.headers?.['x-gmail-ai-secret'] || event.queryStringParameters?.secret;
  return scheduled || scheduledBody || (!!expected && supplied === expected);
}

async function findCustomer(admin, email) {
  if (!email) return null;
  const { data } = await admin
    .from('customer_contacts')
    .select('customer_id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle();
  return data?.customer_id || null;
}

async function analyzeEmail(message, repContext = null) {
  const sbUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${sbUrl}/functions/v1/ai-email-assistant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
    },
    body: JSON.stringify({
      subject: repContext?.original_subject || message.subject,
      text: repContext?.original_body || message.text_body,
      rep_command: repContext ? {
        instruction: repContext.instruction,
        submitted_by: repContext.rep,
      } : null,
      portal_context: repContext?.portal_context || null,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `AI assistant HTTP ${response.status}`);
  }
  return data;
}

function portalTaskUrl(messageId) {
  const configured = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://nsa-portal.netlify.app';
  const url = new URL(configured);
  url.search = '';
  url.hash = '';
  url.searchParams.set('pg', 'ai_tasks');
  if (messageId) url.searchParams.set('request', messageId);
  return url.toString();
}

async function sendRepAcknowledgement(admin, token, parsed, inserted, forwarded) {
  const taskUrl = portalTaskUrl(inserted.id);
  const instruction = String(forwarded.instruction || '').trim().slice(0, 1000);
  const text = [
    'We received your AI request and started processing it.',
    '',
    instruction ? `Request: ${instruction}` : 'Request: Review the forwarded customer email.',
    '',
    'Open AI Tasks in Connect to follow the request, review matched records, and approve any cart work:',
    taskUrl,
    '',
    'Nothing will be emailed to the customer or ordered from a vendor automatically.',
    '',
    'National Sports Apparel',
  ].join('\n');
  const escapedInstruction = (instruction || 'Review the forwarded customer email.')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#1f2937">
    <p>We received your AI request and started processing it.</p>
    <p><strong>Request:</strong> ${escapedInstruction}</p>
    <p><a href="${taskUrl}" style="display:inline-block;padding:10px 16px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Open AI Tasks in Connect</a></p>
    <p style="font-size:13px;color:#64748b">Nothing will be emailed to the customer or ordered from a vendor automatically.</p>
    <p>National Sports Apparel</p>
  </div>`;
  try {
    const sent = await sendReply(token, parsed, {
      to: parsed.sender_email,
      subject: parsed.subject,
      text,
      html,
      attachments: [],
    });
    await admin.from('ai_inbox_messages').update({
      acknowledgement_sent_at: new Date().toISOString(),
      acknowledgement_message_id: sent.id || null,
      acknowledgement_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', inserted.id);
  } catch (error) {
    // Acknowledgement delivery is helpful but must never prevent analysis.
    await admin.from('ai_inbox_messages').update({
      acknowledgement_error: String(error.message || error).slice(0, 2000),
      updated_at: new Date().toISOString(),
    }).eq('id', inserted.id);
  }
}

exports.handler = async (event) => {
  if (!isAuthorizedRun(event)) {
    return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  try {
    const admin = getSupabaseAdmin();
    const token = await getAccessToken();
    // Look far enough back that a burst of forwarded rep commands cannot hide
    // behind the ten newest already-processed messages. We still analyze only
    // one per invocation to stay within the function timeout.
    const refs = await listInboxMessages(token, Number(process.env.GMAIL_AI_BATCH_SIZE || 100));
    if (!refs.length) {
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, imported: 0 }) };
    }

    const ids = refs.map((x) => x.id);
    const { data: existing, error: existingError } = await admin
      .from('ai_inbox_messages')
      .select('gmail_message_id')
      .in('gmail_message_id', ids);
    if (existingError) throw existingError;
    const seen = new Set((existing || []).map((x) => x.gmail_message_id));
    // AI analysis performs two model calls. Process one message per scheduled
    // invocation so the function stays within Netlify's execution limit.
    const pending = refs.filter((x) => !seen.has(x.id)).slice(0, 1);
    let imported = 0;
    const failures = [];

    for (const ref of pending) {
      let row = null;
      try {
        const raw = await getMessage(token, ref.id);
        const parsed = parseMessage(raw);
        if (!parsed.sender_email || parsed.sender_email === process.env.GMAIL_AI_INBOX?.toLowerCase()) continue;
        const forwarded = extractForwardedMessage(parsed.text_body);
        const rep = forwarded.is_forwarded
          ? await findAuthorizedRep(admin, parsed.sender_email)
          : null;
        const isRepCommand = !!rep;
        const portalContext = isRepCommand
          ? await resolvePortalContext(admin, {
              instruction: forwarded.instruction,
              original_sender_email: forwarded.original_sender_email,
              original_subject: forwarded.original_subject,
              original_body: forwarded.original_body,
            })
          : null;
        const customerId = isRepCommand
          ? (portalContext?.exact_customer_id || portalContext?.customers?.[0]?.id || null)
          : await findCustomer(admin, parsed.sender_email);
        const { data: inserted, error: insertError } = await admin
          .from('ai_inbox_messages')
          .insert({
            ...parsed,
            customer_id: customerId,
            status: 'processing',
            is_rep_command: isRepCommand,
            submitted_by_id: rep?.id || null,
            rep_instruction: isRepCommand ? forwarded.instruction : null,
            original_sender_email: isRepCommand ? forwarded.original_sender_email || null : null,
            original_sender_name: isRepCommand ? forwarded.original_sender_name || null : null,
            original_subject: isRepCommand ? forwarded.original_subject || null : null,
            command_status: isRepCommand ? 'proposed' : 'none',
          })
          .select('id')
          .single();
        if (insertError) {
          if (insertError.code === '23505') continue;
          throw insertError;
        }
        row = inserted;
        if (isRepCommand) {
          await sendRepAcknowledgement(admin, token, parsed, inserted, forwarded);
        }

        const analysis = await analyzeEmail(parsed, isRepCommand ? {
          ...forwarded,
          rep: { id: rep.id, name: rep.name, email: rep.email, role: rep.role },
          portal_context: portalContext,
        } : null);
        const now = new Date().toISOString();
        const { error: updateError } = await admin
          .from('ai_inbox_messages')
          .update({
            intent: analysis.intent,
            needs_estimate: analysis.needs_estimate,
            analysis: {
              summary: analysis.summary,
              customer_questions: analysis.customer_questions,
              lines: analysis.lines,
              command: analysis.command || null,
              portal_context: portalContext,
            },
            stock_checks: analysis.stock_checks,
            draft_subject: analysis.draft?.subject,
            draft_body_text: analysis.draft?.text,
            draft_body_html: analysis.draft?.html,
            command_type: analysis.command?.type || null,
            command_payload: analysis.command || {},
            command_status: isRepCommand && analysis.command?.type && analysis.command.type !== 'none'
              ? 'proposed'
              : 'none',
            status: 'needs_review',
            processed_at: now,
            updated_at: now,
            error_message: null,
          })
          .eq('id', inserted.id);
        if (updateError) throw updateError;
        imported += 1;
      } catch (error) {
        failures.push({ gmail_message_id: ref.id, error: error.message });
        if (row?.id) {
          await admin.from('ai_inbox_messages').update({
            status: 'failed',
            error_message: String(error.message || error).slice(0, 2000),
            updated_at: new Date().toISOString(),
          }).eq('id', row.id);
        }
      }
    }

    return {
      statusCode: failures.length ? 207 : 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: failures.length === 0, imported, skipped: refs.length - pending.length, failures }),
    };
  } catch (error) {
    console.error('[gmail-ai-sync]', error);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};
