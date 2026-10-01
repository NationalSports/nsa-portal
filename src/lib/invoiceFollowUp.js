// Invoice follow-ups must never land before the invoice's own date. Rep sends a future-dated
// invoice early (e.g. sent 9/21, dated 10/6) → "send + 7 days" gave a 9/28 follow-up that showed
// as overdue before the invoice even existed for the customer. Count from the later of the send
// time and the invoice date (9am local, same anchor scheduled sends use).

export function invoiceDateMs(inv) {
  const d = inv && inv.date;
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  const t = m ? new Date(+m[1], +m[2] - 1, +m[3], 9, 0, 0).getTime() : new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

// Base timestamp to count follow-up days from.
export function invoiceFollowUpBaseMs(inv, sendMs) {
  const dMs = invoiceDateMs(inv);
  return dMs != null && dMs > sendMs ? dMs : sendMs;
}

// The follow-up date to show/act on. Also covers rows saved before this fix: a stored
// follow_up_at earlier than the invoice date is pushed out to the invoice date.
export function invoiceFollowUpDate(inv) {
  if (!inv || !inv.follow_up_at) return null;
  const fu = new Date(inv.follow_up_at).getTime();
  if (!Number.isFinite(fu)) return null;
  const dMs = invoiceDateMs(inv);
  return new Date(dMs != null && dMs > fu ? dMs : fu);
}
