// Core of netlify/functions/gmail-send.js, shared with followup-sweep.js — see gmail-send.js
// for why portal email sometimes goes through Gmail instead of Brevo.
// sendViaGmail(admin, payload) takes a Brevo-shaped payload and resolves
// {status, messageId, via, from} on success (status 200) or {status, error}.

const crypto = require('crypto');
const { SALES_EMAIL, getAccessToken, buildMime, encodeHeader, gmailFetch } = require('./_gmailAi');

const MAX_RECIPIENTS = 50;
const COMPANY_DOMAIN = /@nationalsportsapparel\.com$/i;
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const MIME_BY_EXT = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', csv: 'text/csv', txt: 'text/plain', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

const res = (status, body) => ({ status, ...body });
const addr = (name, email) => (name ? `${encodeHeader(String(name).replace(/[<>"]/g, ''))} <${email}>` : email);
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function emailList(list) {
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  return arr.map((x) => String((x && typeof x === 'object' ? x.email : x) || '').trim().toLowerCase()).filter(Boolean);
}

// Service-account token impersonating `subject` (domain-wide delegation), scoped to sending only.
async function delegatedToken(subject) {
  const email = process.env.GOOGLE_SA_EMAIL;
  const key = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: email, sub: subject, scope: 'https://www.googleapis.com/auth/gmail.send', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 };
  const input = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
  const jwt = `${input}.${b64url(crypto.createSign('RSA-SHA256').update(input).sign(key))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`delegation refused (${res.status}): ${data.error_description || data.error || 'unknown'}`);
  return data.access_token;
}

async function sendViaGmail(admin, p) {
  const to = emailList(p.to), cc = emailList(p.cc), bcc = emailList(p.bcc);
  const all = [...to, ...cc, ...bcc];
  if (!to.length) return res(400, { error: 'At least one recipient is required' });
  if (all.length > MAX_RECIPIENTS) return res(400, { error: 'Too many recipients' });
  const bad = all.find((e) => !EMAIL_RE.test(e));
  if (bad) return res(400, { error: `Invalid email address: ${bad}` });
  if (!String(p.subject || '').trim()) return res(400, { error: 'Subject is required' });
  const attachments = Array.isArray(p.attachment) ? p.attachment : [];
  if (attachments.some((a) => !a || !a.content)) return res(400, { error: 'Only uploaded attachments can be sent through Gmail' });

  const senderName = String((p.sender && p.sender.name) || 'National Sports Apparel').trim();
  const senderEmail = String((p.sender && p.sender.email) || '').trim().toLowerCase();
  const replyEmail = String((p.replyTo && p.replyTo.email) || '').trim().toLowerCase();
  // The rep this email is from: the sender if it's a company mailbox other than the shared ones,
  // else the reply-to. Must be an active team member — the portal only ever sends as staff.
  const candidate = [senderEmail, replyEmail].find((e) => COMPANY_DOMAIN.test(e) && !/^(noreply|no-reply|sales|accounting|team)@/i.test(e)) || '';
  let rep = null;
  if (candidate) {
    const { data } = await admin.from('team_members').select('name,email,is_active')
      .ilike('email', candidate.replace(/[\\%_]/g, '\\$&')).limit(1).maybeSingle();
    if (data && data.is_active !== false) rep = { name: data.name || senderName, email: candidate };
  }

  const mime = {
    to: to.join(', '),
    cc: cc.join(', ') || undefined,
    subject: p.subject,
    text: p.textContent || String(p.htmlContent || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'),
    html: p.htmlContent || '',
    attachments: attachments.map((a) => {
      const ext = String(a.name || '').split('.').pop().toLowerCase();
      return { name: a.name || 'attachment.pdf', content: a.content, mime_type: MIME_BY_EXT[ext] || 'application/octet-stream' };
    }),
  };
  const send = (token, headers) => gmailFetch(token, '/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw: b64url(buildMime({ ...mime, ...headers })) }),
  });

  let delegationError = null;
  if (rep && process.env.GMAIL_SEND_AS_REPS === 'true' && process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY) {
    try {
      const token = await delegatedToken(rep.email);
      const sent = await send(token, { from: addr(rep.name, rep.email), bcc: bcc.join(', ') || undefined });
      return res(200, { messageId: `gmail:${sent.id}`, via: 'rep', from: rep.email });
    } catch (e) {
      delegationError = e.message; // fall through to the shared mailbox
      console.warn('[gmail-send] send-as-rep failed, using sales@:', e.message);
    }
  }

  try {
    const token = await getAccessToken();
    const replyTo = rep ? addr(rep.name, rep.email)
      : (replyEmail && EMAIL_RE.test(replyEmail) ? addr(p.replyTo && p.replyTo.name, replyEmail) : undefined);
    // Bcc the rep so they have the email in their own inbox (sales@ is where it was sent from).
    const bccAll = [...bcc, ...(rep && !all.includes(rep.email) ? [rep.email] : [])];
    const display = rep ? `${rep.name} | National Sports Apparel` : senderName;
    const sent = await send(token, { from: addr(display, SALES_EMAIL), replyTo, bcc: bccAll.join(', ') || undefined });
    return res(200, { messageId: `gmail:${sent.id}`, via: 'sales', from: SALES_EMAIL, delegationError });
  } catch (e) {
    console.error('[gmail-send] failed:', e.message);
    return res(502, { error: `Gmail send failed: ${e.message}` });
  }
}

module.exports = { sendViaGmail };
