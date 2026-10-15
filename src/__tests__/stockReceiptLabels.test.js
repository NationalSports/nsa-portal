import {buildStockReceiptLabel, saveStockReceiptState} from '../lib/stockReceiptLabels';

const po={id:'ipo-1',po_number:'PO 1010 NSA',items:[
  {sku:'ABC',name:'Shirt',color:'Navy',sizes:{M:20,L:10},received:{M:12}},
  {sku:'XYZ',name:'Cap',sizes:{OS:5}}
]};

test('partial check-in labels contain receipt deltas with stock/PO identifiers',()=>{
  const label=buildStockReceiptLabel(po,{0:{M:3,L:2}},'https://portal.example/','10/14/2026');
  expect(label).toMatchObject({program:'NSA STOCK',code:'PO 1010 NSA',subtitle:'PO 1010 NSA',
    qrData:'https://portal.example/?scan=PO%201010%20NSA',note:'RECEIVED — 10/14/2026',
    codeSub:'5 units · scan to open PO',items:[{title:'ABC Shirt',detail:'Navy · 5 units',sizes:'M: 3  L: 2'}]});
});
test('multiple SKUs and nonstandard sizes share one label',()=>{
  const label=buildStockReceiptLabel(po,{0:{M:8},1:{OS:5}},'');
  expect(label.items).toHaveLength(2);
  expect(label.items[1].sizes).toBe('OS: 5');
  expect(label.codeSub).toContain('13 units');
});
test('empty, negative, nonfinite and unknown item quantities cannot create labels',()=>{
  expect(buildStockReceiptLabel(po,{0:{M:0,L:-1,X:NaN,Y:Infinity,Z:'5'},99:{M:5}},'')).toBeNull();
  expect(buildStockReceiptLabel(po,{},'')).toBeNull();
});
const clientReturning=result=>({from:jest.fn(()=>({upsert:jest.fn(()=>({select:jest.fn(()=>Promise.resolve(result))}))}))});
test('save gate requires the acknowledged inventory PO state',async()=>{
  const client=clientReturning({data:[{id:'inv_pos',value:JSON.stringify([po])}],error:null});
  expect(await saveStockReceiptState(client,[po])).toBe(true);
  expect(client.from).toHaveBeenCalledWith('app_state');
});
test.each([
  {data:null,error:{message:'offline'}},
  {data:[],error:null},
  {data:[{id:'inv_pos',value:'[]'}],error:null}
])('failed or unacknowledged writes suppress labels: %j',async result=>{
  expect(await saveStockReceiptState(clientReturning(result),[po])).toBe(false);
});
test('offline or rejected requests suppress labels',async()=>{
  expect(await saveStockReceiptState(null,[po])).toBe(false);
  expect(await saveStockReceiptState({from:()=>{throw new Error('network')}},[po])).toBe(false);
});
