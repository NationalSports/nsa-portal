// Read-only Google Calendar feed for the dashboard calendar.
//   POST { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } with a portal bearer token
//   → { connected, events: [{ id, title, start, end, all_day, location, url }] }
// Uses the signed-in rep's own Google connection (rep_google_links, created by
// google-connect). Nothing is written to Google; events are not stored.
const { corsHeaders, verifyUser } = require('./_shared');
const { getLink, accessTokenForLink } = require('./_repGoogle');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 62;
const json = (statusCode, body) => ({ statusCode, headers: corsHeaders(), body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const auth = await verifyUser(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { body = {}; }
  const { from, to } = body;
  if (!DATE_RE.test(String(from || '')) || !DATE_RE.test(String(to || ''))) return json(400, { error: 'from and to must be YYYY-MM-DD' });
  // Pad a day each side so time-zone edges don't drop all-day or late-night events.
  const timeMin = new Date(Date.parse(from + 'T00:00:00Z') - 864e5);
  const timeMax = new Date(Date.parse(to + 'T23:59:59Z') + 864e5);
  if (!(timeMax > timeMin) || (timeMax - timeMin) / 864e5 > MAX_RANGE_DAYS + 2) return json(400, { error: 'Date range too large' });

  try {
    const link = await getLink(auth.admin, auth.teamMemberId);
    if (!link) return json(200, { connected: false, events: [] });
    if (!String(link.scopes || '').includes('calendar')) return json(200, { connected: true, calendar_scope: false, events: [] });
    const token = await accessTokenForLink(auth.admin, link);
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return json(502, { error: `Google Calendar: ${data?.error?.message || 'HTTP ' + resp.status}` });
    const events = (data.items || [])
      .filter((e) => e.status !== 'cancelled')
      .map((e) => ({
        id: e.id,
        title: String(e.summary || '(no title)').slice(0, 200),
        start: e.start?.dateTime || e.start?.date || null,
        end: e.end?.dateTime || e.end?.date || null,
        all_day: !!e.start?.date && !e.start?.dateTime,
        location: e.location ? String(e.location).slice(0, 200) : null,
        url: e.htmlLink || null,
      }))
      .filter((e) => e.start);
    return json(200, { connected: true, events });
  } catch (err) {
    console.error('[rep-calendar]', err.message);
    return json(500, { error: err.message });
  }
};
