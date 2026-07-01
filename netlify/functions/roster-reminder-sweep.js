// Automated roster reminder — nudges players who were invited but never opened
// their link. Scheduled daily via netlify.toml ([functions."roster-reminder-sweep"]).
//
// A player is due for a reminder when ALL of these hold:
//   • an invite was sent (invite_sent_at set),
//   • it's been at least REMINDER_DAYS (5) since that invite,
//   • they've never opened their link (last_opened_at is null),
//   • they haven't ordered (ordered = false),
//   • no reminder has gone out yet (reminder_sent_at is null),
//   • their store is still open, and
//   • we have a parent email to send to.
//
// It sends one reminder per player and stamps reminder_sent_at so the nudge
// never repeats. Mirrors followup-sweep.js (getSupabaseAdmin + Brevo helper).

const { getSupabaseAdmin } = require('./_shared');
const { sendRosterEmail } = require('./_rosterEmail');

const REMINDER_DAYS = 5;

exports.handler = async () => {
  const started = Date.now();
  let sb;
  try { sb = getSupabaseAdmin(); } catch (e) { return { statusCode: 500, body: `Supabase not configured: ${e.message}` }; }

  const cutoff = new Date(Date.now() - REMINDER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Candidate rows: invited before the cutoff, never opened, not ordered, not
  // yet reminded, and with a parent email. Store-open is checked per row below.
  const { data: rows, error } = await sb.from('webstore_roster')
    .select('id,store_id,player_name,player_number,parent_email,token,invite_sent_at,last_opened_at,ordered,reminder_sent_at')
    .not('invite_sent_at', 'is', null)
    .lte('invite_sent_at', cutoff)
    .is('last_opened_at', null)
    .is('reminder_sent_at', null)
    .eq('ordered', false)
    .not('parent_email', 'is', null)
    .limit(1000);
  if (error) return { statusCode: 500, body: `Query failed: ${error.message}` };

  const due = rows || [];
  if (!due.length) return { statusCode: 200, body: 'No roster reminders due.' };

  // Resolve each row's store once (open stores only), caching by id.
  const storeIds = [...new Set(due.map((r) => r.store_id))];
  const { data: stores } = await sb.from('webstores').select('id,name,slug,primary_color,status').in('id', storeIds);
  const storeById = {}; (stores || []).forEach((s) => { storeById[s.id] = s; });

  let sent = 0, skipped = 0, failed = 0;
  for (const p of due) {
    const store = storeById[p.store_id];
    if (!store || store.status !== 'open' || !p.token) { skipped += 1; continue; }
    const r = await sendRosterEmail({ store, player: p, reminder: true });
    if (!r.ok) { failed += 1; console.warn('[roster-reminder-sweep] send failed for', p.id, r.error); continue; }
    const { error: upErr } = await sb.from('webstore_roster').update({ reminder_sent_at: new Date().toISOString() }).eq('id', p.id);
    if (upErr) console.warn('[roster-reminder-sweep] stamp failed for', p.id, upErr.message);
    sent += 1;
  }

  const msg = `Roster reminders — sent ${sent}, skipped ${skipped}, failed ${failed} in ${Date.now() - started}ms.`;
  console.log('[roster-reminder-sweep]', msg);
  return { statusCode: 200, body: msg };
};
