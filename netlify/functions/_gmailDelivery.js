const { getAccessToken, gmailFetch } = require('./_gmailAi');

// Gmail acceptance is not delivery. Only a correlated RFC delivery-status report
// can mark a Gmail send failed; absence of a report remains unconfirmed.
function readReport(message, originalId) {
  const texts = [];
  let report = false;
  function visit(part) {
    if (!part) return;
    if (/multipart\/report|message\/delivery-status/i.test(part.mimeType || '')) report = true;
    for (const h of part.headers || []) {
      if (/^(message-id|original-message-id|content-type)$/i.test(h.name)) texts.push(h.name + ': ' + h.value);
      if (/^content-type$/i.test(h.name) && /multipart\/report|delivery-status/i.test(h.value)) report = true;
    }
    if (part.body && part.body.data) texts.push(Buffer.from(part.body.data, 'base64url').toString('utf8'));
    for (const child of part.parts || []) visit(child);
  }
  visit(message.payload);
  if (!report || !originalId) return null;
  const text = texts.join('\n').replace(/\r\n/g, '\n');
  // Compare complete Message-ID values, not subjects or recipient names.
  const ids = [...text.matchAll(/(?:Original-Message-ID|Message-ID):\s*(<[^>\n]+>)/gi)].map((m) => m[1]);
  if (!ids.includes(originalId)) return null;
  for (const block of text.split(/\n\s*\n/)) {
    const recipient = block.match(/(?:Final|Original)-Recipient:\s*[^;\n]+;\s*([^\s\n]+)/i);
    if (!recipient || !/Action:\s*failed\b/i.test(block) || !/Status:\s*5\./i.test(block)) continue;
    const diagnostic = block.match(/Diagnostic-Code:\s*[^;\n]+;\s*([^\n]*(?:\n[ \t]+[^\n]*)*)/i);
    return { status: 'failed', email: recipient[1].toLowerCase(), event: 'gmail_bounce', reason: diagnostic ? diagnostic[1].replace(/\s+/g, ' ') : 'Gmail reported a permanent delivery failure', at: new Date(Number(message.internalDate) || Date.now()).toISOString() };
  }
  return null;
}
// Cache only provider reads, briefly. Never cache a successful-delivery conclusion.
let reportsCache = null;
async function recentReports(token) {
  if (reportsCache && Date.now() - reportsCache.at < 60000) return reportsCache.messages;
  const refs = await gmailFetch(token, '/messages?maxResults=20&q=' + encodeURIComponent('newer_than:30d {from:mailer-daemon from:postmaster}') + '&includeSpamTrash=true');
  const messages = [];
  for (let i = 0; i < (refs.messages || []).length; i += 5) {
    messages.push(...await Promise.all(refs.messages.slice(i, i + 5).map((m) => gmailFetch(token, `/messages/${encodeURIComponent(m.id)}?format=full`))));
  }
  reportsCache = { at: Date.now(), messages };
  return messages;
}
async function checkGmailDelivery(messageId) {
  // Delegation grants sending only. Never broaden its scope just to read a rep's
  // inbox. Rep sends remain explicitly unconfirmed and require manual review.
  if (!/^gmail:[a-zA-Z0-9_-]+$/.test(messageId)) return { status: 'unconfirmed' };
  const token = await getAccessToken();
  const sent = await gmailFetch(token, `/messages/${encodeURIComponent(messageId.slice(6))}?format=metadata&metadataHeaders=Message-ID`);
  if (!(sent.labelIds || []).includes('SENT')) return { status: 'unconfirmed' };
  const id = ((sent.payload || {}).headers || []).find((h) => h.name.toLowerCase() === 'message-id');
  if (!id) return { status: 'unconfirmed' };
  for (const report of await recentReports(token)) {
    const result = readReport(report, id.value);
    if (result) return result;
  }
  return { status: 'unconfirmed' };
}
module.exports = { readReport, checkGmailDelivery };
