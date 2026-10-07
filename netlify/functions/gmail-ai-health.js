const { corsHeaders, verifyUser } = require('./_shared');
const { getAccessToken, SALES_EMAIL } = require('./_gmailAi');

// Match the identity-based AI Inbox UI and database access policy.
const OWNER_ID = '00000000-0000-0000-0000-000000000001';
exports.handler = async event => {
  const headers = { ...corsHeaders(), 'Cache-Control': 'no-store' };
  const reply = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });
  if (event.httpMethod === 'OPTIONS') return reply(204, {});
  if (event.httpMethod !== 'GET') return reply(405, { error: 'Method not allowed' });
  const verified = await verifyUser(event);
  if (!verified.ok) return reply(verified.status, { error: verified.error });
  if (verified.teamMemberId !== OWNER_ID) return reply(403, { error: 'AI Inbox access required' });
  try {
    // Only refresh OAuth and read Gmail's profile. Never import, analyze or send.
    await getAccessToken();
    return reply(200, { mailbox: SALES_EMAIL, connected: true, checked_at: new Date().toISOString() });
  } catch (error) {
    const reason = String(error.message || '');
    let message = 'Could not verify the Gmail connection. Try again or ask an administrator to check the mail service.';
    if (/not configured/i.test(reason)) message = 'The Sales Gmail connection has not been configured. An administrator must connect the Sales mailbox.';
    else if (/authorized as|Re-authorize/i.test(reason)) message = 'The saved Google connection belongs to a different mailbox. Reconnect using the Sales Google account.';
    else if (/invalid_grant|revoked|expired/i.test(reason)) message = 'Google access has expired or been revoked. Reconnect the Sales Google account.';
    return reply(200, { mailbox: SALES_EMAIL, connected: false, message, checked_at: new Date().toISOString() });
  }
};
