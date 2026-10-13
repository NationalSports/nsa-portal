const { learnTiming, planJobs } = require('../../src/lib/fulfillmentTiming.shared');
const cache = new Map();
async function allRows(build, max=20000) {
  const rows=[];
  for(let offset=0;offset<max;offset+=1000){
    const r=await build().range(offset,offset+999);
    if(r.error)throw r.error;
    rows.push(...(r.data||[]));
    if((r.data||[]).length<1000)return rows;
  }
  throw new Error('Timing data exceeds safe snapshot limit');
}
async function loadTimingContext(sb, now=new Date()) {
  const key=sb.supabaseUrl, hit=key&&cache.get(key);
  if(hit&&new Date(now).getTime()-hit.at<60000)return hit.data;
  const since=new Date(new Date(now).getTime()-90*86400000).toISOString();
  try {
    const [events,arrivals,jobs]=await Promise.all([
      allRows(()=>sb.from('fulfillment_job_events').select('id,so_id,job_id,from_status,to_status,method,units,machine,occurred_at').gte('occurred_at',since).order('id')),
      allRows(()=>sb.from('fulfillment_arrivals').select('id,request_id,so_id,so_item_id,po_id,size,quantity,received_target,arrived_at,checked_in_at,invalidated_at').gte('arrived_at',since).order('id')),
      allRows(()=>sb.from('so_jobs').select('id,so_id,key,deco_type,total_units,prod_status,art_status,items,created_at').in('prod_status',['hold','ready','staging','in_process']).order('id'),5000),
    ]);
    const ids=[...new Set(jobs.map(j=>j.so_id))], orders=[];
    for(let i=0;i<ids.length;i+=250){const r=await sb.from('sales_orders').select('id,expected_date,status').in('id',ids.slice(i,i+250));if(r.error)throw r.error;orders.push(...(r.data||[]));}
    const orderMap=new Map(orders.map(o=>[o.id,o]));
    const starts=new Map();
    for(const e of events)if(e.to_status==='in_process'){
      const key=`${e.so_id}|${e.job_id}`;
      if(!starts.has(key)||e.occurred_at>starts.get(key))starts.set(key,e.occurred_at);
    }
    const activeJobs=jobs.filter(j=>!String(j.key||'').startsWith('outside_art:')&&orderMap.has(j.so_id)&&!['cancelled','complete'].includes(orderMap.get(j.so_id).status)).map(j=>({...j,expected_date:orderMap.get(j.so_id).expected_date,started_at:j.prod_status==='in_process'?starts.get(`${j.so_id}|${j.id}`):null}));
    const model=learnTiming(events,arrivals,now), plan=planJobs(activeJobs,model,now);
    const data={model,plan,jobs:activeJobs,arrivals};
    if(key){if(cache.size>4)cache.clear();cache.set(key,{at:new Date(now).getTime(),data});}
    return data;
  }catch(error){console.warn('[fulfillment-timing] unavailable:',error.message);return null;}
}
function clearTimingCache(){cache.clear();}
module.exports={loadTimingContext,clearTimingCache};
