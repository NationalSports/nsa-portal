// Scheduled Netlify function — daily carrier pickup auto-check (server-side).
//
// The portal already checks UPS from the browser (Warehouse → "Check UPS Pickups"
// button + a once-daily check when someone has the app open), but that only runs
// while a tab is open. This function runs on a schedule regardless, so packages
// are marked picked up every day even if nobody opens the portal.
//
// For UPS (1Z…) tracking numbers, ask UPS's public tracking endpoint whether the
// package has actually been scanned (real confirmation). NOTE: UPS has started
// tarpitting/blocking server-side callers of that free endpoint (it hangs instead
// of answering), so this is best-effort and time-bounded. A package is only ever
// marked picked up on real scan evidence — there is deliberately NO age-based
// auto-clear: the daily AI tracking check (a scheduled Claude session that looks
// up each awaiting-pickup number on the carrier's own site in a real browser)
// is what confirms UPS numbers this endpoint can't reach, plus FedEx/USPS.
//
// Confirmed packages get carrier_picked_up=true + pickup_date + pickup_source written
// back to Supabase, which moves them from "Awaiting Pickup" to "Shipped" in the view.
//
// Schedule is defined in netlify.toml under [functions."ups-pickup-sync"].
// Environment variables:
//   REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required)

const MAX_CHECKS_PER_RUN = 150; // sanity cap on UPS lookups per run

// UPS's free tracking endpoint now tarpits/blocks server-side callers (it hangs
// until the function is killed instead of answering). Bound it hard so a broken
// UPS never stalls the run: each call is aborted after UPS_CALL_TIMEOUT_MS, and
// once UPS_TIME_BUDGET_MS total has been spent trying UPS we stop attempting it
// for the rest of the run — anything unconfirmed waits for the daily AI check.
const UPS_CALL_TIMEOUT_MS = 6000;
const UPS_TIME_BUDGET_MS = 15000;

// Match the client's updated_at convention (locale string, Pacific time) so
// open tabs' poll-merge sees a changed timestamp and refreshes the SO.
const ptNow = () => new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

// Same status logic as netlify/functions/ups-tracking.js (the browser endpoint).
// AbortSignal.timeout keeps a hanging UPS endpoint from stalling the whole run —
// on timeout the fetch throws, which the caller treats as "not confirmed".
async function upsStatus(tracking) {
  const response = await fetch('https://webapis.ups.com/track/api/Track/GetStatus?loc=en_US', {
    method: 'POST',
    signal: AbortSignal.timeout(UPS_CALL_TIMEOUT_MS),
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
  const startedAt = Date.now();
  const upsBudgetLeft = () => (Date.now() - startedAt) < UPS_TIME_BUDGET_MS;

  for (const row of rows) {
    const shipments = Array.isArray(row._shipments) ? row._shipments : [];
    // Something to do here only if a tracked, not-yet-picked-up UPS number remains.
    const hasPending = shipments.some(s =>
      s && s.tracking_number && !s.carrier_picked_up && /^1Z/i.test(String(s.tracking_number).trim()));
    if (!hasPending) continue;

    let changed = false;
    const updated = [];
    for (const s of shipments) {
      const tn = s && s.tracking_number ? String(s.tracking_number).trim() : '';
      if (!tn || s.carrier_picked_up) {
        updated.push(s);
        continue;
      }

      // UPS real-time scan (only for 1Z numbers, within the per-run lookup + time
      // budgets). A cached result is always honored — only NEW lookups respect the
      // time budget, so once UPS has burned the budget we stop calling it but still
      // reuse any answer we already got this run.
      let pickedUp = false, statusStr = '';
      if (/^1Z/i.test(tn) && checked < MAX_CHECKS_PER_RUN && (cache.has(tn) || upsBudgetLeft())) {
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
        if (res.pickedUp) { pickedUp = true; statusStr = res.status || ''; }
      }

      if (pickedUp) {
        updated.push({
          ...s,
          carrier_picked_up: true,
          pickup_date: ptNow(),
          ups_status: statusStr,
          pickup_source: 'ups-auto',
        });
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
