export const QB_OPERATOR_ROLES = Object.freeze(['admin', 'super_admin', 'accounting']);

export const canManageQuickBooksRole = (role) => QB_OPERATOR_ROLES.includes(String(role || '').trim());

export const storedUserCanManageQuickBooks = (storage) => {
  try {
    const target = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!target) return false;
    const user = JSON.parse(target.getItem('nsa_user') || 'null');
    return canManageQuickBooksRole(user?.role);
  } catch {
    return false;
  }
};
