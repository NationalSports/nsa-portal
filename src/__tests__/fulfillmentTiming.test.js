const { seasonalProduction, learnTiming, planJobs, serviceDays } = require('../lib/fulfillmentTiming.shared');
const { estimateItem, applyLearnedProduction } = require('../../netlify/functions/_webstoreItemEstimates');
const now = new Date('2026-10-12T20:00:00Z');
function history() {
 return ['2026-10-01','2026-10-02','2026-10-05','2026-10-06','2026-10-07'].flatMap((d,i)=>[0,1].flatMap(n=>[
  {so_id:'SO',job_id:`${i}-${n}`,to_status:'in_process',method:'Embroidery',units:12,occurred_at:d+'T16:00:00Z'},
  {so_id:'SO',job_id:`${i}-${n}`,to_status:'completed',method:'Embroidery',units:12,occurred_at:d+'T18:00:00Z'},
  {so_id:'SO',job_id:`${i}-${n}`,to_status:'shipped',method:'Embroidery',units:12,occurred_at:d+'T20:00:00Z'},
 ]));
}
const job=(id,extra={})=>({id,so_id:'SO',deco_type:'Embroidery',total_units:12,prod_status:'staging',items:[{item_idx:0}],...extra});
test.each(Array.from({length:12},(_,i)=>i+1))('seasonal production month %i', month=>{
 expect(seasonalProduction(`2026-${String(month).padStart(2,'0')}-15`)).toMatchObject([1,8,9,12].includes(month)?{min:7,max:8}:{min:5,max:5});
});
test('learning requires enough distinct working days and includes idle days in capacity',()=>{
 const model=learnTiming(history(),[],now), m=model.methods.embroidery;
 expect(m).toMatchObject({qualified:true,completed_jobs:10,active_days:5,observed_days:7,days:1,run_minutes:120,dispatch_days:0});
 expect(m.jobs_per_day).toBeCloseTo(10/7);
 expect(m.units_per_day).toBeCloseTo(120/7);
 expect(learnTiming(history().slice(0,27),[],now).methods.embroidery.qualified).toBe(false);
 expect(serviceDays(job('a'),model)).toBe(5);
 expect(serviceDays(job('a'),model,'2026-12-01')).toBe(8);
});
test('current-day output, previous season and repeated completions cannot inflate capacity',()=>{
 const events=history();
 events.push({...events[1],job_id:'today',occurred_at:'2026-10-12T18:00:00Z'}, {...events[1],job_id:'peak',occurred_at:'2026-09-25T18:00:00Z'});
 expect(learnTiming(events,[],now).methods.embroidery.completed_jobs).toBe(10);
 events.push({...events[1],occurred_at:'2026-10-02T18:00:00Z'});
 expect(learnTiming(events,[],now).methods.embroidery.completed_jobs).toBe(9);
});
test('paused jobs count as output but not uninterrupted run samples',()=>{
 const events=history();events.push({...events[0],to_status:'hold',occurred_at:'2026-10-01T17:00:00Z'});
 const m=learnTiming(events,[],now).methods.embroidery;
 expect(m.completed_jobs).toBe(10);expect(m.samples).toBe(9);expect(m.days).toBeNull();
});
test('check-in learns from whole batches and excludes corrections and incomplete batches',()=>{
 const arrivals=['2026-10-01','2026-10-02','2026-10-05','2026-10-06','2026-10-07'].flatMap((d,i)=>[0,1].map(n=>({request_id:`${i}-${n}`,arrived_at:d+'T15:00:00Z',checked_in_at:d+'T18:00:00Z'})));
 expect(learnTiming([],arrivals,now).checkin).toEqual({samples:10,qualified:true,days:1});
 arrivals.push({...arrivals[0],checked_in_at:null});
 expect(learnTiming([],arrivals,now).checkin).toEqual({samples:9,qualified:false,days:2});
 arrivals[1].invalidated_at='2026-10-08T18:00:00Z';
 expect(learnTiming([],arrivals,now).checkin.samples).toBe(8);
});
test('queue shares daily capacity and preserves production allowance after each start',()=>{
 const model=learnTiming(history(),[],now);
 const plan=planJobs([job('later',{expected_date:'2026-10-30'}),job('earlier',{expected_date:'2026-10-20'}),job('active',{prod_status:'in_process'}),job('held',{prod_status:'hold'})],model,now);
 expect(Object.keys(plan.jobs)).toEqual(['SO|active','SO|earlier','SO|later']);
 expect(plan.jobs['SO|active']).toMatchObject({start_date:'2026-10-12',finish_date:'2026-10-19'});
 expect(plan.jobs['SO|later'].finish_date).toBe('2026-10-21');
 expect(plan.jobs['SO|held']).toBeUndefined();
 expect(planJobs([job('unknown',{deco_type:'Print'})],model,now).jobs['SO|unknown'].finish_date).toBeNull();
});
test('public estimates share the planning finish and withhold shipping when dispatch history is missing',()=>{
 const model=learnTiming(history(),[],now), jobs=[job('a')], plan=planJobs(jobs,model,now);
 const base={state:'ready',stock_ready:true,ready_date:'2026-10-12',ship_date:'2026-10-19'};
 const item={size:'M',qty:1}, source={so_id:'SO',item_index:0};
 expect(applyLearnedProduction(base,item,source,{model,jobs,plan},now)).toMatchObject({production_finish_date:plan.jobs['SO|a'].finish_date,ship_date:'2026-10-19',estimate_basis:'learned'});
 model.methods.embroidery.dispatch_days=null;
 expect(applyLearnedProduction(base,item,source,{model,jobs,plan},now)).toMatchObject({ship_date:null,dispatch_pending:true});
});
test('season is determined by readiness and confirmed dock arrival supersedes supplier ETA',()=>{
 const item={size:'M',qty:2}, source={id:1,sizes:{M:2}};
 const po={po_id:'PO1',sizes:{M:2},expected_date:'2026-11-30'};
 expect(estimateItem(item,source,[],[po],null,new Date('2026-11-25T20:00:00Z'))).toMatchObject({ready_date:'2026-12-02',production_days:8,production_min_days:7});
 const timing={model:{checkin:{days:1,qualified:true}},arrivals:[{so_item_id:1,po_id:'PO1',size:'M',received_target:2,arrived_at:'2026-12-01T20:00:00Z',checked_in_at:'2026-12-03T20:00:00Z'}]};
 expect(estimateItem(item,source,[],[{...po,received:{M:2}}],null,new Date('2026-12-03T20:00:00Z'),timing)).toMatchObject({arrival_date:'2026-12-01',ready_date:'2026-12-03',stock_ready:true});
});
test('in-process work uses its real start and overruns request a revised estimate',()=>{
 const model=learnTiming(history(),[],now);
 let jobs=[job('a',{prod_status:'in_process',started_at:'2026-10-08T16:00:00Z'})];
 let plan=planJobs(jobs,model,now);
 expect(plan.jobs['SO|a']).toMatchObject({start_date:'2026-10-08',finish_date:'2026-10-15'});
 jobs=[job('a',{prod_status:'in_process',started_at:'2026-10-01T16:00:00Z'})];plan=planJobs(jobs,model,now);
 expect(plan.jobs['SO|a'].finish_date).toBeNull();
 expect(applyLearnedProduction({state:'ready',stock_ready:true,ready_date:'2026-10-01',ship_date:'2026-10-15'},{size:'M'},{so_id:'SO',item_index:0},{model,jobs,plan},now).ship_date).toBeNull();
});
test('learned estimates do not shorten an explicit store production allowance',()=>{
 const model=learnTiming(history(),[],now), jobs=[job('a')], plan=planJobs(jobs,model,now);
 const result=applyLearnedProduction({state:'ready',stock_ready:true,ready_date:'2026-10-12',production_days:10},{size:'M'},{so_id:'SO',item_index:0},{model,jobs,plan},now);
 expect(result.ship_date).toBe('2026-10-26');
});
