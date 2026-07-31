// Scheduled Netlify function — daily carrier pickup auto-check (server-side).
//
// The portal already checks UPS from the browser (Warehouse → "Check UPS Pickups"
// button + a once-daily check when someone has the app open), but that only runs
// while a tab is open. This function runs on a schedule regardless, so packages
// are marked picked up every day even if nobody opens the portal.
//
// Two ways a package leaves "Awaiting Pickup" here:
//   1. UPS scan check — for UPS (1Z…) tracking numbers, ask UPS's public tracking
//      endpoint whether the package has actually been scanned (real confirmation).
//   2. Age backstop — for ANY carrier (FedEx, USPS, or a UPS number the scan check
//      couldn't confirm), a package still awaiting pickup PICKUP_AGE_CLEAR_DAYS days
//      after its ship date is auto-cleared. Carriers scan daily, so a tracked label
//      that old has certainly been picked up. This is what keeps FedEx from lingering
//      forever — FedEx has no free tracking endpoint we can query (it bot-blocks the
//      public one and gates the official API behind OAuth), so time is the signal.
//
// Confirmed packages get carrier_picked_up=true + pickup_date + pickup_source written
// back to Supabase, which moves them from "Awaiting Pickup" to "Shipped" in the view.
//
// Schedule is defined in netlify.toml under [functions."ups-pickup-sync"].
// Environment variables:
//   REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required)
//   PICKUP_AGE_CLEAR_DAYS (optional, default 4) — age backstop threshold in days

const MAX_CHECKS_PER_RUN = 150; // sanity cap on UPS lookups per run
const AGE_CLEAR_DAYS = Math.max(1, parseInt(process.env.PICKUP_AGE_CLEAR_DAYS || '4', 10) || 4);

// Match the client's updated_at convention (locale string, Pacific time) so
// open tabs' poll-merge sees a changed timestamp and refreshes the SO.
const ptNow = () => new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

// Whole days between a shipment's ship_date (fallback created_at) and now.
// Returns -1 when neither date parses, so an unparseable date never triggers a
// clear. ship_date is "M/D/YYYY"; created_at is "M/D/YYYY, h:mm:ss AM" — both parse
// with the JS Date constructor. `now` is injectable for testing.
function shipmentAgeDays(shp, now = Date.now()) {
  const raw = (shp && (shp.ship_date || shp.created_at)) || '';
  if (!raw) return -1;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return -1;
  return Math.floor((now - t) / 86400000);
}

// Is this shipment past the age backstop and eligible for an auto-clear? Only
// packages that (a) have a tracking number, (b) aren't already picked up, and
// (c) shipped at least `ageDays` ago qualify. The empty-tracking "No label" rows
// are left alone — there's nothing to have been scanned.
function agedOut(shp, ageDays = AGE_CLEAR_DAYS, now = Date.now()) {
  if (!shp || shp.carrier_picked_up) return false;
  const tn = shp.tracking_number ? String(shp.tracking_number).trim() : '';
  if (!tn) return false;
  return shipmentAgeDays(shp, now) >= ageDays;
}

// Same status logic as netlify/functions/ups-tracking.js (the browser endpoint).
async function upsStatus(tracking) {
  const response = await fetch('https://webapis.ups.com/track/api/Track/GetStatus?loc=en_US', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      'Origin': 'https://www.ups.com',
      'Referer': 'https://www.ups.com/track',
    },
    body: JSON.stringify({ Locale: 'en_US', TrackingNumber: [tracking] }),
  });
  if (!response.ok) return { pickedUp: false, status: 'http_' + response.status };
  const data = await response.json();
  const pkg = data?.trackDetails?.[0];
  if (!pkg) return { pickedUp: false, status: 'not_found' };
  const statusDesc = (pkg.packageStatus || '').toLowerCase();
  const activities = pkg.shipmentProgressActivities || [];
  const delivered = statusDesc.includes('delivered');
  const pickedUp = delivered ||
    statusDesc.includes('in transit') ||
    statusDesc.includes('on the way') ||
    statusDesc.includes('out for delivery') ||
    statusDesc.includes('departed') ||
    activities.length > 1; // multiple scan activities means UPS has the package
  return { pickedUp, delivered, status: pkg.packageStatus || 'unknown' };
}

exports.handler = async () => {
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    console.error('[ups-pickup-sync] Supabase env vars missing');
    return { statusCode: 500, body: 'Supabase not configured' };
  }
  const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };

  // Fetch SOs that have shipment records (paged — PostgREST caps responses at 1000 rows).
  // The neq.[] filter skips the (many) SOs with an empty shipments array; if the
  // PostgREST version rejects that jsonb comparison, retry without it.
  const rows = [];
  const PAGE = 1000;
  let skipNeqFilter = false;
  for (let page = 0; page < 20; page++) {
    const from = page * PAGE;
    const neq = skipNeqFilter ? '' : `&_shipments=neq.${encodeURIComponent('[]')}`;
    const url = `${sbUrl}/rest/v1/sales_orders?select=id,_shipments&deleted_at=is.null&_shipments=not.is.null${neq}&order=id.asc`;
    let r = await fetch(url, { headers: { ...sbHeaders, Range: `${from}-${from + PAGE - 1}` } });
    if (!r.ok && !skipNeqFilter && page === 0) {
      console.warn('[ups-pickup-sync] neq.[] filter rejected (' + r.status + '), retrying without it');
      skipNeqFilter = true;
      r = await fetch(`${sbUrl}/rest/v1/sales_orders?select=id,_shipments&deleted_at=is.null&_shipments=not.is.null&order=id.asc`,
        { headers: { ...sbHeaders, Range: `${from}-${from + PAGE - 1}` } });
    }
    if (!r.ok) {
      console.error('[ups-pickup-sync] sales_orders fetch failed:', r.status, await r.text());
      return { statusCode: 502, body: 'Supabase fetch error ' + r.status };
    }
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  let checked = 0, confirmed = 0, updatedSOs = 0, errors = 0;
  const cache = new Map(); // tracking number -> UPS result (dedupe across shipments)

  let agedConfirmed = 0;
  for (const row of rows) {
    const shipments = Array.isArray(row._shipments) ? row._shipments : [];
    // Something to do here if any tracked, not-yet-picked-up shipment is either a
    // UPS number to scan or old enough for the age backstop to clear.
    const hasPending = shipments.some(s => {
      if (!s || !s.tracking_number || s.carrier_picked_up) return false;
      return /^1Z/i.test(String(s.tracking_number).trim()) || agedOut(s);
    });
    if (!hasPending) continue;

    let changed = false;
    const updated = [];
    for (const s of shipments) {
      const tn = s && s.tracking_number ? String(s.tracking_number).trim() : '';
      if (!tn || s.carrier_picked_up) {
        updated.push(s);
        continue;
      }

      // 1) UPS real-time scan (only for 1Z numbers, within the per-run lookup budget).
      let pickedUp = false, statusStr = '', source = '';
      if (/^1Z/i.test(tn) && checked < MAX_CHECKS_PER_RUN) {
        let res = cache.get(tn);
        if (!res) {
          try {
            res = await upsStatus(tn);
          } catch (e) {
            console.warn('[ups-pickup-sync] UPS check failed for', tn, e.message);
            res = { pickedUp: false, status: 'error' };
            errors++;
          }
          cache.set(tn, res);
          checked++;
          await new Promise(rs => setTimeout(rs, 150)); // be polite to the UPS endpoint
        }
        if (res.pickedUp) { pickedUp = true; statusStr = res.status || ''; source = 'ups-auto'; }
      }

      // 2) Age backstop — any carrier the scan didn't confirm but that shipped long
      // enough ago is treated as picked up (see the header note).
      if (!pickedUp && agedOut(s)) {
        pickedUp = true;
        statusStr = 'Auto-cleared (aged ' + AGE_CLEAR_DAYS + 'd+)';
        source = 'age-auto';
      }

      if (pickedUp) {
        updated.push({
          ...s,
          carrier_picked_up: true,
          pickup_date: source === 'age-auto' ? (s.ship_date || s.created_at || ptNow()) : ptNow(),
          ups_status: statusStr,
          pickup_source: source,
        });
        confirmed++;
        if (source === 'age-auto') agedConfirmed++;
        changed = true;
      } else {
        updated.push(s);
      }
    }

    if (changed) {
      const patch = await fetch(`${sbUrl}/rest/v1/sales_orders?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ _shipments: updated, updated_at: ptNow() }),
      });
      if (!patch.ok) {
        console.error('[ups-pickup-sync] PATCH failed for', row.id, patch.status, await patch.text());
        errors++;
      } else {
        updatedSOs++;
      }
    }
  }

  console.log(`[ups-pickup-sync] checked=${checked} confirmed=${confirmed} (aged=${agedConfirmed}) sos_updated=${updatedSOs} errors=${errors}`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, checked, confirmed, aged: agedConfirmed, sos_updated: updatedSOs, errors }) };
};

// Exported for unit tests (netlify/functions/__tests__).
exports.shipmentAgeDays = shipmentAgeDays;
exports.agedOut = agedOut;
exports.AGE_CLEAR_DAYS = AGE_CLEAR_DAYS;
