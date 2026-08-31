const CALLBACK_KEYS = ['action', 'code', 'state', 'realmId', 'error', 'error_description'];

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
