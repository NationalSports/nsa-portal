// Netlify invokes this private scheduled function; the browser uses rep-gmail-sync.
const { getSupabaseAdmin } = require('./_shared');
const { syncLink } = require('./_repGmailSync');
const SCHEDULE_MIN_GAP_MS = 5 * 60 * 1000;

exports.handler = async (event) => {
  const deadline = Date.now() + 20000;
  const admin = getSupabaseAdmin();
  const freshCutoff = new Date(Date.now() - SCHEDULE_MIN_GAP_MS).toISOString();
  const { data: links, error } = await admin
    .from('rep_google_links')
    .select('*')
    .or(`last_synced_at.is.null,last_synced_at.lt.${freshCutoff}`)
    .order('last_synced_at', { ascending: true, nullsFirst: true });
  if (error) {
    console.error('[rep-gmail-scheduled] list links:', error.message);
    return { statusCode: 500 };
  }
  let synced = 0;
  for (const link of links || []) {
    if (Date.now() > deadline) break;
    await syncLink(admin, link, deadline, event);
    synced += 1;
  }
  console.log('[rep-gmail-scheduled] mailboxes:', synced);
  return { statusCode: 200 };
};
