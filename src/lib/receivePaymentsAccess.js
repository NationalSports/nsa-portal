// Receive Payments (recording checks and applying them to invoices) is limited to the people
// who handle incoming money. Identity allowlist, like Financials: sharing a role (other admins,
// future accounting hires) or an editable page-access array must not grant it.
export const RECEIVE_PAYMENTS_ALLOWED_USER_IDS = Object.freeze([
  '00000000-0000-0000-0000-000000000001', // Steve Peterson
  '35436542-e7f2-49db-8120-6111cf83b960', // Steve Peterson (Gmail login)
  '00000000-0000-0000-0000-000000000010', // Gayle Peterson
  '00000000-0000-0000-0000-000000000040', // Andrea Jung
  '00000000-0000-0000-0000-000000000041', // Ellie Calzada
]);

const allowedIds = new Set(RECEIVE_PAYMENTS_ALLOWED_USER_IDS);

export function canReceivePayments(user) {
  return !!user?.id && allowedIds.has(String(user.id));
}
