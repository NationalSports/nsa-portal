const QBO_PRODUCTION_PORTAL_ORIGIN = 'https://connect.nationalsportsapparel.com';

const requestOrigin = (event, fallbackSiteUrl) => {
  const headers = event?.headers || {};
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  const forwardedProto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : 'https';
  if (host && /^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return `${proto}://${host}`;
  return String(fallbackSiteUrl || 'http://localhost:3000').replace(/\/+$/, '');
};

// Netlify's URL environment variable points at the raw *.netlify.app hostname,
// even when staff use the production custom domain. OAuth state is stored in an
// HttpOnly cookie, so starting on the custom domain and returning to that raw
// hostname always fails state validation. The Intuit app is registered to return
// to the production portal root; force that exact same-origin callback whenever
// the flow starts on the production portal, even if a stale Netlify env override
// still names the raw site URL.
const qbOAuthRedirectUri = (event, configuredRedirectUri, fallbackSiteUrl) => {
  const origin = requestOrigin(event, fallbackSiteUrl);
  if (origin === QBO_PRODUCTION_PORTAL_ORIGIN) return QBO_PRODUCTION_PORTAL_ORIGIN + '/';
  const configured = String(configuredRedirectUri || '').trim();
  if (configured) return configured;
  return `${origin}/.netlify/functions/qb-auth?action=callback`;
};

const qbPortalRedirect = (event, fallbackSiteUrl, values) => {
  const hash = new URLSearchParams(values).toString();
  return `${requestOrigin(event, fallbackSiteUrl)}/?pg=qb#/qb?${hash}`;
};

module.exports = { QBO_PRODUCTION_PORTAL_ORIGIN, requestOrigin, qbOAuthRedirectUri, qbPortalRedirect };
