// Regression for the EST-2771 seven-to-five item loss. Drives the real save path.
jest.mock('@supabase/supabase-js', () => {
  const state = { responses: {}, calls: [] };
  const DEFAULT = { data: null, error: null, count: 0 };
  const makeBuilder = (table) => {
    let method = null;
    const builder = {
      upsert: (...a) => { method = 'upsert'; builder._args = a; return builder; },
      insert: (...a) => { method = 'insert'; builder._args = a; return builder; },
      update: (...a) => { method = 'update'; builder._args = a; return builder; },
      delete: (...a) => { method = 'delete'; builder._args = a; return builder; },
      select: (...a) => { if (!method) method = 'select'; builder._selectArgs = a; return builder; },
      eq: (...a) => { builder._eqArgs = a; return builder; },
      in: (...a) => { builder._inArgs = a; return builder; },
      maybeSingle: () => builder,
      single: () => builder,
      then: (resolve, reject) => {
        state.calls.push({ table, method, args: builder._args, selectArgs: builder._selectArgs, eqArgs: builder._eqArgs, inArgs: builder._inArgs });
        const q = state.responses[table] || [];
        const resp = q.length ? q.shift() : DEFAULT;
        return Promise.resolve(resp).then(resolve, reject);
      },
    };
    return builder;
  };
  const client = {
    from: (table) => makeBuilder(table),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: (name,args) => {
      if(name==='save_estimate'){
        state.calls.push({table:'RPC',method:name,args:[args]});
        return Promise.resolve({data:{estimate_id:args.p_estimate.id,version:23,item_count:args.p_items.length},error:null});
      }
      return require('../testHelpers/atomicSaveRpc')(state,name,args);
    },
  };
  return { createClient: () => client, __mockState: state };
});


const originalEnv={...process.env};
const dbItems=['JX4451','JL7049','IR6328','IS1111','5157781','JX6802','JW6604'].map((sku,item_index)=>({
  id:100+item_index,line_id:'line-'+item_index,item_index,sku,color:'Black',name:sku,sizes:{M:2},decorations:[],
}));
const draft=(items=dbItems.slice(0,5),extra={})=>({id:'EST-2771',customer_id:'customer',_version:19,_itemsHydrated:true,items:JSON.parse(JSON.stringify(items)),...extra});
const setup=()=>{
  const {__mockState:state}=require('@supabase/supabase-js');
  state.responses={estimates:[{data:{_version:22},error:null}],estimate_items:[{data:dbItems,error:null}],estimate_art_files:[{data:[],error:null}],estimate_item_decorations:[{data:[],error:null}]};
  const engine=require('../lib/dbEngine');
  engine._dbOwnVersions['EST-2771']=22;
  return {state,engine};
};
const saveCalls=state=>state.calls.filter(c=>c.method==='save_estimate');
beforeEach(()=>{
  jest.resetModules();localStorage.clear();
  process.env.REACT_APP_SUPABASE_URL='https://estimate-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY='test-key';
});
afterEach(()=>{process.env={...originalEnv};jest.restoreAllMocks();});

test.each([false,true])('EST-2771: older five-line copy cannot overwrite seven saved lines (background=%s)',async background=>{
  const {state,engine}=setup();
  const conflict=jest.fn();engine._setOnOutboxConflict(conflict);
  if(background)engine._bgSyncInc();
  try {
    expect(await engine._dbSaveEstimate(draft())).toBe(false);
    expect(saveCalls(state)).toHaveLength(0);
    expect(conflict).toHaveBeenCalled();
    expect(engine._dbSaveFailedIds.has('EST-2771')).toBe(false);
  }finally{if(background)engine._bgSyncDec();}
});
test('explicit Remove actions still allow the intended two-line deletion',async()=>{
  const {state,engine}=setup();
  expect(await engine._dbSaveEstimate(draft(undefined,{_deletedItemKeys:['jx6802|black','jw6604|black']}))).toBe(true);
  expect(saveCalls(state)[0].args[0].p_items).toHaveLength(5);
});
test('one Remove action cannot authorize dropping a second line',async()=>{
  const {state,engine}=setup();
  expect(await engine._dbSaveEstimate(draft(undefined,{_deletedItemKeys:['jx6802|black']}))).toBe(false);
  expect(saveCalls(state)).toHaveLength(0);
});
test('an ordinary item addition still saves',async()=>{
  const {state,engine}=setup();
  expect(await engine._dbSaveEstimate(draft([...dbItems,{sku:'NEW',color:'Black',sizes:{M:3},decorations:[]}]))).toBe(true);
  expect(saveCalls(state)[0].args[0].p_items).toHaveLength(8);
});
