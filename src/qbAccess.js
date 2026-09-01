export const QB_OPERATOR_ROLES = Object.freeze(['admin', 'super_admin', 'accounting']);

export const canManageQuickBooksRole = (role) => QB_OPERATOR_ROLES.includes(String(role || '').trim());

// App-level QBO effects are declared before the current-user state in the legacy
// monolith. Read the same persisted user that initializes that state so connection
// checks and auto-sync never start in a normal rep's browser.
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
