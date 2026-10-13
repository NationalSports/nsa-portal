// Push notifications for the signed-in staff member's device.
//   POST { action, ... } with a portal bearer token
//     config                         → { publicKey, configured }
//     subscribe   { subscription, platform? }  save this device
//     unsubscribe { endpoint }       remove this device
//     test                           push "it works" to all of my devices
//     mention     { message_id }     push my new message to the people it tags (once)
// Sending lives in _push.js.
const { corsHeaders, verifyUser } = require('./_shared');
const { vapidPublicKey, safePush } = require('./_push');

const json = (statusCode, body) => ({ statusCode, headers: corsHeaders(), body: JSON.stringify(body) });

// Only real browser push services; the server POSTs to this URL, so never an arbitrary host.
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.microsoft\.com$/];
function validEndpoint(url) {
  try { const u = new URL(String(url)); return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname)); } catch (_) { return false; }
}
const b64url = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,200}={0,2}$/.test(s);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const auth = await verifyUser(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const { admin, teamMemberId } = auth;
  if (!teamMemberId) return json(403, { error: 'No team member linked to this login' });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'Invalid JSON' }); }
  const action = String(body.action || '');

  try {
    if (action === 'config') return json(200, { publicKey: vapidPublicKey(), configured: !!(vapidPublicKey() && process.env.VAPID_PRIVATE_KEY) });

    if (action === 'subscribe') {
      const sub = body.subscription || {};
      const keys = sub.keys || {};
      if (!validEndpoint(sub.endpoint) || !b64url(keys.p256dh) || !b64url(keys.auth)) return json(400, { error: 'Not a valid push subscription' });
      const row = {
        team_member_id: teamMemberId, endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth, failures: 0,
        user_agent: String((event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || '').slice(0, 300) || null,
        platform: String(body.platform || '').slice(0, 40) || null,
      };
      const { error } = await admin.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
      if (error) throw new Error(error.message);
      return json(200, { ok: true });
    }

    if (action === 'unsubscribe') {
      if (!body.endpoint) return json(400, { error: 'endpoint required' });
      const { error } = await admin.from('push_subscriptions').delete().eq('endpoint', String(body.endpoint)).eq('team_member_id', teamMemberId);
      if (error) throw new Error(error.message);
      return json(200, { ok: true });
    }

    if (action === 'test') {
      const r = await safePush(admin, [teamMemberId], { title: 'Notifications are on ✅', body: 'This is how NSA Connect will reach you: art approvals, payments, notes and mentions.', url: '/', tag: 'test' });
      return json(200, { ok: true, sent: r.sent, skipped: r.skipped || null });
    }

    if (action === 'mention') {
      const id = String(body.message_id || '');
      if (!id) return json(400, { error: 'message_id required' });
      const { data: m } = await admin.from('messages').select('id,author_id,text,so_id,tagged_members,entity_type,entity_id').eq('id', id).maybeSingle();
      if (!m) return json(404, { error: 'Message not found' });
      if (String(m.author_id) !== String(teamMemberId)) return json(403, { error: 'Only the author can notify for a message' });
      const to = (Array.isArray(m.tagged_members) ? m.tagged_members : []).filter((x) => x && String(x) !== String(teamMemberId));
      if (!to.length) return json(200, { ok: true, sent: 0 });
      const { data: me } = await admin.from('team_members').select('name').eq('id', teamMemberId).maybeSingle();
      const where = m.so_id ? ' on ' + m.so_id : '';
      const url = m.so_id ? '/?so=' + encodeURIComponent(m.so_id) : '/?mtab=messages&pg=messages';
      const r = await safePush(admin, to, { title: (me && me.name ? me.name.split(' ')[0] : 'Someone') + ' mentioned you' + where, body: String(m.text || '').replace(/\s+/g, ' '), url, tag: 'msg-' + m.id }, { onceKey: 'mention:' + m.id });
      return json(200, { ok: true, sent: r.sent });
    }

    return json(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('[push-subscribe]', action, e.message);
    return json(500, { error: e.message });
  }
};
