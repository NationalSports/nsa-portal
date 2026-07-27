const SALES_EMAIL = (process.env.GMAIL_AI_INBOX || 'sales@nationalsportsapparel.com').toLowerCase();
const GMAIL_ROOT = 'https://gmail.googleapis.com/gmail/v1/users/me';

const b64url = (value) => Buffer.from(value).toString('base64url');
const fromB64url = (value) => Buffer.from(String(value || ''), 'base64url').toString('utf8');
const cleanHeader = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
const wrapBase64 = (value) => String(value || '').replace(/\s+/g, '').match(/.{1,76}/g)?.join('\r\n') || '';

async function getAccessToken() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail OAuth is not configured');
  }
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`Gmail token refresh failed (${response.status}): ${data.error_description || data.error || 'unknown error'}`);
  }
  await assertAuthorizedMailbox(data.access_token);
  return data.access_token;
}

async function gmailFetch(token, path, options = {}) {
  const response = await fetch(`${GMAIL_ROOT}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Gmail API: ${message}`);
  }
  return data;
}

async function assertAuthorizedMailbox(token) {
  const profile = await gmailFetch(token, '/profile');
  const authorizedEmail = String(profile.emailAddress || '').trim().toLowerCase();
  if (authorizedEmail !== SALES_EMAIL) {
    throw new Error(
      `Gmail OAuth is authorized as ${authorizedEmail || 'an unknown account'}; expected ${SALES_EMAIL}. ` +
      `Re-authorize while signed into ${SALES_EMAIL}.`
    );
  }
  return profile;
}

function headerMap(payload) {
  const out = {};
  for (const h of payload?.headers || []) out[String(h.name || '').toLowerCase()] = h.value || '';
  return out;
}

function parseAddress(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  return match
    ? { name: match[1].replace(/^"|"$/g, '').trim(), email: match[2].trim().toLowerCase() }
    : { name: '', email: raw.toLowerCase() };
}

function parseAddressList(value) {
  return String(value || '').split(',').map(parseAddress).filter((x) => x.email.includes('@'));
}

function collectParts(part, result = { text: [], html: [], attachments: [] }) {
  if (!part) return result;
  const mimeType = String(part.mimeType || '').toLowerCase();
  const filename = part.filename || '';
  if (filename || part.body?.attachmentId) {
    result.attachments.push({
      attachment_id: part.body?.attachmentId || null,
      filename: filename || 'attachment',
      mime_type: mimeType || 'application/octet-stream',
      size: Number(part.body?.size || 0),
    });
  } else if (part.body?.data) {
    const value = fromB64url(part.body.data);
    if (mimeType === 'text/plain') result.text.push(value);
    if (mimeType === 'text/html') result.html.push(value);
  }
  for (const child of part.parts || []) collectParts(child, result);
  return result;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseMessage(message) {
  const headers = headerMap(message.payload);
  const from = parseAddress(headers.from);
  const parts = collectParts(message.payload);
  const textBody = parts.text.join('\n\n').trim() || stripHtml(parts.html.join('\n'));
  return {
    gmail_message_id: message.id,
    gmail_thread_id: message.threadId,
    internet_message_id: headers['message-id'] || null,
    references_header: headers.references || null,
    sender_email: from.email,
    sender_name: from.name || null,
    to_emails: parseAddressList(headers.to).map((x) => x.email),
    cc_emails: parseAddressList(headers.cc).map((x) => x.email),
    subject: headers.subject || '',
    snippet: message.snippet || '',
    text_body: textBody.slice(0, 200000),
    html_body: parts.html.join('\n').slice(0, 500000) || null,
    attachment_meta: parts.attachments,
    received_at: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
  };
}

async function listInboxMessages(token, maxResults = 20) {
  const query = encodeURIComponent(`in:inbox newer_than:30d -from:${SALES_EMAIL}`);
  const data = await gmailFetch(token, `/messages?q=${query}&maxResults=${Math.min(100, maxResults)}`);
  return data.messages || [];
}

async function getMessage(token, id) {
  return gmailFetch(token, `/messages/${encodeURIComponent(id)}?format=full`);
}

function buildMime({ to, subject, text, html, inReplyTo, references, attachments = [] }) {
  const mixed = `nsa_mixed_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const alt = `nsa_alt_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const lines = [
    `From: National Sports Apparel <${cleanHeader(SALES_EMAIL)}>`,
    `To: ${cleanHeader(to)}`,
    `Subject: ${cleanHeader(subject)}`,
    ...(inReplyTo ? [`In-Reply-To: ${cleanHeader(inReplyTo)}`] : []),
    ...(references ? [`References: ${cleanHeader(references)}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    String(text || ''),
    '',
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    String(html || '').trim() || `<div>${String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`,
    '',
    `--${alt}--`,
  ];
  for (const attachment of attachments) {
    const content = String(attachment.content || '').replace(/\s+/g, '');
    if (!content) continue;
    lines.push(
      `--${mixed}`,
      `Content-Type: ${cleanHeader(attachment.mime_type || 'application/pdf')}; name="${cleanHeader(attachment.name || 'attachment.pdf').replace(/"/g, '')}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${cleanHeader(attachment.name || 'attachment.pdf').replace(/"/g, '')}"`,
      '',
      wrapBase64(content),
    );
  }
  lines.push(`--${mixed}--`, '');
  return lines.join('\r\n');
}

async function createReplyDraft(token, message, payload) {
  const subject = /^re:/i.test(payload.subject || '') ? payload.subject : `Re: ${payload.subject || message.subject || ''}`;
  const references = [message.references_header, message.internet_message_id].filter(Boolean).join(' ').trim();
  const raw = buildMime({
    to: message.sender_email,
    subject,
    text: payload.text,
    html: payload.html,
    inReplyTo: message.internet_message_id,
    references,
    attachments: payload.attachments,
  });
  return gmailFetch(token, '/drafts', {
    method: 'POST',
    body: JSON.stringify({
      message: {
        threadId: message.gmail_thread_id,
        raw: b64url(raw),
      },
    }),
  });
}

async function sendReply(token, message, payload) {
  const subject = /^re:/i.test(payload.subject || '') ? payload.subject : `Re: ${payload.subject || message.subject || ''}`;
  const references = [message.references_header, message.internet_message_id].filter(Boolean).join(' ').trim();
  const raw = buildMime({
    to: payload.to || message.sender_email,
    subject,
    text: payload.text,
    html: payload.html,
    inReplyTo: message.internet_message_id,
    references,
    attachments: payload.attachments,
  });
  return gmailFetch(token, '/messages/send', {
    method: 'POST',
    body: JSON.stringify({
      threadId: message.gmail_thread_id,
      raw: b64url(raw),
    }),
  });
}

module.exports = {
  SALES_EMAIL,
  assertAuthorizedMailbox,
  getAccessToken,
  listInboxMessages,
  getMessage,
  parseMessage,
  buildMime,
  createReplyDraft,
  sendReply,
};
