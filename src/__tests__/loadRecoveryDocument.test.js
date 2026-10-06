import {loadRecoveryDocument} from '../lib/loadRecoveryDocument';
function mockClient({tables={},tokens=['same','same'],failed=null}={}) {
  const reads=[];
  return {reads,rpc:jest.fn(async()=>({data:tokens.shift(),error:null})),from:table=>{
    let key,value,multiple,range;
    const request={select:()=>request,order:()=>request,eq:(k,v)=>{key=k;value=v;return request;},in:(k,v)=>{key=k;value=v;multiple=true;return request;},range:(a,b)=>{range=[a,b];return request;},maybeSingle:()=>{range=null;return request;},then:resolve=>{
      reads.push({table,key,value,range});
      if(table===failed)return Promise.resolve({error:{message:'denied'},data:null}).then(resolve);
      const result=(tables[table]||[]).filter(row=>multiple?value.includes(row[key]):row[key]===value);
      return Promise.resolve({error:null,data:range?result.slice(range[0],range[1]+1):(result[0]||null)}).then(resolve);
    }};return request;
  }};
}
const tables={estimates:[{id:'EST-1',_version:4}],estimate_items:[{id:1,estimate_id:'EST-1',item_index:0,line_id:'a',sku:'TEE',sizes:{M:2}}],estimate_item_decorations:[{id:9,estimate_item_id:1,deco_index:0,kind:'art',art_tbd_type:'screen'}]};
test('loads only the requested document and normalizes its child rows',async()=>{
  const client=mockClient({tables});
  const result=await loadRecoveryDocument(client,'estimates','EST-1');
  expect(result).toMatchObject({token:'same',row:{id:'EST-1',_recoveryHydrated:true,items:[{line_id:'a',sku:'TEE',decorations:[{kind:'art',art_file_id:'__tbd'}]}]}});
  expect(result.row.items[0].id).toBeUndefined();
  expect(client.reads.every(read=>read.value==='EST-1'||JSON.stringify(read.value)==='[1]')).toBe(true);
});
test('pages child records and never assumes the first response is complete',async()=>{
  const art=Array.from({length:501},(_,index)=>({id:index,estimate_id:'EST-1',name:'art '+index}));
  const client=mockClient({tables:{...tables,estimate_art_files:art}});
  expect((await loadRecoveryDocument(client,'estimates','EST-1')).row.art_files).toHaveLength(501);
  expect(client.reads.filter(read=>read.table==='estimate_art_files').map(read=>read.range)).toEqual([[0,499],[500,999]]);
});
test.each(['estimates','estimate_items','estimate_item_decorations','estimate_art_files'])('failed %s read cannot produce a comparison',async failed=>{
  await expect(loadRecoveryDocument(mockClient({tables,failed}),'estimates','EST-1')).rejects.toThrow();
});
test('changed parent or child token invalidates the entire comparison',async()=>{
  await expect(loadRecoveryDocument(mockClient({tables,tokens:['old','new']}),'estimates','EST-1')).rejects.toThrow('changed during review');
});
test('sales-order review includes jobs, artwork, POs, picks and firm dates',async()=>{
  const client=mockClient({tables:{sales_orders:[{id:'SO-1'}],so_items:[{id:2,so_id:'SO-1',item_index:0,line_id:'a',sku:'TEE'}],so_jobs:[{id:'j',so_id:'SO-1',prod_status:'completed'}],so_item_pick_lines:[{id:3,so_item_id:2,pick_id:'p',sizes:{M:3}}],so_item_po_lines:[{id:4,so_item_id:2,po_id:'po',sizes:{M:2,_billed:true}}],so_firm_dates:[{id:5,so_id:'SO-1',date:'2026-10-10',approved:true}]}});
  const {row}=await loadRecoveryDocument(client,'sales_orders','SO-1');
  expect(row).toMatchObject({_recoveryHydrated:true,jobs:[{id:'j',prod_status:'completed'}],firm_dates:[{date:'2026-10-10'}],items:[{sizes:{},pick_lines:[{_sku:'TEE',M:3}],po_lines:[{po_id:'po',M:2,billed:true}]}],_hydratedPoIds:['po'],_hydratedPickIds:['p']});
});
