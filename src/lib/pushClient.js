// NSA Connect as an installed app: manifest + service worker + web push.
// The manifest is attached only for signed-in staff, so customers on a store or
// coach page don't get "install the staff portal". Server side: push-subscribe.

export const isIOS = () => typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
export const isStandalone = () => {
  try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (e) { return false; }
};
export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const platformLabel = () => (isIOS() ? 'ios' : isAndroid() ? 'android' : 'desktop');

let installEvent = null;// Android/desktop Chrome "install" prompt, captured for our own button
const installListeners = new Set();
export const canPromptInstall = () => !!installEvent;
export const onInstallAvailable = (fn) => { installListeners.add(fn); return () => installListeners.delete(fn); };
export async function promptInstall() {
  if (!installEvent) return false;
  const e = installEvent; installEvent = null;
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  return !!(choice && choice.outcome === 'accepted');
}

const addTag = (tag, attrs) => {
  const sel = tag + Object.entries(attrs).filter(([k]) => k === 'rel' || k === 'name').map(([k, v]) => `[${k}="${v}"]`).join('');
  if (document.head.querySelector(sel)) return;
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  document.head.appendChild(el);
};

// Signed-in staff only: make the portal installable and register the worker.
export function setupAppShell() {
  if (typeof document === 'undefined') return;
  addTag('link', { rel: 'manifest', href: '/manifest.webmanifest' });
  addTag('meta', { name: 'theme-color', content: '#0f172a' });
  addTag('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  addTag('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  addTag('meta', { name: 'apple-mobile-web-app-title', content: 'NSA Connect' });
  addTag('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' });
  if (!window.__nsaInstallHooked) {
    window.__nsaInstallHooked = true;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; installListeners.forEach((f) => f(true)); });
  }
  registerWorker().catch(() => {});
}

export async function registerWorker() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

// The push function checks a live Supabase token. getSession() can hand back one that has
// already lapsed (a phone app sleeps, so the auto-refresh timer doesn't run), so refresh it
// first. A sign-in through the admin user picker has no token at all.
export const NO_SESSION = 'no-session';
async function accessToken(supabase, force) {
  let session = null;
  try { ({ data: { session } } = await supabase.auth.getSession()); } catch (e) { /* fall through to refresh */ }
  if (force || !session?.access_token || (session.expires_at && session.expires_at - Math.floor(Date.now() / 1000) < 60)) {
    try { const { data } = await supabase.auth.refreshSession(); if (data?.session) session = data.session; } catch (e) { /* no session to refresh */ }
  }
  return session?.access_token || null;
}

export async function callPush(supabase, body) {
  const post = (token) => fetch('/.netlify/functions/push-subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  const token = await accessToken(supabase, false);
  if (!token) {
    const e = new Error('Notifications need a password sign-in on this phone. Sign out, then sign back in with your email and password.');
    e.code = NO_SESSION;
    throw e;
  }
  let r = await post(token);
  if (r.status === 401) { const fresh = await accessToken(supabase, true); if (fresh && fresh !== token) r = await post(fresh); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(r.status === 401 ? 'Your sign-in on this phone has expired. Sign out, then sign back in.' : (d.error || 'HTTP ' + r.status));
    if (r.status === 401) e.code = NO_SESSION;
    throw e;
  }
  return d;
}

const keyBytes = (b64) => {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(s);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

// Must run from a tap (iOS only asks for permission in response to a user gesture).
export async function enablePush(supabase) {
  if (!pushSupported()) throw new Error(isIOS() && !isStandalone() ? 'Add NSA Connect to your Home Screen first, then open it from there.' : 'This browser can’t receive notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this app. Allow them in your phone’s Settings.' : 'Notifications were not allowed.');
  const cfg = await callPush(supabase, { action: 'config' });
  if (!cfg.publicKey) throw new Error('Notifications aren’t set up on the server yet. Ask an admin to add the VAPID keys.');
  const reg = (await navigator.serviceWorker.getRegistration('/')) || (await registerWorker());
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.publicKey) });
  await callPush(supabase, { action: 'subscribe', subscription: sub.toJSON(), platform: platformLabel() });
  return sub;
}

export async function disablePush(supabase) {
  const sub = await currentSubscription();
  if (!sub) return;
  await callPush(supabase, { action: 'unsubscribe', endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

// A message I just wrote tags teammates → push them once it has saved. Message ids
// are 'm' + Date.now(); only brand-new ones (< 10 min) notify, never old edits.
const mentioned = new Set();
export function pushMentionIfNew(supabase, cu, m, saved) {
  try {
    if (!supabase || !cu?.id || !m || m.author_id !== cu.id || mentioned.has(m.id)) return;
    const tagged = (m.tagged_members || []).filter((x) => x && x !== cu.id);
    const ts = Number(String(m.id || '').replace(/^m/, ''));
    if (!tagged.length || !Number.isFinite(ts) || Date.now() - ts > 10 * 60 * 1000) return;
    mentioned.add(m.id);
    const send = (tries) => callPush(supabase, { action: 'mention', message_id: m.id }).catch((e) => {
      if (tries > 0 && /not found/i.test(e.message)) setTimeout(() => send(tries - 1), 5000);
    });
    Promise.resolve(saved).then((ok) => { if (ok !== false) send(2); }, () => {});
  } catch (e) { /* a mention push is never worth breaking a message save */ }
}
