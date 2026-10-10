// The browser, Netlify functions and generated PostgreSQL policy share this configuration.
const config = require('./portalAccess.json');
const effectivePageAccess = user => !user || user.is_active === false ? [] : (Array.isArray(user.access) ? user.access : (config.defaults[user.role] || []));
function canViewPortalPage(user, page) {
  if (!user || user.is_active === false) return false;
  if (page === 'commission_admin') return config.commissionAdminIds.includes(String(user.id)) && ['admin','super_admin'].includes(user.role) && ['commissions','financials'].some(p=>canViewPortalPage(user,p));
  if (config.identities[page]) return config.identities[page].includes(String(user.id)) && (!Array.isArray(user.access) || user.access.includes(page));
  if (config.aliases[page]) return canViewPortalPage(user, config.aliases[page]);
  if (page === 'search') return ['orders','estimates','invoices','customers','products','jobs'].some(p => canViewPortalPage(user,p));
  if (!config.pages.includes(page)) return false;
  if (config.roleCaps[page] && !config.roleCaps[page].includes(user.role)) return false;
  return effectivePageAccess(user).includes(page);
}
module.exports = {config,canViewPortalPage,effectivePageAccess};
