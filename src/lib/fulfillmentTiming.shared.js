const { businessDate, addBusinessDays } = require('./businessDates.shared');
function seasonalProduction(value) {
  const day=businessDate(value), month=day?Number(day.slice(5,7)):null;
  const peak=[1,8,9,12].includes(month);
  return {min:peak?7:5,max:peak?8:5,season:peak?'peak':'standard'};
}
const MIN_JOBS = 10, MIN_DAYS = 5, MIN_BATCHES = 10;
const methodKey = value => String(value || '').trim().toLowerCase();
const jobKey = job => `${job.so_id}|${job.job_id || job.id}`;
const sizeBand = qty => qty <= 12 ? '1–12' : qty <= 48 ? '13–48' : '49+';
const quantile = (values, q) => values.length ? values.slice().sort((a,b) => a-b)[Math.ceil(values.length*q)-1] : null;
function businessDaysBetween(from, to) {
  const start = businessDate(from), end = businessDate(to);
  if (!start || !end || end < start) return null;
  let day = start, count = 0;
  while (day < end && count < 366) { day = addBusinessDays(day, 1); if (day <= end) count++; }
  return count;
}
const weekday = date => { const d = new Date(date + 'T12:00:00Z').getUTCDay(); return d !== 0 && d !== 6; };
const rounding = n => Math.round(n * 10) / 10;
function learnTiming(events = [], arrivals = [], now = new Date()) {
  const today = businessDate(now), season = seasonalProduction(now).season;
  const cutoff = new Date(new Date(today + 'T12:00:00Z').getTime() - 60*86400000).toISOString().slice(0,10);
  const grouped = {};
  const history = events.filter(e => businessDate(e.occurred_at) >= cutoff && businessDate(e.occurred_at) < today);
  for (const e of history) (grouped[jobKey(e)] ||= []).push(e);
  const methods = {};
  for (const list of Object.values(grouped)) {
    list.sort((a,b) => new Date(a.occurred_at)-new Date(b.occurred_at));
    const completed = list.filter(e => e.to_status === 'completed');
    // Rework and duplicate completions do not count as new output.
    if (completed.length !== 1) continue;
    const done = completed[0], method = methodKey(done.method), units = Number(done.units);
    const day = businessDate(done.occurred_at);
    if (seasonalProduction(day).season!==season || !method || !Number.isInteger(units) || units <= 0 || !weekday(day)) continue;
    const m = methods[method] ||= { method, completed_jobs: 0, completed_units: 0, daily: {}, runs: [], dispatch: [], bands: {} };
    m.completed_jobs++; m.completed_units += units;
    const daily = m.daily[day] ||= { jobs: 0, units: 0 };
    daily.jobs++; daily.units += units;
    const shipped = list.find(e=>e.to_status==='shipped' && new Date(e.occurred_at)>=new Date(done.occurred_at));
    const dispatch = shipped ? businessDaysBetween(done.occurred_at,shipped.occurred_at) : null;
    if(dispatch!==null && dispatch<=20)m.dispatch.push(dispatch);
    const start = list.find(e => e.to_status === 'in_process' && new Date(e.occurred_at) < new Date(done.occurred_at));
    if (!start || methodKey(start.method) !== method || list.some(e => new Date(e.occurred_at) > new Date(start.occurred_at) && new Date(e.occurred_at) < new Date(done.occurred_at) && ['hold','ready','staging'].includes(e.to_status))) continue;
    const duration = businessDaysBetween(start.occurred_at, done.occurred_at);
    if (duration === null || duration > 20) continue;
    const elapsed = (new Date(done.occurred_at)-new Date(start.occurred_at))/60000;
    const sample = { days: Math.max(1,duration), minutes: businessDate(start.occurred_at) === day && elapsed > 0 && elapsed <= 720 ? elapsed : null };
    m.runs.push(sample); (m.bands[sizeBand(units)] ||= []).push(sample);
  }
  // Count zero-output weekdays too; active-day averages would overpromise capacity.
  const first = history.map(e => businessDate(e.occurred_at)).sort()[0];
  let observedDays = 0;
  if (first) for (let d = first; d < today; d = new Date(new Date(d+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10)) if (weekday(d) && seasonalProduction(d).season===season) observedDays++;
  const model = {};
  for (const [key,m] of Object.entries(methods)) {
    const activeDays = Object.keys(m.daily).length;
    const qualified = m.completed_jobs >= MIN_JOBS && activeDays >= MIN_DAYS && observedDays >= MIN_DAYS;
    const summarize = samples => ({ samples: samples.length, days: samples.length >= MIN_JOBS ? quantile(samples.map(s=>s.days),.8) : null, run_minutes: samples.filter(s=>s.minutes!==null).length >= MIN_JOBS ? rounding(quantile(samples.map(s=>s.minutes).filter(n=>n!==null),.8)) : null });
    model[key] = { method:key, qualified, completed_jobs:m.completed_jobs, active_days:activeDays, observed_days:observedDays,
      jobs_per_day: qualified ? m.completed_jobs/observedDays : null,
      units_per_day: qualified ? m.completed_units/observedDays : null,
      dispatch_samples:m.dispatch.length, dispatch_days:m.dispatch.length>=MIN_JOBS?quantile(m.dispatch,.8):null,
      ...summarize(m.runs), size_bands:Object.fromEntries(Object.entries(m.bands).map(([k,v])=>[k,summarize(v)])),
      daily:Object.entries(m.daily).sort().map(([date, counts])=>({date,...counts})),
    };
  }
  const batches = {};
  for (const a of arrivals) {
    if (!a.request_id || businessDate(a.arrived_at) < cutoff) continue;
    (batches[a.request_id] ||= []).push(a);
  }
  const checkins = Object.values(batches).filter(rows=>rows.every(r=>!r.invalidated_at && r.checked_in_at && businessDate(r.checked_in_at)<today)).map(rows=>{
    const start = rows.map(r=>r.arrived_at).sort()[0], end = rows.map(r=>r.checked_in_at).sort().pop();
    return { days:businessDaysBetween(start,end), date:businessDate(end) };
  }).filter(s=>s.days !== null && s.days<=20);
  const checkinQualified = checkins.length >= MIN_BATCHES && new Set(checkins.map(s=>s.date)).size >= MIN_DAYS;
  return { calculated_at:new Date(now).toISOString(), window_days:60, season, methods:model,
    checkin:{ samples:checkins.length, qualified:checkinQualified, days:checkinQualified ? Math.max(1,quantile(checkins.map(s=>s.days),.8)) : 2 },
  };
}
function serviceDays(job, model, startDate=model?.calculated_at) {
  const m = model?.methods?.[methodKey(job.deco_type)];
  const units = Number(job.total_units);
  if (!m?.qualified || !Number.isFinite(units) || units <= 0) return null;
  const band = m.size_bands?.[sizeBand(units)];
  const duration = band?.days ?? m.days;
  if (duration == null) return null;
  return Math.max(seasonalProduction(startDate).max, duration, units/m.units_per_day, 1/m.jobs_per_day);
}
function planJobs(jobs = [], model, now = new Date()) {
  const today = businessDate(now), tails = {}, result = {};
  const queue = jobs.filter(j=>['staging','in_process'].includes(j.prod_status));
  queue.sort((a,b)=>(a.prod_status==='in_process'?0:1)-(b.prod_status==='in_process'?0:1) || (businessDate(a.expected_date)||'9999').localeCompare(businessDate(b.expected_date)||'9999') || String(a.created_at||'').localeCompare(String(b.created_at||'')) || jobKey(a).localeCompare(jobKey(b)));
  for (const job of queue) {
    const method = methodKey(job.deco_type);
    const ahead = tails[method] || 0;
    const started = job.prod_status==='in_process' ? businessDate(job.started_at) : null;
    const days = serviceDays(job,model,started || addBusinessDays(today,Number.isFinite(ahead)?Math.floor(ahead):0));
    const elapsed = started ? businessDaysBetween(started,today) : 0;
    const m = model?.methods?.[method];
    // Capacity is shared by the department. Do not add parallel machines again:
    // the observed daily output already includes their combined throughput.
    const work = days === null ? null : Math.max(Number(job.total_units)/m.units_per_day,1/m.jobs_per_day) * Math.max(0,1-(elapsed||0)/days);
    if(days!==null && started && elapsed>=days){tails[method]=Infinity;result[jobKey(job)]={job_id:job.id,so_id:job.so_id,method,start_date:started,finish_date:null,reason:'In-process job has exceeded its estimate; timing update needed'};continue;}
    if (work === null || ahead === Infinity) { tails[method]=Infinity; result[jobKey(job)]={job_id:job.id,so_id:job.so_id,method,finish_date:null,reason:'Not enough reliable timing history'}; continue; }
    const finish = ahead+Math.max(0,days-(elapsed||0));
    tails[method]=ahead+work;
    result[jobKey(job)]={job_id:job.id,so_id:job.so_id,method,start_date:started || addBusinessDays(today,Math.floor(ahead)),finish_date:addBusinessDays(today,Math.ceil(finish)),queue_days:Math.ceil(ahead),production_days:Math.ceil(days),samples:m.completed_jobs,expected_date:businessDate(job.expected_date),basis:'learned'};
  }
  return { jobs:result, tails:Object.fromEntries(Object.entries(tails).map(([k,d])=>[k,Number.isFinite(d)?addBusinessDays(today,Math.ceil(d)):null])) };
}
module.exports = { seasonalProduction, learnTiming, planJobs, serviceDays, businessDaysBetween, methodKey, jobKey, sizeBand };
