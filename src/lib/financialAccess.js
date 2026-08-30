// Financials contains company-wide revenue, margin, receivables, and exposure.
// Keep this as an identity allowlist rather than a role check: other admins must
// not gain access merely because they share an admin role or editable page-access
// array. These are the stable team-member IDs seeded for the three owners named
// by the business.
export const FINANCIALS_ALLOWED_USER_IDS = Object.freeze([
  '00000000-0000-0000-0000-000000000001', // Steve Peterson
  '00000000-0000-0000-0000-000000000010', // Gayle Peterson
  '00000000-0000-0000-0000-000000000011', // Mike Peterson
]);

const allowedIds = new Set(FINANCIALS_ALLOWED_USER_IDS);

export function canViewFinancials(user) {
  return !!user?.id && allowedIds.has(String(user.id));
}
