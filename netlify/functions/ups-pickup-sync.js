// Scheduled Netlify function — daily UPS pickup auto-check (server-side).
//
// The portal already checks UPS from the browser (Warehouse → "Check UPS Pickups"
// button + a once-daily check when someone has the app open), but that only runs
// while a tab is open. This function runs on a schedule regardless, so packages
// scanned by UPS are marked picked up every day even if nobody opens the portal.
//
// For every sales_orders._shipments entry that has a UPS (1Z…) tracking number
// and no carrier_picked_up flag, it asks UPS's public tracking endpoint whether
// the package has been scanned. Confirmed packages get carrier_picked_up=true +
// pickup_date + ups_status written back to Supabase, which moves them from
// "Awaiting Pickup" to "Shipped" in the warehouse view.
//
// Schedule is defined in netlify.toml under [functions."ups-pickup-sync"].
// Environment variables required:
//   REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const MAX_CHECKS_PER_RUN = 150; // sanity cap on UPS lookups per run

// Match the client's updated_at convention (locale string, Pacific time) so
// open tabs' poll-merge sees a changed timestamp and refreshes the SO.
const ptNow = () => new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

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

  for (const row of rows) {
    const shipments = Array.isArray(row._shipments) ? row._shipments : [];
    const hasPending = shipments.some(s => s && s.tracking_number && !s.carrier_picked_up && /^1Z/i.test(String(s.tracking_number).trim()));
    if (!hasPending) continue;

    let changed = false;
    const updated = [];
    for (const s of shipments) {
      const tn = s && s.tracking_number ? String(s.tracking_number).trim() : '';
      if (!tn || s.carrier_picked_up || !/^1Z/i.test(tn) || checked >= MAX_CHECKS_PER_RUN) {
        updated.push(s);
        continue;
      }
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
      if (res.pickedUp) {
        updated.push({ ...s, carrier_picked_up: true, pickup_date: ptNow(), ups_status: res.status || '', pickup_source: 'ups-auto' });
        confirmed++;
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

  console.log(`[ups-pickup-sync] checked=${checked} confirmed=${confirmed} sos_updated=${updatedSOs} errors=${errors}`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, checked, confirmed, sos_updated: updatedSOs, errors }) };
};
