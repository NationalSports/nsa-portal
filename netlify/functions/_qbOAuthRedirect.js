const requestOrigin = (event, fallbackSiteUrl) => {
  const headers = event?.headers || {};
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  const forwardedProto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : 'https';
  if (host && /^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return `${proto}://${host}`;
  return String(fallbackSiteUrl || 'http://localhost:3000').replace(/\/+$/, '');
};

const qbPortalRedirect = (event, fallbackSiteUrl, values) => {
  const hash = new URLSearchParams(values).toString();
  return `${requestOrigin(event, fallbackSiteUrl)}/?pg=qb#/qb?${hash}`;
};

module.exports = { requestOrigin, qbPortalRedirect };
