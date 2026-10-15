import fs from 'fs';
import path from 'path';
import {buildStockReceiptLabel} from '../lib/stockReceiptLabels';

// Exercise the real App handler and persistence effect without booting the ERP or contacting production.
const source=fs.readFileSync(path.join(__dirname,'../App.js'),'utf8');
const receiveSource=source.slice(source.indexOf('  const receiveInvPO='),source.indexOf('  const printInvPOPackingList='));
const effectStart=source.indexOf('    const pending=stockReceiptPending.current.splice(0);');
const effectSource=source.slice(effectStart,source.indexOf('  },[invPOs]);',effectStart));
function harness(ok=true,mobile=true){
  const ctx={invPOs:[{id:'p1',po_number:'PO 1010 NSA',status:'ordered',items:[{sku:'ABC',sizes:{M:10},received:{M:4}}]}],
    stockReceiptPending:{current:[]},stockReceiptSaving:{current:new Map()},stockReceiptWindow:{current:null},
    mobileMode:mobile,cu:{name:'Warehouse'},prod:[],
    buildStockReceiptLabel,stockReceiptLabels:[],
    _initialLoadDone:{current:true},_dbLoadSuccess:{current:true},supabase:{},
    _lsSet:jest.fn(),_saveAppState:jest.fn(),_dbSavingGuard:fn=>fn(),
    saveStockReceiptState:jest.fn(async()=>ok),printQrLabels:jest.fn(),nf:jest.fn(),logChange:jest.fn()};
  ctx.setInvPOs=update=>{ctx.invPOs=update(ctx.invPOs)};
  ctx.setStockReceiptLabels=update=>{ctx.stockReceiptLabels=update(ctx.stockReceiptLabels)};
  const run=code=>Function('ctx','with(ctx){'+code+'}')(ctx);
  ctx.receive=(id='p1')=>run(receiveSource+'return receiveInvPO;')(id,{0:{M:3}});
  ctx.flush=()=>run(effectSource);
  return ctx;
}
test('receipt labels wait for the save; repeated click does not receive twice',async()=>{
  const h=harness();const saved=h.receive();
  expect(h.receive()).toBe(saved);
  expect(h.invPOs[0].items[0].received.M).toBe(7);
  expect(h.stockReceiptLabels).toEqual([]);
  h.flush();expect(await saved).toBe(true);
  expect(h.stockReceiptLabels[0].items[0].sizes).toBe('M: 3');
  expect(h.printQrLabels).not.toHaveBeenCalled();
});
test('failed save never exposes a label or a success toast',async()=>{
  const h=harness(false);const saved=h.receive();h.flush();
  expect(await saved).toBe(false);
  expect(h.stockReceiptLabels).toEqual([]);
  expect(h.printQrLabels).not.toHaveBeenCalled();
  expect(h.nf).toHaveBeenCalledWith(expect.stringContaining('No label issued'),'error');
});
test('desktop prints through the window reserved by the user click',async()=>{
  const popup={document:{body:{}},closed:false,close:jest.fn()};
  const open=jest.spyOn(window,'open').mockReturnValue(popup);
  try{
    const h=harness(true,false);const saved=h.receive();
    expect(open).toHaveBeenCalledTimes(1);expect(h.printQrLabels).not.toHaveBeenCalled();
    h.flush();await saved;
    expect(h.printQrLabels).toHaveBeenCalledWith(h.stockReceiptLabels,popup);
  }finally{open.mockRestore()}
});
test('blocked desktop popup still leaves a user-triggered print option',async()=>{
  const open=jest.spyOn(window,'open').mockReturnValue(null);
  try{const h=harness(true,false);const saved=h.receive();h.flush();await saved;
    expect(h.stockReceiptLabels).toHaveLength(1);expect(h.printQrLabels).not.toHaveBeenCalled();
  }finally{open.mockRestore()}
});

test('stock batch check-in acknowledges all POs and retains every label',async()=>{
  const h=harness();h.invPOs.push({...h.invPOs[0],id:'p2',po_number:'PO 1011 NSA'});
  const first=h.receive(),second=h.receive('p2');h.flush();
  expect(await Promise.all([first,second])).toEqual([true,true]);
  expect(h.saveStockReceiptState).toHaveBeenCalledTimes(1);
  expect(h.stockReceiptLabels.map(label=>label.code)).toEqual(['PO 1010 NSA','PO 1011 NSA']);
});
test('failed desktop save closes the reserved window',async()=>{
  const popup={document:{body:{}},closed:false,close:jest.fn()};
  const open=jest.spyOn(window,'open').mockReturnValue(popup);
  try{const h=harness(false,false);const saved=h.receive();h.flush();await saved;
    expect(popup.close).toHaveBeenCalledTimes(1);expect(h.printQrLabels).not.toHaveBeenCalled();
  }finally{open.mockRestore()}
});
