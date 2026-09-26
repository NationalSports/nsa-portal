// Temporary administrator decisions, configured server-side only. Every exception
// has an owner-readable reason and expiry. They never clear invalid addresses or
// explicit opt-outs/complaints recorded in history.
function applyRoutingOverrides(registry, raw = process.env.EMAIL_ROUTING_OVERRIDES || '[]', now = Date.now()) {
  const overrides = JSON.parse(raw);
  if (!Array.isArray(overrides)) throw new Error('EMAIL_ROUTING_OVERRIDES must be an array');
  const reg = { ...registry, domains: new Map(registry.domains), addrs: new Map(registry.addrs), review: new Map(registry.review), brevoOverrides: new Set() };
  for (const entry of overrides) {
    const target = String(entry.target || '').trim().toLowerCase();
    const until = Date.parse(entry.reviewUntil);
    if (!/^(?:[^\s@]+@)?[a-z0-9.-]+\.[a-z]{2,}$/i.test(target) || !['gmail', 'brevo'].includes(entry.route) || !String(entry.reason || '').trim() || !Number.isFinite(until)) throw new Error('Invalid email routing override: target, route, reason and reviewUntil are required');
    if (until <= now) continue;
    if (entry.route === 'brevo') reg.brevoOverrides.add(target);
    else if (target.includes('@')) {
      reg.addrs.set(target, { at: now, reason: entry.reason });
      reg.review.delete(target); // explicitly reviewed address suppression only
    } else reg.domains.set(target, { at: now, reason: entry.reason });
  }
  return reg;
}
module.exports = { applyRoutingOverrides };
