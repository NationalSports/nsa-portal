const { resolveSender } = require('./_emailSender');
// Shared roster-invite email — used by roster-invite.js (manual send from the
// admin / coach portal) and roster-reminder-sweep.js (automatic 5-day nudge).
//
// Each player gets their OWN link (/shop/<slug>?player=<token>), so emails go
// out one per player rather than one blast — the parent lands straight on the
// store with the player's name/number (and position kit) already applied.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Storefront base URL. PORTAL_PUBLIC_URL / URL are set in Netlify; the fallback
// keeps links valid in any environment that forgets to set them.
function storeBase() {
  return (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nationalsportsapparel.com').replace(/\/+$/, '');
}

function playerLink(slug, token) {
  return `${storeBase()}/shop/${encodeURIComponent(slug)}?player=${encodeURIComponent(token)}`;
}

function buildHtml({ store, player, link, reminder }) {
  const first = (player.player_name || 'your player').split(/\s+/)[0];
  const num = player.player_number ? ` #${esc(player.player_number)}` : '';
  const primary = store.primary_color || '#0b1f3a';
  const intro = reminder
    ? `This is a friendly reminder — <strong>${esc(store.name)}</strong>'s team store is open and <strong>${esc(first)}${num}</strong> hasn't ordered yet.`
    : `<strong>${esc(store.name)}</strong>'s team store is open, and this is <strong>${esc(first)}${num}</strong>'s personal ordering link.`;
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:${esc(primary)};color:#fff;padding:20px 22px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">${reminder ? 'Don’t miss out — ' : ''}${esc(store.name)} Team Store</h2>
      </div>
      <div style="background:#fff;padding:22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
        <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 14px">Hi there,</p>
        <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 16px">${intro} Their name and number are already filled in for you.</p>
        <a href="${esc(link)}" style="display:inline-block;background:${esc(primary)};color:#fff;border-radius:8px;padding:12px 26px;font-weight:700;text-decoration:none;font-size:15px">Shop for ${esc(first)}${num} →</a>
        <p style="font-size:12.5px;color:#64748b;line-height:1.6;margin:18px 0 0">This link is just for ${esc(first)} — no account or password needed. If the button doesn't work, copy and paste this URL:<br><span style="color:#334155;word-break:break-all">${esc(link)}</span></p>
      </div>
    </div>`;
}

async function sendRosterEmail({ store, player, reminder }) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
  if (!brevoKey) return { ok: false, error: 'Email not configured' };
  const to = String(player.parent_email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, error: 'No valid parent email' };
  const link = playerLink(store.slug, player.token);
  const num = player.player_number ? ` #${player.player_number}` : '';
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: resolveSender({ name: store.name || 'National Sports Apparel' }),
      to: [{ email: to, name: player.player_name || to }],
      subject: reminder
        ? `Reminder: order ${player.player_name || 'your player'}${num}'s gear — ${store.name}`
        : `${player.player_name || 'Your player'}${num}'s ${store.name} team store link`,
      htmlContent: buildHtml({ store, player, link, reminder }),
    }),
  });
  if (!res.ok) { let msg = `Brevo ${res.status}`; try { msg = (await res.json()).message || msg; } catch { /* ignore */ } return { ok: false, error: msg }; }
  return { ok: true };
}

module.exports = { sendRosterEmail, playerLink };
