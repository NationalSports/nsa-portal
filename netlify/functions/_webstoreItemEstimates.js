const { loadTimingContext } = require('./_fulfillmentTiming');
const { methodKey, serviceDays, jobKey, seasonalProduction } = require('../../src/lib/fulfillmentTiming.shared');
const { businessDate, addBusinessDays } = require('../../src/lib/businessDates.shared');
const sizeKey = value => String(value || 'OS').trim().toUpperCase();
const quantity = (sizes, size) => Object.entries(sizes || {}).reduce((n, [key, value]) => n + (sizeKey(key) === sizeKey(size) ? Math.max(0, Number(value) || 0) : 0), 0);
const latest = dates => dates.length && dates.every(Boolean) ? dates.slice().sort().pop() : null;

function estimateItem(item, source, picks, pos, productionDays, now = new Date(), timing = {}) {
  if (item.is_bundle_parent || item.line_status === 'cancelled') return null;
  if (['shipped', 'complete'].includes(item.line_status)) return { state: 'shipped', message: 'Shipped' };
  if (item.line_status === 'bagging') return { state: 'ready', message: 'Production complete; preparing to ship' };
  const pending = { state: 'pending', message: item.line_status === 'in_production' ? 'In production; confirming ship timing' : item.line_status === 'received' ? 'Checked in; confirming production timing' : 'Confirming stock arrival', ready_date: null, ship_date: null };
  if (Number(item.missing_qty) > 0) return { ...pending, state: 'delayed', message: 'Some units are delayed; ship estimate pending' };
  if (!source) return pending;
  const demand = quantity(source.sizes, item.size);
  if (demand < Number(item.qty) || !demand) return pending;
  const allocations = [];
  const checkinDays = timing.model?.checkin?.days ?? 2;
  for (const row of picks) {
    if (!['pick', 'pulled'].includes(row.status) || (row.ship_dest && row.ship_dest !== 'in_house')) continue;
    const qty = quantity(row.sizes, item.size);
    if (qty) allocations.push({ qty, ready: addBusinessDays(row.created_at, 3), done: row.status === 'pulled', source: 'warehouse' });
  }
  for (const row of pos) {
    if (row.status === 'cancelled' || row.sizes?.drop_ship) continue;
    const qty = Math.max(0, quantity(row.sizes, item.size) - quantity(row.cancelled, item.size));
    if (!qty) continue;
    // Expected PO arrival wins over the forecast captured at S&S submission.
    // Exact size AND style are required: old vendor_keys may contain the entire batch.
    const keys = (row.sizes?.vendor_keys?.lines || []).filter(l => sizeKey(l.size) === sizeKey(item.size) && String(l.style || '').toUpperCase() === String(source.sku || '').toUpperCase() && String(l.color || '').toUpperCase() === String(source.color || '').toUpperCase());
    const observations = (timing.arrivals || []).filter(a=>!a.invalidated_at && a.so_item_id===source.id && a.po_id===row.po_id && sizeKey(a.size)===sizeKey(item.size) && a.received_target>=qty);
    const actualArrival = latest(observations.map(a=>businessDate(a.arrived_at)));
    const actualCheckin = latest(observations.map(a=>businessDate(a.checked_in_at)));
    const arrival = actualArrival || businessDate(row.expected_date) || latest(keys.map(l => businessDate(l.estimated_arrival)));
    const received = quantity(row.received, item.size) >= qty;
    allocations.push({ qty, arrival, ready: actualCheckin || addBusinessDays(arrival, checkinDays), done: received, source: 'supplier' });
  }
  if (allocations.reduce((n, a) => n + a.qty, 0) < demand) return pending;
  const readyDate = latest(allocations.map(a => a.ready));
  const stockReady = allocations.every(a => a.done);
  const today = businessDate(now);
  const arrivalDate = latest(allocations.filter(a => a.source === 'supplier').map(a => a.arrival));
  const seasonal = seasonalProduction(readyDate || now);
  const useSeasonal = productionDays == null || productionDays === '';
  const production = useSeasonal ? seasonal.max : productionDays !== null && productionDays !== '' && Number.isInteger(Number(productionDays)) && Number(productionDays) >= 0 && Number(productionDays) <= 90 ? Number(productionDays) : null;
  const shipDate = production === null ? null : addBusinessDays(readyDate, production);
  const overdue = (!stockReady && readyDate && readyDate < today) || (shipDate && shipDate < today);
  return {
    state: overdue ? 'delayed' : stockReady ? 'ready' : 'estimated',
    message: overdue ? 'Timing update needed; ship estimate pending' : stockReady ? 'Stock ready for production' : allocations.every(a => a.source === 'warehouse') ? 'Stock pull: allow 3 business days' : `Supplier arrival, then ${checkinDays} business day${checkinDays === 1 ? '' : 's'} for check-in`,
    arrival_date: arrivalDate,
    ready_date: readyDate,
    ship_date: overdue ? null : shipDate,
    production_days: production, production_min_days: useSeasonal ? seasonal.min : production, stock_ready: stockReady,
    checkin_basis: timing.model?.checkin?.qualified ? 'learned' : 'default',
  };
}

// Only called after status-token authorization. Internal PO records never leave
// this helper; exact source-item IDs prevent matching another shopper's same SKU.
async function loadItemEstimates(sb, order, store, items, now = new Date()) {
  if (store?.org_type !== 'all_school') return null;
  const fallback = () => Object.fromEntries(items.map(i => [i.id, estimateItem(i, null, [], [], null, now)]));
  try {
    const link = await sb.from('webstore_orders').select('so_id').eq('id', order.id).maybeSingle();
    if (link.error || !link.data?.so_id) return fallback();
    const result = await sb.from('so_items').select('id,so_id,item_index,sku,color,sizes,source_webstore_item_ids').eq('so_id', link.data.so_id);
    if (result.error) throw result.error;
    const sources = (result.data || []).filter(s => (s.source_webstore_item_ids || []).some(id => items.some(i => i.id === id)));
    if (!sources.length) return fallback();
    const ids = sources.map(s => s.id);
    const [pickResult, poResult] = await Promise.all([
      sb.from('so_item_pick_lines').select('so_item_id,sizes,status,created_at,ship_dest').in('so_item_id', ids),
      sb.from('so_item_po_lines').select('so_item_id,po_id,sizes,received,cancelled,status,expected_date').in('so_item_id', ids),
    ]);
    if (pickResult.error || poResult.error) throw pickResult.error || poResult.error;
    const timing = await loadTimingContext(sb, now);
    return Object.fromEntries(items.map(item => {
      const matches = sources.filter(s => (s.source_webstore_item_ids || []).includes(item.id));
      const source = matches.length === 1 ? matches[0] : null;
      const estimate = estimateItem(item, source,
        (pickResult.data || []).filter(p => p.so_item_id === source?.id),
        (poResult.data || []).filter(p => p.so_item_id === source?.id),
        store.all_school_settings?.production?.business_days ?? null, now, timing || {});
      return [item.id, applyLearnedProduction(estimate, item, source, timing, now)];
    }));
  } catch (error) {
    console.warn('[item-estimates] unavailable:', error.message);
    return fallback();
  }
}
// The planning board and public tracker share exactly the same queue forecast.
// Unreleased work can use learned run timing only after artwork approval; stock
// and current queue tails still set the earliest possible start.
function applyLearnedProduction(base, item, source, timing, now) {
  if (!base || !source || !timing || !base.ready_date || (base.state === 'delayed' && !base.stock_ready) || ['shipped','complete','cancelled','bagging'].includes(item.line_status)) return base;
  const jobs = timing.jobs.filter(j=>j.so_id===source.so_id && (j.items||[]).some(g=>Number(g.item_idx)===Number(source.item_index) && (!g.sizes || quantity(g.sizes,item.size)>0)));
  if (!jobs.length) return base;
  if(jobs.some(j=>!['staging','in_process'].includes(j.prod_status) && j.art_status!=='art_complete'))return {...base,ship_date:null,message:'Awaiting production approval; timing to be confirmed'};
  const byMethod={}, finishes=[], dispatch=[];
  for(const job of jobs){
    const method=methodKey(job.deco_type), days=serviceDays(job,timing.model,base.ready_date), forecast=timing.plan.jobs[jobKey(job)];
    if(Object.prototype.hasOwnProperty.call(timing.plan.tails,method) && timing.plan.tails[method]===null)return {...base,ship_date:null,message:'Production timing update needed'};
    if(days===null)return base;
    if(forecast){if(!forecast.finish_date)return {...base,ship_date:null,message:'Production timing update needed'};finishes.push(base.ready_date>forecast.start_date ? [forecast.finish_date,addBusinessDays(base.ready_date,Math.ceil(days))].sort().pop() : forecast.finish_date);}
    else byMethod[method]=(byMethod[method]||0)+Math.ceil(days);
    dispatch.push(timing.model.methods[method]?.dispatch_days ?? null);
  }
  for(const [method,days] of Object.entries(byMethod)){
    const start=[base.ready_date,businessDate(now),timing.plan.tails[method]||''].sort().pop();
    finishes.push(addBusinessDays(start,days));
  }
  // Keep an explicit store allowance as a floor when learning adds queue timing.
  const finish=latest([...finishes,...(base.production_days!=null?[addBusinessDays(base.ready_date,base.production_days)]:[])]);
  if(!finish)return base;
  const dispatchDays=dispatch.every(d=>d!==null)?Math.max(...dispatch):null;
  const late=base.state==='delayed';
  return {...base,state:late?'delayed':base.state,message:late?'Production is delayed; estimate updated from the current queue':base.message,
    production_finish_date:finish,ship_date:dispatchDays===null?null:addBusinessDays(finish,dispatchDays),
    production_days:null,production_min_days:null,estimate_basis:'learned',estimate_updated_at:timing.model.calculated_at,
    estimate_samples:Math.min(...jobs.map(j=>timing.model.methods[methodKey(j.deco_type)].completed_jobs)),dispatch_pending:dispatchDays===null};
}
module.exports = { estimateItem, loadItemEstimates, applyLearnedProduction };
