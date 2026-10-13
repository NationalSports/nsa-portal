const { randomUUID, timingSafeEqual } = require('node:crypto');
const { vendorCostSnapshot } = require('../../../src/lib/vendorCostSnapshot.shared');
const {
  compareStyleIds,
  fetchWithBackoff,
  styleKey,
  stylesAfterCursor,
} = require('./ss-adidas-sync-core');

// Env: SS_ACCOUNT_NUMBER, SS_API_KEY, REACT_APP_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, ADIDAS_SYNC_TRIGGER_SECRET.
// Netlify background functions are capped at 15 minutes. Leave four minutes for
// the final batch, checkpoint, run audit update, and lock release.
const TIME_BUDGET_MS = 11 * 60 * 1000;
const LOCK_TTL_SECONDS = 20 * 60;
const STYLE_BATCH_SIZE = 3;
const SS_CDN = 'https://cdn.ssactivewear.com/';
const SOURCE = 'ss_activewear';
const timeoutSignal = (ms) => (
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined
);

const CATEGORY_RULES = [
  ['1/4 Zips', /QUARTER[- ]ZIP|1\/4[- ]ZIP/i],
  ['Outerwear', /FULL[- ]ZIP|JACKET|VEST|WINDBREAKER|OUTERWEAR|RAIN/i],
  ['Polos', /POLO/i],
  ['Hats', /HEADWEAR|\bCAP\b|BEANIE|VISOR/i],
  ['Crew', /CREW/i],
  ['Hoods', /HOOD|FLEECE|SWEATSHIRT|PULLOVER/i],
  ['Shorts', /SHORT/i],
  ['Pants', /PANT|LEGGING|BOTTOM|JOGGER|TIGHT/i],
  ['Tees', /T-SHIRT|\bTEE\b|ACTIVEWEAR/i],
  ['Bags', /\bBAG\b|BACKPACK|DUFFEL|SACKPACK/i],
  ['Socks', /\bSOCK\b/i],
  ['Accessories', /ACCESSOR|GLOVE|SCARF|TOWEL|SLEEVE/i],
];

function mapCategory(title, baseCategory) {
  for (const hay of [String(title || ''), String(baseCategory || '')]) {
    for (const [category, pattern] of CATEGORY_RULES) {
      if (pattern.test(hay)) return category;
    }
  }
  return 'Other';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const secretsMatch = (provided, expected) => {
  if (!provided || !expected) return false;
  const left = Buffer.from(String(provided));
  const right = Buffer.from(String(expected));
  return left.length === right.length && timingSafeEqual(left, right);
};

exports.handler = async (event = {}) => {
  const startedMs = Date.now();
  const triggerSecret = process.env.ADIDAS_SYNC_TRIGGER_SECRET;
  const providedSecret = event.headers?.['x-adidas-sync-secret'] || event.headers?.['X-Adidas-Sync-Secret'];
  if (!secretsMatch(providedSecret, triggerSecret)) {
    console.error('[ss-adidas-sync] rejected unauthorized invocation');
    return { statusCode: 401, body: 'Unauthorized' };
  }
  const ssAccount = process.env.SS_ACCOUNT_NUMBER;
  const ssKey = process.env.SS_API_KEY;
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    console.error('[ss-adidas-sync] FATAL: missing Supabase configuration; failure cannot be audited');
    return { statusCode: 500, body: 'Supabase not configured' };
  }

  const sbHeaders = {
    'Content-Type': 'application/json',
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
  };
  const sbFetch = (path, init = {}) => {
    const signal = init.signal || timeoutSignal(10_000);
    return fetch(`${sbUrl}/rest/v1/${path}`, {
      ...init,
      headers: { ...sbHeaders, ...(init.headers || {}) },
      ...(signal ? { signal } : {}),
    });
  };
  const sbJson = async (path, init) => {
    const response = await sbFetch(path, init);
    const text = await response.text();
    if (!response.ok) throw new Error(`Supabase ${path.split('?')[0]} -> ${response.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  const rpc = (name, body) => sbJson(`rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const guardDropTotal = async () => {
    const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await sbJson(
      `adidas_inventory_guard_drops?source=eq.${encodeURIComponent(SOURCE)}&last_seen_at=gte.${encodeURIComponent(since)}&select=drop_count`
    );
    return (rows || []).reduce((sum, row) => sum + Number(row.drop_count || 0), 0);
  };

  if (!ssAccount || !ssKey) {
    const message = 'SS_ACCOUNT_NUMBER or SS_API_KEY is missing';
    console.error('[ss-adidas-sync] FATAL:', message);
    try {
      await sbJson('adidas_inventory_sync_runs', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          source: SOURCE,
          status: 'failed',
          error_count: 1,
          errors: [{ message }],
          finished_at: new Date().toISOString(),
        }),
      });
    } catch (auditError) {
      console.error('[ss-adidas-sync] FATAL: could not record configuration failure', auditError);
    }
    return { statusCode: 500, body: message };
  }

  const ssAuth = `Basic ${Buffer.from(`${ssAccount}:${ssKey}`).toString('base64')}`;
  let lastSsRequestAt = 0;
  const ssGet = async (path) => {
    const waitMs = Math.max(0, 1_050 - (Date.now() - lastSsRequestAt));
    if (waitMs) await sleep(waitMs);
    const separator = path.includes('?') ? '&' : '?';
    const url = `https://api.ssactivewear.com/V2${path}${separator}mediatype=json`;
    const response = await fetchWithBackoff(async () => {
      lastSsRequestAt = Date.now();
      const signal = timeoutSignal(15_000);
      return fetch(url, {
        headers: {
          Authorization: ssAuth,
          Accept: 'application/json',
          'User-Agent': 'NSA-Portal/1.0 (nationalsportsapparel.com)',
        },
        ...(signal ? { signal } : {}),
      });
    }, { maxAttempts: 3 });
    const text = await response.text();
    if (!response.ok) throw new Error(`S&S ${path} -> ${response.status}: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error(`S&S ${path} returned non-JSON data`);
    }
  };

  const lockOwner = randomUUID();
  let runId = null;
  let lockAcquired = false;
  let stylesTotal = 0;
  let stylesProcessed = 0;
  let productsUpserted = 0;
  let inventoryRows = 0;
  let cycleCompleted = false;
  const errors = [];

  const writeRun = async (values) => {
    if (!runId) return;
    await sbFetch(`adidas_inventory_sync_runs?id=eq.${encodeURIComponent(runId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(values),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`run update -> ${response.status}: ${(await response.text()).slice(0, 300)}`);
    });
  };

  try {
    const claim = await rpc('claim_adidas_inventory_sync', {
      p_source: SOURCE,
      p_owner: lockOwner,
      p_ttl_seconds: LOCK_TTL_SECONDS,
    });
    lockAcquired = claim?.acquired === true;
    if (!lockAcquired) {
      console.error('[ss-adidas-sync] overlap prevented; lock held until', claim?.locked_until || 'unknown');
      await sbJson('adidas_inventory_sync_runs', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          source: SOURCE,
          status: 'skipped_locked',
          error_count: 1,
          errors: [{ message: 'Another run holds the source lock', locked_until: claim?.locked_until || null }],
          finished_at: new Date().toISOString(),
        }),
      });
      return { statusCode: 409, body: 'Sync already running' };
    }

    const abandonedBefore = new Date(Date.now() - LOCK_TTL_SECONDS * 1000).toISOString();
    const abandoned = await sbFetch(
      `adidas_inventory_sync_runs?source=eq.${SOURCE}&status=eq.running&started_at=lt.${encodeURIComponent(abandonedBefore)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'failed',
          error_count: 1,
          errors: [{ message: 'Run exceeded its lock TTL and was recovered by a later invocation' }],
          finished_at: new Date().toISOString(),
        }),
      }
    );
    if (!abandoned.ok) {
      throw new Error(`Could not reconcile abandoned runs: ${abandoned.status} ${(await abandoned.text()).slice(0, 300)}`);
    }

    const insertedRuns = await sbJson('adidas_inventory_sync_runs?select=id', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ source: SOURCE, status: 'running', lock_owner: lockOwner }),
    });
    runId = insertedRuns?.[0]?.id;
    if (!runId) throw new Error('Run audit row was not created');

    const [vendorRows, stateRows, allStyles] = await Promise.all([
      sbJson('vendors?api_provider=eq.ss_activewear&select=id&limit=1'),
      sbJson(`adidas_inventory_sync_state?source=eq.${SOURCE}&select=cursor,cycle_started_at&limit=1`),
      ssGet('/Styles'),
    ]);
    const vendorId = vendorRows?.[0]?.id;
    if (!vendorId) throw new Error('No S&S vendor is configured');

    if (!Array.isArray(allStyles)) throw new Error('S&S /Styles returned a non-array payload');
    const adidasStyles = allStyles.filter((style) => /adidas/i.test(style.brandName || ''));
    if (!adidasStyles.length) throw new Error('S&S /Styles returned zero Adidas styles; cursor was preserved');
    stylesTotal = adidasStyles.length;
    const storedCursor = stateRows?.[0]?.cursor || {};
    const pendingStyles = stylesAfterCursor(adidasStyles, storedCursor);
    const retryStyleIds = new Set((storedCursor.retry_style_ids || []).map(String));
    console.log(`[ss-adidas-sync] ${stylesTotal} adidas styles; ${pendingStyles.length} remain in this cycle`);

    let productBatch = [];
    let inventoryBatch = [];
    let highWaterStyleId = String(storedCursor.last_style_id || '');

    const flush = async ({ completeCycle = false } = {}) => {
      const productsToWrite = [...new Map(productBatch.map((row) => [row.id, row])).values()];
      const inventoryToWrite = [...new Map(inventoryBatch.map((row) => [`${row.sku}\0${row.size}`, row])).values()];
      if (productsToWrite.length) {
        for (let index = 0; index < productsToWrite.length; index += 250) {
          const chunk = productsToWrite.slice(index, index + 250);
          await sbJson('products?on_conflict=id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(chunk),
          });
          productsUpserted += chunk.length;
        }
      }
      if (inventoryToWrite.length) {
        for (let index = 0; index < inventoryToWrite.length; index += 500) {
          const chunk = inventoryToWrite.slice(index, index + 500);
          const dropsBefore = await guardDropTotal();
          await sbJson('adidas_inventory?on_conflict=sku,size', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(chunk),
          });
          const dropped = Math.max(0, (await guardDropTotal()) - dropsBefore);
          inventoryRows += Math.max(0, chunk.length - dropped);
          if (dropped) {
            throw new Error(`Database size guard rejected ${dropped} S&S inventory row(s); cursor was preserved`);
          }
        }
      }

      const checkpoint = await rpc('checkpoint_adidas_inventory_sync', {
        p_source: SOURCE,
        p_owner: lockOwner,
        p_cursor: completeCycle ? {} : {
          last_style_id: highWaterStyleId,
          retry_style_ids: [...retryStyleIds],
        },
        p_cycle_completed: completeCycle,
        p_ttl_seconds: LOCK_TTL_SECONDS,
      });
      if (checkpoint?.updated !== true) throw new Error('Lost the sync lock while checkpointing');
      productBatch = [];
      inventoryBatch = [];
    };

    for (let index = 0; index < pendingStyles.length; index++) {
      if (Date.now() - startedMs >= TIME_BUDGET_MS) {
        console.log('[ss-adidas-sync] time budget reached; saving checkpoint before exit');
        break;
      }

      const style = pendingStyles[index];
      const currentStyleId = styleKey(style);
      if (!highWaterStyleId || compareStyleIds(currentStyleId, highWaterStyleId) > 0) {
        highWaterStyleId = currentStyleId;
      }
      try {
        const records = await ssGet(`/Products/?styleid=${encodeURIComponent(style.styleID)}`);
        if (!Array.isArray(records)) {
          throw new Error('S&S /Products returned a non-array payload');
        }
        if (records.length) {
          const byColor = new Map();
          for (const record of records) {
            const colorKey = String(record.colorCode || record.colorName || 'NA').replace(/\s+/g, '');
            if (!byColor.has(colorKey)) byColor.set(colorKey, []);
            byColor.get(colorKey).push(record);
          }

          const syncedAt = new Date().toISOString();
          for (const [colorCode, colorRecords] of byColor) {
            const first = colorRecords[0];
            const sku = `${style.styleName || style.title || 'SS'}-${colorCode}`;
            const sizes = [...new Set(colorRecords.map((record) => record.sizeName).filter(Boolean))];
            const snapshot = vendorCostSnapshot(colorRecords.map((record) => ({
              size: record.sizeName,
              cost: Number(record.customerPrice) || Number(record.piecePrice) || 0,
            })));
            if (!snapshot) continue;
            const mapPrice = Number(first.mapPrice) || 0;
            const retail = mapPrice > 1 ? mapPrice : (snapshot.baseCost > 0 ? Math.round(snapshot.baseCost * 2) : 0);
            const image = first.colorFrontImage || first.styleImage || '';
            productBatch.push({
              id: `ssa-${sku}`,
              vendor_id: vendorId,
              sku,
              name: `Adidas ${style.title || style.styleName}${style.styleName && style.title && !String(style.title).includes(style.styleName) ? ` (${style.styleName})` : ''}`,
              brand: 'Adidas',
              color: first.colorName || colorCode,
              category: mapCategory(style.title, style.baseCategory),
              retail_price: retail,
              nsa_cost: snapshot.baseCost,
              size_costs: snapshot.sizeCosts,
              catalog_sell_price: snapshot.baseCost > 0 ? Math.round(snapshot.baseCost * 1.65 * 100) / 100 : null,
              is_active: true,
              available_sizes: sizes,
              image_front_url: image ? SS_CDN + image : null,
              description: style.description
                ? String(style.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000)
                : null,
            });
            for (const record of colorRecords) {
              if (!record.sizeName) continue;
              const quantity = Array.isArray(record.warehouses)
                ? record.warehouses.reduce((sum, warehouse) => sum + (Number(warehouse.qty) || 0), 0)
                : (Number(record.qty) || 0);
              inventoryBatch.push({
                id: `${sku}-${record.sizeName}`,
                sku,
                size: record.sizeName,
                stock_qty: quantity,
                last_synced: syncedAt,
                source: SOURCE,
              });
            }
          }
        }
        retryStyleIds.delete(currentStyleId);
      } catch (error) {
        const detail = {
          style_id: style.styleID,
          style_name: style.styleName || null,
          message: String(error?.message || error).slice(0, 500),
        };
        errors.push(detail);
        retryStyleIds.add(currentStyleId);
        console.error('[ss-adidas-sync] STYLE FAILED', JSON.stringify(detail));
        if (errors.length >= 25) throw new Error('Stopped after 25 style failures');
      }
      stylesProcessed++;

      const isLastStyle = index === pendingStyles.length - 1;
      if (stylesProcessed % STYLE_BATCH_SIZE === 0 || isLastStyle) {
        cycleCompleted = isLastStyle && retryStyleIds.size === 0;
        await flush({ completeCycle: cycleCompleted });
      }
    }

    if (!cycleCompleted && (productBatch.length || inventoryBatch.length || highWaterStyleId || retryStyleIds.size)) {
      await flush();
    }
    if (!pendingStyles.length) {
      if (retryStyleIds.size) {
        throw new Error(
          `${retryStyleIds.size} retry style(s) were absent from the latest S&S catalog; cursor was preserved`
        );
      }
      cycleCompleted = true;
      highWaterStyleId = '';
      await flush({ completeCycle: true });
    }

    const status = errors.length ? 'partial' : (cycleCompleted ? 'completed' : 'success');
    await writeRun({
      status,
      styles_total: stylesTotal,
      styles_processed: stylesProcessed,
      products_upserted: productsUpserted,
      inventory_rows: inventoryRows,
      error_count: errors.length,
      errors: errors.slice(0, 100),
      cycle_completed: cycleCompleted,
      finished_at: new Date().toISOString(),
    });
    const summary = {
      status,
      styles_total: stylesTotal,
      styles_processed: stylesProcessed,
      products: productsUpserted,
      inventory_rows: inventoryRows,
      errors: errors.length,
      cycle_completed: cycleCompleted,
    };
    if (errors.length) {
      console.error('[ss-adidas-sync] PARTIAL FAILURE', JSON.stringify(summary), errors.slice(0, 5));
      return { statusCode: 502, body: JSON.stringify(summary) };
    }
    console.log('[ss-adidas-sync] success', JSON.stringify(summary));
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (error) {
    const message = String(error?.message || error);
    console.error('[ss-adidas-sync] FATAL', error);
    try {
      await writeRun({
        status: 'failed',
        styles_total: stylesTotal,
        styles_processed: stylesProcessed,
        products_upserted: productsUpserted,
        inventory_rows: inventoryRows,
        error_count: Math.max(1, errors.length),
        errors: [...errors, { message }].slice(0, 100),
        cycle_completed: false,
        finished_at: new Date().toISOString(),
      });
    } catch (auditError) {
      console.error('[ss-adidas-sync] FATAL: could not update run audit', auditError);
    }
    return { statusCode: 500, body: message };
  } finally {
    if (lockAcquired) {
      try {
        await rpc('release_adidas_inventory_sync', {
          p_source: SOURCE,
          p_owner: lockOwner,
        });
      } catch (error) {
        console.error('[ss-adidas-sync] FATAL: lock release failed', error);
      }
    }
  }
};
