const CALLBACK_KEYS = ['action', 'code', 'state', 'realmId', 'error', 'error_description'];
export const QBO_PRODUCTION_PORTAL_ORIGIN = 'https://connect.nationalsportsapparel.com';

// OAuth state is bound to an HttpOnly cookie on the host that starts the flow.
// A Netlify deploy preview therefore cannot safely start OAuth and receive the
// callback on the production custom domain: the preview cookie cannot cross
// hosts. Bounce preview users to the production QB page first, then let that
// same-origin page initiate the Intuit flow.
export const qboProductionReconnectUrl = (locationLike) => {
  try {
    const hostname = String(locationLike?.hostname || '').toLowerCase();
    const origin = String(locationLike?.origin || '').replace(/\/+$/, '');
    if (!hostname.endsWith('.netlify.app') || origin === QBO_PRODUCTION_PORTAL_ORIGIN) return null;
    const target = new URL(QBO_PRODUCTION_PORTAL_ORIGIN + '/');
    target.searchParams.set('pg', 'qb');
    target.searchParams.set('qb_reconnect', '1');
    return target.toString();
  } catch {
    return null;
  }
};

// Intuit is currently registered to return to the portal root. Forward that
// one-time OAuth payload to the serverless callback, where the HttpOnly state
// cookie can be validated and the authorization code exchanged safely.
export const qboFunctionCallbackUrl = (locationLike) => {
  try {
    const path = locationLike?.pathname || '/';
    const params = new URLSearchParams(locationLike?.search || '');
    if ((path !== '/' && path !== '') || params.get('action') !== 'callback') return null;
    if (!params.get('state') || (!params.get('code') && !params.get('error'))) return null;

    const forwarded = new URLSearchParams();
    CALLBACK_KEYS.forEach((key) => {
      const value = params.get(key);
      if (value) forwarded.set(key, value);
    });
    return '/.netlify/functions/qb-auth?' + forwarded.toString();
  } catch {
    return null;
  }
};
