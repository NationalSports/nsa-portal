import fs from 'fs';
import path from 'path';
import { rowsByKey } from '../lib/rowLookup';

test('group lookups preserve strict equality, duplicates, source order, and independent arrays',()=>{
  const rows=[{key:1,n:2},{key:'1',n:3},{key:1,n:1},{key:null},{key:undefined},{key:NaN}];
  const lookup=rowsByKey(rows,'key');
  for(const key of [1,'1',null,undefined,NaN,'missing'])expect(lookup(key)).toEqual(rows.filter(r=>r.key===key));
  lookup(1).reverse();
  expect(lookup(1)).toEqual([rows[0],rows[2]]);
});

const source=fs.readFileSync(path.join(__dirname,'..','lib','dbEngine.js'),'utf8');
const body=source.slice(source.indexOf('    // Index child collections once per load;'),source.indexOf('    // Invoices: attach payments'));
const names=['estRaw','estItems','estDecos','estArt','soRaw','soItems','soDecos','soPicks','soPOs','soJobs','soArt','soFirm'];
function hydrate(data,lookup=rowsByKey){
  return Function(...names,'rowsByKey','_loadArtRow','_decoPosGuard','_lastLoadTimedOut','_unconfirmedLoadTables','_truncatedTables','_everHydratedItems',body+'return {estimates,sales_orders};')(
    ...names.map(n=>data[n]||[]),lookup,r=>r,()=>({}),new Set(),new Set(),new Set(),new Set());
}
// Compare actual reconstruction against filter semantics, not just helper calls:
// duplicate-item recovery, sorting, child attachment, and carry-over guards must agree.
test('complete hydration matches filter lookups for duplicate and reordered children',()=>{
  const data={
    estRaw:[{id:'EST-1'},{id:'EST-empty'}],
    estItems:[{id:1,estimate_id:'EST-1',item_index:0,line_id:'old'},{id:2,estimate_id:'EST-1',item_index:0,line_id:'real'}],
    estDecos:[{id:7,estimate_item_id:2,deco_index:1,kind:'art',art_tbd_type:'screenprint'},{id:8,estimate_item_id:2,deco_index:0,art_file_id:'art'}],
    soRaw:[{id:'SO-1',created_at:'2026-09-10'},{id:'SO-empty'}],
    soItems:[{id:10,so_id:'SO-1',item_index:0,line_id:'old'},{id:11,so_id:'SO-1',item_index:0,line_id:'real',sku:'TEST',sizes:null}],
    soDecos:[{id:1,so_item_id:11,deco_index:1,art_file_id:'live'},{id:2,so_item_id:11,deco_index:0,art_file_id:'first'}],
    soPicks:[{id:1,so_item_id:11,sizes:{M:2},pick_id:'pick'}],
    soPOs:[{id:1,so_item_id:11,sizes:{M:3,_billed:true},po_id:'po'}],
    soJobs:[{id:'old-job',so_id:'SO-1',created_at:'2020-01-01',art_file_id:'old-art'},{id:'new-job',so_id:'SO-1',art_file_id:'live'}],
    soArt:[{id:'old-art',so_id:'SO-1'},{id:'live',so_id:'SO-1'}],
  };
  const actual=hydrate(data);
  expect(actual).toEqual(hydrate(data,(rows,key)=>value=>rows.filter(row=>row[key]===value)));
  expect(actual.estimates[0].items.map(i=>i.line_id)).toEqual(['real']);
  expect(actual.sales_orders[0].items[0]).toMatchObject({line_id:'real',sizes:{},po_lines:[{M:3,billed:true,po_id:'po'}]});
  expect(actual.sales_orders[0].jobs.map(j=>j.id)).toEqual(['new-job']);
  expect(actual.sales_orders[0]._hydratedArtIds).toEqual(['old-art','live']);
  expect(actual.sales_orders[1].items).toEqual([]);
});
