// Which recipients our normal sender (Brevo) can't reach, learned from past delivery failures.
//
// Some school districts' mail filters reject everything Brevo sends (a "550 ... blocked"
// hard bounce), and once an address bounces Brevo puts it on its own suppression list and
// silently drops every later send to it (a "blocked" event). Reps kept re-sending into that
// void. Two kinds of failure are told apart here:
//   - dead address: the mailbox doesn't exist — no sender can fix that, the rep needs a new address.
//   - blocked: the district rejects our SENDER. The whole domain is treated as blocked (it's the
//     district's server doing it), and those sends are routed through Gmail instead.
// Consumer mailboxes (gmail.com etc.) are never blocked domain-wide — one bad address there says
// nothing about the rest of the domain — so they're tracked per address.
//
// CommonJS so the portal (webpack) and netlify/functions/followup-sweep.js share it
// (listed in netlify.toml included_files). Keep it dependency-free CJS with no object spread
// (Babel would inject an ESM helper and break the webpack import — see src/lib/shipFrom.js).

const _DEAD = /does not exist|5\.1\.1|user unknown|no such user|unknown user|recipient.*not found|invalid (recipient|address|mailbox)/i;
const _CONSUMER = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|comcast|att|sbcglobal|verizon|proton|protonmail)\./i;

const _lc = (s) => String(s || '').trim().toLowerCase();
const _domain = (email) => { const e = _lc(email); const i = e.lastIndexOf('@'); return i > 0 ? e.slice(i + 1) : ''; };

// True when a bounce reason means the mailbox itself doesn't exist (vs. the district blocking us).
const isDeadMailboxReason = (reason) => _DEAD.test(String(reason || ''));

// Build the registry from documents' sent_history. A later successful delivery (opened) to the
// same address clears a dead-address mark, so a fixed typo or a mailbox that came back isn't
// held forever.
function buildEmailBlockRegistry(docLists) {
  const domains = new Map(), addrs = new Map(), dead = new Map(), opened = new Map();
  for (const list of docLists || []) {
    for (const doc of list || []) {
      for (const h of (doc && doc.sent_history) || []) {
        if (!h) continue;
        const at = new Date(h.delivery_at || h.sent_at || 0).getTime() || 0;
        const email = _lc(h.delivery_to || String(h.to || '').split(/[,;]/)[0]);
        if (!email.includes('@')) continue;
        if (h.delivery === 'opened') { if (at > (opened.get(email) || 0)) opened.set(email, at); continue; }
        if (h.delivery !== 'failed') continue;
        const hit = { at, docId: doc.id };
        if (isDeadMailboxReason(h.delivery_reason)) { dead.set(email, { at: hit.at, docId: hit.docId, reason: h.delivery_reason }); continue; }
        const d = _domain(email);
        if (d && !_CONSUMER.test(d)) domains.set(d, hit); else addrs.set(email, hit);
      }
    }
  }
  for (const [email, hit] of dead) if ((opened.get(email) || 0) > hit.at) dead.delete(email);
  return { domains, addrs, dead };
}

// The portal keeps one live registry, rebuilt whenever its documents change (App.js).
let _registry = buildEmailBlockRegistry([]);
function setEmailBlockRegistry(docLists) { _registry = buildEmailBlockRegistry(docLists); }

// For a list of recipient emails (strings or {email}): which need the Gmail route, and which
// are known-dead. Pass a registry to check against something other than the portal's live one.
function checkEmailRecipients(emails, registry) {
  const reg = registry || _registry;
  const gmail = [], dead = [];
  for (const raw of emails || []) {
    const email = _lc(raw && typeof raw === 'object' ? raw.email : raw);
    if (!email) continue;
    if (reg.dead.has(email)) dead.push(email);
    else if (reg.addrs.has(email) || reg.domains.has(_domain(email))) gmail.push(email);
  }
  return { gmail, dead };
}

// Domain named in the send-screen warning ("sangerusd.net blocks…"), or '' for a per-address block.
const blockedDomainOf = (email, registry) => ((registry || _registry).domains.has(_domain(email)) ? _domain(email) : '');

module.exports = { isDeadMailboxReason, buildEmailBlockRegistry, setEmailBlockRegistry, checkEmailRecipients, blockedDomainOf };
