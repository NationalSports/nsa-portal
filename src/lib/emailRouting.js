// Shared, dependency-free CommonJS routing rules for the portal and server workers.
const _DEAD = /does not exist|5\.1\.1|user unknown|no such user|unknown user|recipient.*not found|invalid (recipient|address|mailbox)/i;
const _CONSUMER = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|comcast|att|sbcglobal|verizon|proton|protonmail)\./i;
const _lc = (s) => String(s || '').trim().toLowerCase();
const _domain = (email) => { const e = _lc(email); const i = e.lastIndexOf('@'); return i > 0 ? e.slice(i + 1) : ''; };
const isConsumerEmail = (email) => _CONSUMER.test(_domain(email));
const isDeadMailboxReason = (reason) => _DEAD.test(String(reason || ''));
function failureKind(h) {
  const reason = String(h.delivery_reason || '');
  const event = String(h.delivery_event || '');
  // Never route around a recipient's opt-out or spam complaint.
  if (/unsubscribe|complaint|spam$/i.test(event) || /unsubscrib|spam complaint|complained|opt.out/i.test(reason)) return 'suppressed';
  if (isDeadMailboxReason(reason)) return 'dead';
  if (/soft.?bounce|defer/i.test(event) || /mailbox full|quota|temporar|rate.limit|try again/i.test(reason)) return 'temporary';
  // A bare Brevo "blocked" event is an address suppression, not evidence that
  // every mailbox at that district rejects our sender. Unknown causes need review.
  if (/block|blacklist|deny.?list|reject/i.test(reason) && /550|5\.7\.|sender|sending|ip address|barracuda/i.test(reason)) return 'blocked';
  if (/^blocked$/i.test(event) || /suppress|blocklist|blacklist/i.test(reason)) return 'review';
  return 'unknown';
}
function buildEmailBlockRegistry(docLists) {
  const domains = new Map(), addrs = new Map(), dead = new Map(), suppressed = new Map(), review = new Map();
  const failures = new Map(), successes = new Map(), brevoSuccesses = new Map();
  const latest = (map, email, hit) => { if (!map.has(email) || hit.at >= map.get(email).at) map.set(email, hit); };
  for (const list of docLists || []) for (const doc of list || []) for (const h of (doc && doc.sent_history) || []) {
    if (!h) continue;
    const at = new Date(h.delivery_at || h.sent_at || 0).getTime() || 0;
    // Only attribute a multi-recipient result when the provider identified the mailbox.
    const targets = String(h.to || '').split(/[,;]/).map(_lc).filter(Boolean);
    const email = _lc(h.delivery_to || (targets.length === 1 ? targets[0] : ''));
    if (!email.includes('@') || /[,;]/.test(email)) continue;
    const hit = { at, docId: doc.id, reason: h.delivery_reason, kind: failureKind(h) };
    if (['opened', 'delivered'].includes(h.delivery)) {
      latest(successes, email, hit);
      if (!String(h.messageId || '').startsWith('gmail:')) latest(brevoSuccesses, email, hit);
    } else if (h.delivery === 'failed') {
      if (hit.kind === 'suppressed') latest(suppressed, email, hit);
      // Gmail failures cannot teach us that Brevo is blocked.
      else if (hit.kind === 'dead' || !String(h.messageId || '').startsWith('gmail:')) latest(failures, email + ":" + hit.kind, Object.assign({ email }, hit));
    }
  }
  for (const hit of failures.values()) {
    const email = hit.email;
    if (hit.kind === 'dead') {
      if (!successes.has(email) || successes.get(email).at <= hit.at) dead.set(email, hit);
    } else if (hit.kind === 'review') {
      if (!brevoSuccesses.has(email) || brevoSuccesses.get(email).at <= hit.at) review.set(email, hit);
    } else if (hit.kind === 'blocked' && (!brevoSuccesses.has(email) || brevoSuccesses.get(email).at <= hit.at)) {
      const d = _domain(email);
      if (d && !_CONSUMER.test(d)) latest(domains, d, hit); else addrs.set(email, hit);
    }
  }
  // Brevo may emit a later reasonless suppression after a diagnosed sender block.
  // Preserve that diagnosis for this exact address (not unrelated district mailboxes).
  for (const hit of failures.values()) if (hit.kind === 'blocked' && (!brevoSuccesses.has(hit.email) || brevoSuccesses.get(hit.email).at <= hit.at)) review.delete(hit.email);
  return { domains, addrs, dead, suppressed, review };
}
let _registry = buildEmailBlockRegistry([]);
function setEmailBlockRegistry(docLists) { _registry = buildEmailBlockRegistry(docLists); }
function checkEmailRecipients(emails, registry) {
  const reg = registry || _registry;
  const gmail = [], dead = [], suppressed = [], review = [];
  for (const raw of emails || []) {
    const email = _lc(raw && typeof raw === 'object' ? raw.email : raw);
    if (!email) continue;
    if (reg.suppressed && reg.suppressed.has(email)) suppressed.push(email);
    else if (reg.dead.has(email)) dead.push(email);
    else if (reg.review && reg.review.has(email)) review.push(email);
    else if (reg.brevoOverrides && (reg.brevoOverrides.has(email) || reg.brevoOverrides.has(_domain(email)))) continue;
    else if (reg.addrs.has(email) || reg.domains.has(_domain(email))) gmail.push(email);
  }
  return { gmail, dead, suppressed, review };
}
const blockedDomainOf = (email, registry) => ((registry || _registry).domains.has(_domain(email)) ? _domain(email) : '');
function deliveryFailureAdvice(h) {
  const retry = h && h.automatic_retry;
  if (retry && retry.status === 'retrying') return 'An automatic Gmail retry is in progress or needs confirmation. Check Sent before manually resending.';
  if (retry && retry.status === 'resent') return 'Automatically resent through Gmail. Delivery is still unconfirmed; do not resend again unless needed.';
  if (retry && retry.status === 'review') return retry.error || 'Automatic retry needs review. Check the sending mailbox before resending.';
  if (retry && retry.status === 'pending') return 'The server is checking whether this rejection qualifies for one automatic Gmail retry. Wait for the result before resending.';
  const kind = failureKind(h || {});
  if (kind === 'dead') return 'That mailbox does not exist. Correct the contact address before sending again.';
  if (kind === 'suppressed') return 'This recipient opted out or reported spam. Do not resend through another provider.';
  if (String((h || {}).messageId || '').startsWith('gmail:')) return 'Gmail also reported a delivery failure. Confirm the address and ask the district to review its email filter.';
  if (kind === 'blocked') return 'The sender was blocked. Resend from the portal to use Gmail.';
  return 'Review the delivery error and confirm the address with the customer before retrying.';
}
const emailDeliveryLabel = (h) => !h ? '' : h.automatic_retry?.status === 'resent' ? 'Automatically resent through Gmail — delivery unconfirmed' : h.automatic_retry?.status === 'retrying' ? 'Automatic Gmail retry in progress — check before resending' : h.delivery === 'failed' ? 'Delivery failed' : h.delivery === 'opened' ? 'Opened' : h.delivery === 'delivered' ? 'Delivered' : String(h.messageId || '').startsWith('gmail:') ? (h.auto_retry_of ? 'Automatically resent through Gmail — delivery unconfirmed' : 'Sent through Gmail — delivery unconfirmed') : h.delivery === 'deferred' ? 'Delivery delayed' : '';
module.exports = { isConsumerEmail, isDeadMailboxReason, failureKind, deliveryFailureAdvice, emailDeliveryLabel, buildEmailBlockRegistry, setEmailBlockRegistry, checkEmailRecipients, blockedDomainOf };
