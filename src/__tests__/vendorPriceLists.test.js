let mockCreateOcr;
jest.mock('tesseract.js',()=>({createWorker:(...args)=>mockCreateOcr(...args)}));
let mockAuth;
jest.mock('../../netlify/functions/_shared',()=>({corsHeaders:()=>({}),verifyUser:async()=>mockAuth}));
jest.mock('../utils',()=>({authFetch:jest.fn()}));
jest.mock('../lib/supabase',()=>({supabase:{}}));
const {handler,_test}=require('../../netlify/functions/vendor-price-lists');
const {sheetChunks,extractPriceList}=require('../lib/vendorPriceLists');
function db(tables={},rpcData=[]) {
  const queries=[];
  return {queries,rpc:jest.fn(async()=>({data:rpcData})),from(table){
    const entry={table,filters:[]};queries.push(entry);
    const chain={};for(const op of ['select','eq','in','ilike','limit','order','insert','update']) chain[op]=(...args)=>{entry.filters.push([op,...args]);return chain;};
    chain.maybeSingle=async()=>({data:tables[table]?.[0]||null});
    chain.then=(res,rej)=>Promise.resolve(tables[table]?.error?tables[table]:{data:tables[table]||[]}).then(res,rej);
    return chain;
  }};
}
const post=body=>handler({httpMethod:'POST',body:JSON.stringify(body)});
beforeEach(()=>{mockAuth={ok:true,userId:'u',admin:db()};});
test('requires active staff authentication for search and file reads',async()=>{
  mockAuth={ok:false,status:403,error:'Inactive account'};
  expect((await post({action:'search',query:'JY6033'})).statusCode).toBe(403);
  expect((await post({action:'download',id:'x'})).statusCode).toBe(403);
});
test('file type, size, dates and chunk limits reject invalid uploads',()=>{
  const valid={file_name:'Prices.xlsx',file_size:300,effective_date:'2026-01-01',expires_on:'2026-12-31'};
  expect(_test.validateUpload(valid).ext).toBe('xlsx');
  expect(()=>_test.validateUpload({...valid,file_name:'evil.html'})).toThrow(/Choose/);
  expect(()=>_test.validateUpload({...valid,file_size:21*1024*1024})).toThrow(/20 MB/);
  expect(()=>_test.validateUpload({...valid,expires_on:'2025-01-01'})).toThrow(/Expiry/);
  expect(()=>_test.validateUpload({...valid,effective_date:'2026-02-30'})).toThrow(/valid date/);
  expect(()=>_test.validateChunks([])).toThrow();
  expect(()=>_test.validateChunks([{location:'p1',content:'x'.repeat(12001)}])).toThrow();
});
test('exact vendor match wins over Adidas divisions; divisions never borrow Adidas stock',async()=>{
  const admin=db({vendors:[{id:'golf',name:'Adidas Golf'},{id:'v1',name:'Adidas'}],adidas_inventory:[{sku:'JY6033',size:'L',stock_qty:0,last_synced:'2026-10-01',source:'b2b'}]});
  const r=await _test.search(admin,{vendor:'Adidas',query:'JY6033'});
  expect(admin.rpc).toHaveBeenCalledWith('search_vendor_price_lists',{p_query:'JY6033',p_vendor_id:'v1'});
  expect(r.stock[0]).toMatchObject({source:'adidas',feed:'b2b',stock_qty:0});
  expect(admin.queries.filter(q=>q.table==='ua_inventory')).toHaveLength(0);
  expect(_test.stockSource({name:'Adidas Golf'})).toBeNull();
});
test('no catalog lookup required and stock uses complete exact SKU tokens',async()=>{
  const admin=db({vendors:[{id:'ua',name:'Under Armour'}],ua_inventory:[{sku:'1370399-001',size:'M',stock_qty:12}]},[{vendor_name:'Under Armour',content:'1370399-001 | Tee | $20',document_id:'doc'}]);
  const r=await _test.search(admin,{vendor:'UA',query:'1370399-001'});
  expect(r.stock[0].sku).toBe('1370399-001');
  expect(admin.queries.find(q=>q.table==='ua_inventory').filters).toContainEqual(['in','sku',['1370399-001']]);
  expect(admin.queries.some(q=>q.table==='products')).toBe(false);
});
test('unknown stock is not zero and failed feed does not hide document matches',async()=>{
  const admin=db({adidas_inventory:{error:{message:'offline'}}},[{vendor_name:'Adidas',content:'JY6033 | $10'}]);
  const r=await _test.search(admin,{query:'JY6033'});
  expect(r.matches).toHaveLength(1);expect(r.stock).toEqual([]);expect(r.warnings[0]).toMatch(/unknown/);
});
test('ambiguous vendor cannot silently choose the first result',async()=>{
  const admin=db({vendors:[{id:'x',name:'Acme East'},{id:'y',name:'Acme West'}]});
  await expect(_test.search(admin,{vendor:'Acme',query:'shirt'})).rejects.toThrow(/ambiguous/);
});
test('only the uploader can publish and missing original cannot become searchable',async()=>{
  const admin=db({vendor_price_lists:[{id:'d',created_by:'other',status:'uploading'}]});mockAuth.admin=admin;
  expect((await post({action:'complete',id:'d',chunks:[{location:'page 1',content:'cost $20'}]})).statusCode).toBe(409);
  expect(admin.rpc).not.toHaveBeenCalled();
  const own=db({vendor_price_lists:[{id:'d',created_by:'u',status:'uploading',storage_path:'d/source.pdf',file_size:100}]});
  own.storage={from:()=>({list:async()=>({data:[]})})};mockAuth.admin=own;
  expect((await post({action:'complete',id:'d',chunks:[{location:'page 1',content:'cost $20'}]})).statusCode).toBe(409);
  expect(own.rpc).not.toHaveBeenCalled();
});
test('Excel extraction preserves text SKUs, formatted prices, sheets and physical rows',async()=>{
  const XLSX=require('xlsx');const wb=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([['SKU','Description','USD cost'],['00123','Polo',12.5],[],['1370399-001','UA tee',20]],{origin:'A3'});
  sheet.C4.z='$0.00';XLSX.utils.book_append_sheet(wb,sheet,'Fall prices');
  const bytes=XLSX.write(wb,{type:'array',bookType:'xlsx'});
  const result=await extractPriceList({name:'list.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes});
  expect(result[0].location).toBe('Fall prices · rows 3–6');
  expect(result[0].content).toContain('00123 | Polo | $12.50');
  expect(result[0].content).toContain('Row 6: 1370399-001');
  expect(sheetChunks([['sku','cost'],['001','€12']], 'EU')[0].content).toContain('€12');
});

function pdfFixture(pages) {
  const destroy=jest.fn(async()=>{});
  window.pdfjsLib={OPS:{paintImageXObject:85},GlobalWorkerOptions:{},getDocument:jest.fn(()=>({destroy,promise:Promise.resolve({numPages:pages.length,getPage:async p=>pages[p-1]})}))};
  return {destroy,file:{name:'list.pdf',size:20,arrayBuffer:async()=>new ArrayBuffer(20)}};
}
function page(text='',image=false) {
  return {getTextContent:async()=>({items:text?[{str:text,transform:[0,0,0,0,10,40]}]:[]}),getOperatorList:async()=>({fnArray:image?[85]:[]}),getViewport:({scale})=>({width:600*scale,height:800*scale}),render:()=>({promise:Promise.resolve(),cancel:jest.fn()}),cleanup:jest.fn()};
}
afterEach(()=>{jest.restoreAllMocks();delete window.pdfjsLib;});
test('searchable PDFs keep native text and never start OCR',async()=>{
  mockCreateOcr=jest.fn();
  const {file,destroy}=pdfFixture([page('JY6033 Navy USD cost $20.00')]);
  expect((await extractPriceList(file))[0]).toEqual({location:'PDF page 1',content:'JY6033 Navy USD cost $20.00'});
  expect(mockCreateOcr).not.toHaveBeenCalled();expect(destroy).toHaveBeenCalled();
});
test('mixed PDFs automatically OCR scans and selectable headings over scanned tables',async()=>{
  jest.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({});
  const worker={recognize:jest.fn().mockResolvedValueOnce({data:{text:'1370399-001 USD Cost $12.50',confidence:94}}).mockResolvedValueOnce({data:{text:'JY6033 Cost $20.00',confidence:60}}),terminate:jest.fn(async()=>{})};
  mockCreateOcr=jest.fn(async()=>worker);
  const {file,destroy}=pdfFixture([page('Native price list row $10.00'),page('',true),page('Vendor price list Fall 2026',true)]);
  const progress=jest.fn(),chunks=await extractPriceList(file,progress);
  expect(chunks).toHaveLength(3);expect(chunks[0].location).toBe('PDF page 1');
  expect(chunks[1]).toMatchObject({location:'PDF page 2 · OCR 94% confidence · verify prices and SKUs',content:'1370399-001 USD Cost $12.50'});
  expect(chunks[2].location).toMatch(/page 3.*LOW CONFIDENCE/);
  expect(chunks[2].content).toContain('Vendor price list Fall 2026');expect(chunks[2].content).toContain('JY6033 Cost $20.00');
  expect(mockCreateOcr).toHaveBeenCalledTimes(1);expect(worker.recognize).toHaveBeenCalledTimes(2);
  expect(worker.terminate).toHaveBeenCalledTimes(1);expect(destroy).toHaveBeenCalled();
  expect(progress).toHaveBeenCalledWith('Reading scanned PDF page 2 with OCR…');
});
test('unreadable OCR aborts whole extraction and cleans up worker and PDF',async()=>{
  jest.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({});
  const worker={recognize:jest.fn(async()=>({data:{text:'  ',confidence:0}})),terminate:jest.fn(async()=>{})};
  mockCreateOcr=jest.fn(async()=>worker);
  const {file,destroy}=pdfFixture([page('Native price $20.00'),page('',true)]);
  await expect(extractPriceList(file)).rejects.toThrow(/could not read page 2/);
  expect(worker.terminate).toHaveBeenCalled();expect(destroy).toHaveBeenCalled();
});
test('OCR engine failure aborts cleanly',async()=>{
  jest.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({});
  const worker={recognize:jest.fn(async()=>{throw new Error('OCR network error');}),terminate:jest.fn(async()=>{})};
  mockCreateOcr=jest.fn(async()=>worker);
  const {file,destroy}=pdfFixture([page('',true)]);
  await expect(extractPriceList(file)).rejects.toThrow('OCR network error');
  expect(worker.terminate).toHaveBeenCalled();expect(destroy).toHaveBeenCalled();
});
test('OCR operation deadline rejects rather than leaving upload stuck',async()=>{
  const {withDeadline}=require('../lib/vendorPriceListOcr');
  jest.useFakeTimers();
  try {
    const pending=withDeadline(new Promise(()=>{}),'OCR page 2',25);
    const assertion=expect(pending).rejects.toThrow(/timed out/);
    jest.advanceTimersByTime(26);await assertion;
  } finally {jest.useRealTimers();}
});
