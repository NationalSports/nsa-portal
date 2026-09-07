import { authFetch } from '../utils';

export async function methodicApi(action, payload = {}) {
  const response = await authFetch('/.netlify/functions/methodic-workflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  let data = {};
  try { data = await response.json(); } catch (_) { /* handled below */ }
  if (!response.ok || data.ok === false) throw new Error(data.error || `Methodic request failed (${response.status}).`);
  return data;
}

export async function methodicAccountingApi(action, payload = {}) {
  const response = await authFetch('/.netlify/functions/methodic-accounting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  let data = {};
  try { data = await response.json(); } catch (_) { /* handled below */ }
  if (!response.ok || data.ok === false) throw new Error(data.error || `Methodic accounting failed (${response.status}).`);
  return data;
}
