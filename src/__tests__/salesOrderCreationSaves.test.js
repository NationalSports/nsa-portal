import fs from 'fs';
import path from 'path';
import {stageDocumentBaseline,reconcileOutboxNotices} from '../lib/documentSaveBaseline';
import {_soDiffCmp,_outboxWrap,_outboxList,_outboxAdd} from '../lib/dbEngine';

const app=fs.readFileSync(path.join(__dirname,'..','App.js'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve};};
const execute=(body,context)=>Function(...Object.keys(context),'return (async()=>{'+body+'})()')(...Object.values(context));
function harness(){
  const _dbSnap={current:{sos:[],ests:[]}},backgroundWrites=[];
  const state={sos:[],ests:[]};
  const publish=key=>updater=>{
    state[key]=updater(state[key]);
    // The real diff-save comparison: any state echo absent from the baseline
    // would dispatch a second full save alongside creation/finalization.
    for(const row of state[key]){
      const baseline=(_dbSnap.current[key]||[]).find(r=>r.id===row.id);
      if(!baseline||_soDiffCmp(row)!==_soDiffCmp(baseline))backgroundWrites.push(row);
    }
  };
  return {_dbSnap,state,backgroundWrites,setSOs:publish('sos'),setEsts:publish('ests'),
    stageDocumentBaseline,setESO:jest.fn(),setESOC:jest.fn(),setEEst:jest.fn(),setPg:jest.fn(),nf:jest.fn(),
    cust:[],sos:[],cu:{id:'rep'},nextSOId:()=> 'SO-NEW'};
}

test('webstore creation and accounting version echo dispatch only one full save',async()=>{
  const ctx=harness(),commit=deferred(),finalize=deferred();
  ctx._dbSaveSO=jest.fn(async so=>{await commit.promise;so._version=1;return true;});
  ctx.supabase={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{webstore_batch_no:1}})})})}),rpc:jest.fn(()=>finalize.promise)};
  const start=app.indexOf('  const webstoreCreateSO=async('),end=app.indexOf('  const savV=',start);
  const pending=execute(app.slice(start,end)+'return webstoreCreateSO({customer_id:"c",items:[{sku:"TEE",sizes:{M:2}}],order_ids:["one"]});',ctx);
  expect(ctx.backgroundWrites).toEqual([]);
  expect(ctx.setESO).not.toHaveBeenCalled();
  commit.resolve();
  // Allow the batch-number read to finish and the finalizer to start.
  for(let i=0;i<10;i++)await Promise.resolve();
  expect(ctx.supabase.rpc).toHaveBeenCalled();
  expect(ctx.setESO).not.toHaveBeenCalled();
  finalize.resolve({data:{ok:true,so_version:2,invoice_id:'INV-1',store_money:{processing:14,tax:25.03,cc_fees:9.85}},error:null});
  expect(await pending).toBe('SO-NEW');
  expect(ctx._dbSaveSO).toHaveBeenCalledTimes(1);
  expect(ctx.backgroundWrites).toEqual([]);
  expect(ctx.setESO.mock.calls[0][0]).toMatchObject({_version:2,_omg_processing:14,webstore_batch_no:1});
  expect(ctx._dbSnap.current.sos[0]).toBe(ctx.state.sos[0]);
});

test.each([true,false])('conversion keeps editor closed until artwork version returns (save=%s)',async saved=>{
  const ctx=harness(),sync=deferred();
  Object.assign(ctx,{est:{id:'EST-1',customer_id:'c',items:[{sku:'TEE'}]},clonedItems:[{sku:'TEE'}],defExp:'2026-10-20',promoAmount:0,safeNum:v=>Number(v)||0,
    _dbSaveSO:jest.fn(async so=>{if(saved)so._version=1;return saved;}),_dbSaveEstimate:jest.fn(async()=>true),
    createArtService:()=>({syncConversion:()=>sync.promise}),supabase:{},_loadArtRow:r=>r});
  const start=app.indexOf('    const _convCust=cust.find(c=>c.id===est.customer_id);');
  const end=app.indexOf('    // Consume the attached pending shipping charge',start);
  const errors=jest.spyOn(console,'error').mockImplementation(()=>{});
  try{
    const pending=execute(app.slice(start,end),ctx);
    for(let i=0;i<5;i++)await Promise.resolve();
    expect(ctx.setESO).not.toHaveBeenCalled();
    sync.resolve({id:'SO-NEW',_version:2,art_files:[{id:'art',version:4,stitches:13833}]});
    await pending;
    expect(ctx.backgroundWrites).toEqual([]);
    expect(ctx._dbSaveSO).toHaveBeenCalledTimes(1);
    if(saved){
      expect(ctx.setESO.mock.calls[0][0]).toMatchObject({_version:2,art_files:[{version:4,stitches:13833}]});
      expect(ctx._dbSnap.current.sos[0]).toBe(ctx.state.sos[0]);
    }else expect(ctx.setESO).not.toHaveBeenCalled();
  }finally{errors.mockRestore();}
});

test('first manual save stages a new order so the background effect does not duplicate it',async()=>{
  const ctx=harness(),row={id:'SO-NEW',memo:'new order'},commit=deferred();
  Object.assign(ctx,{savSO:()=>row,_dbSavePendingIds:new Set(),_dbSaveSO:jest.fn(()=>commit.promise),_hasActiveDocumentSave:()=>false,_markRecentlyPulled:jest.fn()});
  const start=app.indexOf('  const savSONow=(s,opts)=>{'),end=app.indexOf('  // ── Auto-close',start);
  const pending=execute(app.slice(start,end)+'return savSONow(row);',{...ctx,row});
  ctx.setSOs(()=>[row]);
  expect(ctx.backgroundWrites).toEqual([]);
  commit.resolve(true);expect(await pending).toBe(true);
});

afterEach(()=>Object.keys(localStorage).filter(k=>k.startsWith('nsa_outbox')).forEach(k=>localStorage.removeItem(k)));
test('only an acknowledged full save retires an obsolete banner; newer backups and journal drafts remain',async()=>{
  const old={table:'sales_orders',id:'SO-1',revision:'old',payload:{memo:'draft'}};
  const journal={...old,payload:{_draftRecovery:{revision:'other-tab'}}};
  const other={...old,id:'SO-2'};
  const confirmed=jest.fn();window.addEventListener('nsa:document-save-confirmed',confirmed);
  try{
    await _outboxWrap('sales_orders',{id:'SO-1'},Promise.resolve(false));
    expect(confirmed).not.toHaveBeenCalled();
    expect(reconcileOutboxNotices([old],_outboxList(),old)).toEqual([old]);
    await _outboxWrap('sales_orders',{id:'SO-1'},Promise.resolve(true));
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(reconcileOutboxNotices([old,journal,other],_outboxList(),confirmed.mock.calls[0][0].detail)).toEqual([journal,other]);
    const slow=deferred();const pending=_outboxWrap('sales_orders',{id:'SO-1'},slow.promise);
    _outboxAdd('sales_orders',{id:'SO-1',memo:'newer edit'});
    slow.resolve(true);await pending;
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(reconcileOutboxNotices([old],_outboxList(),old)).toEqual([old]);
  }finally{window.removeEventListener('nsa:document-save-confirmed',confirmed);}
});
