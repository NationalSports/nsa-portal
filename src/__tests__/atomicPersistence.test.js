// Regression coverage for audit findings F4/F5/F8. These tests exercise the
// exported dbEngine save functions and assert their RPC contract, rather than
// recreating their projections in a separate helper.
jest.mock('@supabase/supabase-js', () => {
  const state={rpcCalls:[],rpcResponse:{data:{ok:true,version:2},error:null},tableCalls:[]};
  const client={
    rpc:(name,args)=>{state.rpcCalls.push({name,args});return Promise.resolve(state.rpcResponse);},
    from:(table)=>{state.tableCalls.push(table);throw new Error('legacy table write must not run');},
    auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
  };
  return{createClient:()=>client,__atomicState:state};
});

const originalEnv={...process.env};
beforeEach(()=>{
  jest.resetModules();
  localStorage.clear();
  process.env.REACT_APP_SUPABASE_URL='https://atomic-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY='test-key';
});
afterEach(()=>{process.env={...originalEnv};jest.resetModules();});

test('customer final-contact deletion is explicit and has no destructive fallback',async()=>{
  const state=require('@supabase/supabase-js').__atomicState;
  state.rpcResponse={data:{ok:true,version:5},error:null};
  const {_dbSaveCustomer}=require('../lib/dbEngine');
  const customer={id:'C-ATOMIC',name:'Atomic High',_version:4,contacts:[]};

  expect(await _dbSaveCustomer(customer)).toBe(true);
  expect(customer._version).toBe(5);
  expect(state.rpcCalls).toEqual([expect.objectContaining({
    name:'save_customer_atomic',args:expect.objectContaining({p_base_version:4,p_contacts:[]}),
  })]);
  expect(state.tableCalls).toEqual([]);
});

test('an unhydrated contact list is not sent as an empty replacement',async()=>{
  const state=require('@supabase/supabase-js').__atomicState;
  state.rpcResponse={data:{ok:true,version:5},error:null};
  const {_dbSaveCustomer}=require('../lib/dbEngine');

  expect(await _dbSaveCustomer({id:'C-CONTACT-TIMEOUT',name:'Atomic High',_version:4,contacts:[],_contactsHydrated:false})).toBe(true);
  expect(state.rpcCalls[0]).toEqual(expect.objectContaining({
    name:'save_customer_atomic',args:expect.objectContaining({p_contacts:null}),
  }));
});

test('invoice stale response preserves the original base and sends no whole-row upsert',async()=>{
  const state=require('@supabase/supabase-js').__atomicState;
  state.rpcResponse={data:{ok:false,reason:'STALE',version:9},error:null};
  const {_dbSaveInvoice,_outboxList}=require('../lib/dbEngine');
  const invoice={id:'INV-ATOMIC',memo:'older draft',_version:4,items:[],payments:[]};

  expect(await _dbSaveInvoice(invoice)).toBe('stale');
  expect(invoice._version).toBe(4);
  expect(_outboxList()).toEqual([expect.objectContaining({id:'INV-ATOMIC',baseVersion:4})]);
  expect(state.rpcCalls[0]).toEqual(expect.objectContaining({
    name:'save_invoice_atomic',args:expect.objectContaining({p_base_version:4,p_items:[],p_payments:[]}),
  }));
  expect(state.tableCalls).toEqual([]);
});

test('invoice payment deletion rejection is surfaced and retained for retry',async()=>{
  const state=require('@supabase/supabase-js').__atomicState;
  state.rpcResponse={data:{ok:false,reason:'PAYMENT_REMOVAL_REQUIRES_REVERSAL'},error:null};
  const {_dbSaveInvoice,_dbSaveFailedIds}=require('../lib/dbEngine');
  const invoice={id:'INV-REVERSAL',_version:3,items:[],payments:[]};

  expect(await _dbSaveInvoice(invoice)).toBe(false);
  expect(_dbSaveFailedIds.has('INV-REVERSAL')).toBe(true);
  // Failure telemetry may use client_events, but no legacy invoice/payment table
  // mutation is allowed after the atomic RPC rejects the deletion.
  expect(state.tableCalls.filter(t=>t!=='client_events')).toEqual([]);
});
