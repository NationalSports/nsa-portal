// Execute the actual App mutation builders and completion boundaries with mocked
// persistence. These are behavioral regressions, not source-pattern assertions.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { createBillApplySession, billingAttemptKey, sameBillingSnapshot } from '../billApplySession';
import { portalBillAlreadyApplied } from '../appliedBillsLedger';
import { duplicateBillDetail } from '../lib/billAnomalies';

const source=fs.readFileSync(path.join(__dirname,'../App.js'),'utf8');
const fn=name=>{
  const start=source.indexOf('    const '+name+'=');
  if(start<0)throw new Error('Missing function '+name);
  return source.slice(start,source.indexOf('\n    };',start)+7);
};
const context=(orders=[],inventory=[],batches=[])=>{
  const c={sos:orders,invPOs:inventory,submittedBatches:batches,createBillApplySession,billingAttemptKey,sameBillingSnapshot,portalBillAlreadyApplied,
    _billApplySession:{current:createBillApplySession()},_billApplyData:{current:{sos:orders,invPOs:inventory,submittedBatches:batches}},
    _initialLoadDone:{current:true},_dbLoadSuccess:{current:true},
    safeNum:n=>Number(n)||0,cu:{name:'Test'},setTimeout,nf:jest.fn(),
    setBillImport:jest.fn(),setSavedBills:jest.fn(),_lsSet:jest.fn(),
    _liveBillPushHoldReasons:()=>[],_soPoAutoMappings:()=>null,_docAlreadyApplied:()=>false,
    _applyBillByMappings:()=>false,_applyBillToBatchSOs:()=>{},_alignSize:x=>x,_learnAliasesFromBill:()=>{},duplicateBillDetail,
    _siMarkDoc:jest.fn(),resolveMappedSoItemIndex:(items,mp)=>items.findIndex(i=>i.id===mp.item_id),
  };
  c.setSOs=update=>{c.sos=typeof update==='function'?update(c.sos):update};
  c.setInvPOs=update=>{c.invPOs=typeof update==='function'?update(c.invPOs):update};
  c.setSubmittedBatches=update=>{c.submittedBatches=typeof update==='function'?update(c.submittedBatches):update};
  c._dbSaveSO=jest.fn(async()=>true);c._recordAppliedBills=jest.fn(async()=>true);
  c.appSave=jest.fn(async()=>({error:null}));c.supabase={from:()=>({upsert:c.appSave})};
  vm.createContext(c);
  const stageStart=source.indexOf('    const _billStages=');
  const stageEnd=source.indexOf('    // Apply parsed bill data',stageStart);
  vm.runInContext(source.slice(stageStart,stageEnd),c);
  for(const name of ['_applyDecorationBillManually','_applyDecorationBillToSO','applyBillToSO','_confirmPortalBill','_applyBillsToPortal','_retryBillSave','_applyCreditToPortal']){
    vm.runInContext(fn(name)+'\nthis.'+name+'='+name,c);
  }
  return c;
};
const decoBill=(id='B1')=>({id,parsed:{kind:'decoration',doc_number:id,doc_total:100,po_number:'DPO1',matchedPOSource:'so_deco_po',matchedPO:{so_id:'SO1',deco_po:{id:'D1'}}}});
const decoOrder=()=>({id:'SO1',items:[],deco_pos:[{id:'D1',po_id:'DPO1',_bill_cost:0}]});

test('no-write error Retry cannot ledger an unchanged existing order',async()=>{
  const c=context([{id:'SO1',items:[]}]);const b={id:'B1',portalStatus:'error',parsed:{doc_number:'B1',matchedPO:{so_id:'SO1'}}};
  expect(await c._retryBillSave(b)).toBe(false);
  expect(c._dbSaveSO).not.toHaveBeenCalled();expect(c._recordAppliedBills).not.toHaveBeenCalled();expect(b.portalStatus).toBe('error');
});

test.each(['automatic','manual'])('missing %s decoration target does not become applied',async mode=>{
  const c=context([{id:'SO1',items:[],deco_pos:[]}]);const b=decoBill();
  if(mode==='manual')b.parsed._manualTarget={soId:'SO1',mode:'existing',decoPoId:'missing'};
  expect(await c._applyBillsToPortal([b])).toBe(0);expect(b.portalStatus).toBe('error');expect(b.parsed._applied).toBeUndefined();
  expect(c._dbSaveSO).not.toHaveBeenCalled();expect(c._recordAppliedBills).not.toHaveBeenCalled();
});

test('decoration failure retries the same cost once, including after render-like re-entry',async()=>{
  const c=context([decoOrder()]);const b=decoBill();c._dbSaveSO.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect(await c._applyBillsToPortal([b])).toBe(0);
  expect(c.sos[0].deco_pos[0]._bill_cost).toBe(0);expect(b.parsed._applied).toBeUndefined();
  expect(await c._retryBillSave(b)).toBe(true);
  expect(c.sos[0].deco_pos[0]._bill_cost).toBe(100);expect(c.sos[0].deco_pos[0]._bill_details).toHaveLength(1);
  expect(c._dbSaveSO.mock.calls[0][0]).toEqual(c._dbSaveSO.mock.calls[1][0]);expect(c._recordAppliedBills).toHaveBeenCalledTimes(1);
});

test.each(['inv_po','batch'])('missing %s target cannot ledger even with bill quantities',async source=>{
  const c=context();const b={id:'B',parsed:{doc_number:'B',matchedPOSource:source,matchedPO:{id:'missing'},items:[{size:'M',qty:2}]}};
  expect(await c._applyBillsToPortal([b])).toBe(0);expect(c.appSave).not.toHaveBeenCalled();expect(c._recordAppliedBills).not.toHaveBeenCalled();
});

test.each(['inv_po','batch'])('%s requires app_state confirmation, then retries without adding quantities twice',async source=>{
  const target={id:'P1',po_number:'P1',items:[],billed:{M:0}};
  const c=context([],source==='inv_po'?[target]:[],source==='batch'?[target]:[]);
  c.appSave.mockResolvedValueOnce({error:{message:'offline'}}).mockResolvedValueOnce({error:null});
  const b={id:'B',parsed:{doc_number:'B',matchedPOSource:source,matchedPO:target,items:[{size:'M',qty:2}]}};
  expect(await c._applyBillsToPortal([b])).toBe(0);expect(c._recordAppliedBills).not.toHaveBeenCalled();
  expect(await c._retryBillSave(b)).toBe(true);
  const rows=source==='inv_po'?c.invPOs:c.submittedBatches;expect(rows[0].billed.M).toBe(2);
  expect(c.appSave.mock.calls[0][0].value).toBe(c.appSave.mock.calls[1][0].value);
});

const creditFixture=()=>({
  order:{id:'SO1',items:[{id:'I1',po_lines:[{po_id:'PO1',billed:{M:2},_bill_cost:20}]}]},
  bill:{id:'C1',parsed:{doc_number:'C1',is_credit:true,items:[{unit_price:10}],matchedPO:{so_id:'SO1'}}},
  plan:{ties:[{target_idx:0,bill_idx:0,qty:1}],totalUnits:1,originalDoc:'INV1'},
  targets:[{item_id:'I1',po_id:'PO1',size:'M',unit_cost:10}],
});
test('credit requires durable SO save and retries its reversal exactly once',async()=>{
  const {order,bill,plan,targets}=creditFixture();const c=context([order]);c._dbSaveSO.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect(await c._applyCreditToPortal(bill,plan,targets)).toBe(false);
  expect(c._recordAppliedBills).not.toHaveBeenCalled();expect(c.sos[0].items[0].po_lines[0].billed.M).toBe(2);
  expect(await c._retryBillSave(bill)).toBe(true);
  const pl=c.sos[0].items[0].po_lines[0];expect(pl.billed.M).toBe(1);expect(pl._bill_cost).toBe(10);expect(pl._bill_details).toHaveLength(1);
});
test('stale or excessive credit plan is not silently clamped and recorded',async()=>{
  const {order,bill,plan,targets}=creditFixture();const c=context([order]);plan.ties[0].qty=3;
  expect(await c._applyCreditToPortal(bill,plan,targets)).toBe(false);expect(c._dbSaveSO).not.toHaveBeenCalled();expect(c._recordAppliedBills).not.toHaveBeenCalled();
});

test('actual QBO completion block cannot ledger a no-op Portal apply',async()=>{
  const c=context([{id:'SO1',items:[],deco_pos:[]}]);c.b=decoBill();c.bill=c.b.parsed;c.qboBillId='MOCK';
  const start=source.indexOf('          const portalWasAlreadyApplied=');const end=source.indexOf('          const action=created?',start);
  await vm.runInContext('(async()=>{'+source.slice(start,end)+'})()',c);
  expect(c.b.portalStatus).toBe('error');expect(c.b.portalMsg).toContain('QBO Bill #MOCK exists');expect(c._recordAppliedBills).not.toHaveBeenCalled();
});

test('ledger failure is an error; retry only records the original bill and does not resave targets',async()=>{
  const c=context([decoOrder()]);const b=decoBill();c._recordAppliedBills.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect(await c._applyBillsToPortal([b])).toBe(0);expect(b.portalStatus).toBe('error');expect(b.parsed._applied).toBeUndefined();
  b.parsed.doc_total=999;
  expect(await c._retryBillSave(b)).toBe(true);expect(c._dbSaveSO).toHaveBeenCalledTimes(1);
  expect(c._recordAppliedBills.mock.calls[1][0][0].parsed.doc_total).toBe(100);
});

test('actual mapping builder confirms every order and retries without doubling the successful first order',async()=>{
  const orders=['SO1','SO2'].map(id=>({id,items:[{id:'I1',sku:'SKU',po_lines:[{po_id:'PO1',M:2,unit_cost:10,billed:{M:0}}]}]}));
  const c=context(orders);
  vm.runInContext(fn('_applyBillByMappings')+'\nthis._applyBillByMappings=_applyBillByMappings',c);
  const b={id:'MULTI',parsed:{doc_number:'MULTI',matchedPOSource:'so_po',matchedPO:{so_id:'SO1'},freight:0,
    _lineMappings:orders.map(so=>({so_id:so.id,item_id:'I1',po_id:'PO1',size:'M',allocated_qty:1,bill_cost:10,bill_unit:10}))}};
  c._dbSaveSO.mockImplementation(async so=>so.id==='SO1');
  expect(await c._applyBillsToPortal([b])).toBe(0);expect(c._recordAppliedBills).not.toHaveBeenCalled();
  expect(c.sos.every(so=>so.items[0].po_lines[0].billed.M===0)).toBe(true);
  c._dbSaveSO.mockResolvedValue(true);
  expect(await c._retryBillSave(b)).toBe(true);
  expect(c._dbSaveSO.mock.calls.map(([so])=>so.id)).toEqual(['SO1','SO2','SO2']);
  expect(c.sos.every(so=>so.items[0].po_lines[0].billed.M===1&&so.items[0].po_lines[0]._bill_details.length===1)).toBe(true);
  expect(c._dbSaveSO.mock.calls.every(([,opts])=>opts.exactAttempt===true)).toBe(true);
});

test('one stale target in a multi-order mapping fails before any writes',async()=>{
  const c=context([{id:'SO1',items:[{id:'I1',po_lines:[{po_id:'PO1'}]}]}]);
  const b={id:'MULTI',parsed:{doc_number:'MULTI',matchedPOSource:'so_po',matchedPO:{so_id:'SO1'},
    _lineMappings:['SO1','missing'].map(so_id=>({so_id,item_id:'I1',po_id:'PO1',size:'M',allocated_qty:1,bill_cost:10}))}};
  expect(await c._applyBillsToPortal([b])).toBe(0);expect(c._dbSaveSO).not.toHaveBeenCalled();expect(c._recordAppliedBills).not.toHaveBeenCalled();
});

test('a stale safety hold blocks the actual write boundary',async()=>{
  const c=context([decoOrder()]);c._liveBillPushHoldReasons=()=>['vendor mismatch'];const b=decoBill();
  expect(await c._applyBillsToPortal([b])).toBe(0);expect(b.portalMsg).toContain('vendor mismatch');
  expect(c._dbSaveSO).not.toHaveBeenCalled();expect(c._recordAppliedBills).not.toHaveBeenCalled();
});
