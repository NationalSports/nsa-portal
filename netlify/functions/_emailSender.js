// Shared Brevo sender policy for school/district deliverability.
//
// K-12 filters commonly quarantine or drop mail from noreply@ addresses and from
// From/Reply-To mismatches. Prefer a real, replyable mailbox on the authenticated
// domain, and when a rep @nationalsportsapparel.com address is available, send as
// that rep so the message looks like a person-to-person transactional email.
//
// Ops: verify the default address (and any rep senders) in Brevo, and keep SPF /
// DKIM / DMARC aligned for nationalsportsapparel.com — see EMAIL_DELIVERABILITY.md.

const NSA_EMAIL_DOMAIN_RE = /@nationalsportsapparel\.com$/i;
const NOREPLY_RE = /^noreply@/i;

function defaultSenderEmail() {
  return process.env.BREVO_DEFAULT_SENDER || 'hello@nationalsportsapparel.com';
}

function isNsaEmail(email) {
  return NSA_EMAIL_DOMAIN_RE.test(String(email || ''));
}

/** Prefer real mailboxes; treat noreply@ as "no preference" so callers can upgrade. */
function isPreferredSender(email) {
  const e = String(email || '');
  return isNsaEmail(e) && !NOREPLY_RE.test(e);
}

/**
 * Resolve { name, email } for Brevo's sender field.
 * @param {{ name?: string, email?: string, replyTo?: { email?: string, name?: string } }} opts
 */
function resolveSender(opts = {}) {
  const fallbackName = 'National Sports Apparel';
  if (isPreferredSender(opts.email)) {
    return { name: opts.name || fallbackName, email: opts.email };
  }
  if (isPreferredSender(opts.replyTo?.email)) {
    return {
      name: opts.replyTo.name || opts.name || fallbackName,
      email: opts.replyTo.email,
    };
  }
  return { name: opts.name || fallbackName, email: defaultSenderEmail() };
}

module.exports = { defaultSenderEmail, isNsaEmail, isPreferredSender, resolveSender };
