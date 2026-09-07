import {IDBFactory} from 'fake-indexeddb';
import {createDraftJournal,protectDocumentDraft} from '../lib/draftJournal';

// CRA's jsdom predates structuredClone. The test data is JSON document data.
beforeAll(()=>{if(!global.structuredClone)global.structuredClone=value=>JSON.parse(JSON.stringify(value));});
let factory,a,b;
beforeEach(()=>{
  factory=new IDBFactory();a=createDraftJournal({factory,session:'tab-a'});b=createDraftJournal({factory,session:'tab-b'});
  localStorage.setItem('nsa_user',JSON.stringify({id:'staff-a'}));
});
afterEach(async()=>{await a.close();await b.close();localStorage.removeItem('nsa_user');});
const payload=memo=>({id:'SO-1',memo,items:[{sku:'A',sizes:{M:2}}],_version:3});

test('independent tabs preserve separate drafts of the same document',async()=>{
 const [x,y]=await Promise.all([a.stage('staff-a','sales_orders',payload('first')),b.stage('staff-a','sales_orders',payload('second'))]);
 expect(await a.list('staff-a')).toHaveLength(2);
 await a.acknowledge(x);
 expect((await b.list('staff-a')).map(d=>d.revision)).toEqual([y.revision]);
});
test('late acknowledgements and failures cannot replace a newer revision in the same tab',async()=>{
 const x=await a.stage('staff-a','sales_orders',payload('old'));
 const y=await a.stage('staff-a','sales_orders',payload('new'));
 expect(await b.acknowledge(x)).toBe(false);
 expect(await b.update(x,payload('late failure'))).toBe(false);
 expect((await a.list('staff-a'))[0]).toMatchObject({revision:y.revision,payload:{memo:'new'}});
});
test('recoverable drafts survive closing and reopening; users see only their own drafts',async()=>{
 await a.stage('staff-a','sales_orders',payload('saved locally'));
 await b.stage('staff-b','sales_orders',payload('other user'));
 await a.close();
 expect((await a.list('staff-a')).map(d=>d.payload.memo)).toEqual(['saved locally']);
 expect(await a.list('staff-c')).toEqual([]);
});
test('stage clones its input before any asynchronous work',async()=>{
 const source=payload('original');const pending=a.stage('staff-a','sales_orders',source);source.items[0].sizes.M=99;
 await pending;expect((await a.list('staff-a'))[0].payload.items[0].sizes.M).toBe(2);
});
test('cloud dispatch waits for local commit, and failure stays recoverable',async()=>{
 const run=jest.fn(async()=>{expect(await a.list('staff-a')).toHaveLength(1);return false;});
 expect(await protectDocumentDraft('sales_orders',payload('draft'),run,jest.fn(),a)).toBe(false);
 expect(await a.list('staff-a')).toHaveLength(1);
});
test('only confirmed success acknowledges a draft; stale/undefined do not',async()=>{
 for(const result of ['stale',undefined,false]){
   await protectDocumentDraft('sales_orders',payload('draft'),async()=>result,jest.fn(),a);
   expect(await a.list('staff-a')).toHaveLength(1);
 }
 await protectDocumentDraft('sales_orders',payload('draft'),async()=>true,jest.fn(),a);
 expect(await a.list('staff-a')).toHaveLength(0);
});
test('a denied database preserves old drafts and warns while allowing an online save',async()=>{
 const old=await a.stage('staff-a','sales_orders',payload('old'));
 const denied=createDraftJournal({factory:{open(){throw new Error('Quota exceeded');}},session:'denied'});
 const warning=jest.fn();
 expect(await protectDocumentDraft('sales_orders',payload('new'),async()=>false,warning,denied)).toBe(false);
 expect(warning).toHaveBeenCalled();
 expect((await denied.list('staff-a'))[0]).toMatchObject({durable:false,payload:{memo:'new'}});
 expect((await a.list('staff-a'))[0].revision).toBe(old.revision);
});
test('recovering an older tab draft clears only that selected revision after success',async()=>{
 const x=await b.stage('staff-a','sales_orders',payload('recover me'));
 const source={...x.payload,_draftRecovery:{key:x.key,owner:x.owner,revision:x.revision}};
 await protectDocumentDraft('sales_orders',source,async()=>true,jest.fn(),a);
 expect(await a.list('staff-a')).toHaveLength(0);
});
