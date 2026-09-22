import {savedDocumentMatchesDraft, reconcileSavedDocumentDrafts} from '../lib/savedDraftComparison';
import {_outboxGate} from '../lib/dbEngine';
import {createDraftJournal} from '../lib/draftJournal';
import {indexedDB} from 'fake-indexeddb';

global.structuredClone = value => JSON.parse(JSON.stringify(value));

const draft = () => ({id:'SO-test', memo:'Team order', _version:35,
  items:[{sku:'TEE', sizes:{M:2,L:3}, decorations:[{_cost_locked:4}]}],
  jobs:[{id:'JOB-a',_version:18,prod_status:'completed'}, {id:'JOB-b',_version:2}],
  art_files:[{id:'ART-a',_version:18,status:'approved'}], _shipping_cost:12});
const cloud = () => ({...draft(),_version:37,updated_at:'later',
  items:[{decorations:[{_cost_locked:4}],sizes:{L:3,M:2},sku:'TEE'}],
  jobs:[{_version:3,id:'JOB-b'}, {prod_status:'completed',_version:20,id:'JOB-a'}],
  art_files:[{status:'approved',_version:21,id:'ART-a'}],
  _recoveryHydrated:true,_itemsHydrated:true,_decosHydrated:true,_artHydrated:true,
  _jobsHydrated:true,_posHydrated:true,_picksHydrated:true});

test('already saved content drops from outbox despite child versions, field order and entity order', () => {
  expect(_outboxGate({table:'sales_orders',baseVersion:35,payload:draft()},cloud())).toBe('drop');
});

test.each([
  row=>{row.items[0].sizes.M=9;},
  row=>{row.items[0].decorations[0]._cost_locked=8;},
  row=>{row._shipping_cost=99;},
  row=>{row._shipments=[{tracking:'new'}];},
  row=>{row.jobs[1].prod_status='in_process';},
  row=>{row.art_files[0].status='waiting_approval';},
  row=>{row.items.push({sku:'NEW'});},
  row=>{row.items=[];},
  row=>{row.jobs.push({...row.jobs[0]});},
  row=>{row._itemsHydrated=false;},
])('real or ambiguous differences remain conflicts (%#)', change => {
  const payload=draft(),row=cloud();
  // Persisted root fields are checked when the draft carries them.
  payload._shipments=[];
  row._shipments=[];
  change(row);
  expect(_outboxGate({table:'sales_orders',baseVersion:35,payload},row)).toBe('conflict');
});

test('new child properties and reordering item lines remain meaningful', () => {
  const row=cloud();row.items[0].notes='new';
  expect(savedDocumentMatchesDraft(draft(),row)).toBe(false);
  const payload=draft();payload.items.push({sku:'OTHER'});
  row.items=[...payload.items].reverse();
  expect(savedDocumentMatchesDraft(payload,row)).toBe(false);
});

test('incomplete, absent, other-owner and other-table copies are never acknowledged', async () => {
  const journal={acknowledge:jest.fn()};
  const base={key:'a',owner:'staff',revision:'r',table:'sales_orders',id:'SO-test',payload:draft()};
  const run=(drafts,orders,owner='staff')=>reconcileSavedDocumentDrafts({table:'sales_orders',owner:'staff',drafts,documents:orders,journal,currentOwner:()=>owner});
  await run([base],[{...cloud(),_jobsHydrated:false}]);
  await run([base],[{...cloud(),_jobsHydrated:undefined}]);
  await run([base],[]);
  await run([{...base,owner:'other'}],[cloud()]);
  await run([{...base,table:'estimates'}],[cloud()]);
  await run([base],[cloud()],'other');
  expect(journal.acknowledge).not.toHaveBeenCalled();
});

test('clears matching old-session receipts while retaining a newer revision and a real edit', async () => {
  const name='saved-comparison-'+Math.random();
  const a=createDraftJournal({factory:indexedDB,name,session:'old'});
  const b=createDraftJournal({factory:indexedDB,name,session:'new'});
  try {
    await a.stage('staff','sales_orders',draft());
    await b.stage('staff','sales_orders',draft());
    const candidates=await a.list('staff');
    const newer=await b.stage('staff','sales_orders',{...draft(),memo:'Still unsaved'});
    await reconcileSavedDocumentDrafts({table:'sales_orders',owner:'staff',drafts:candidates,documents:[cloud()],journal:a,currentOwner:()=> 'staff'});
    expect((await a.list('staff')).map(row=>row.revision)).toEqual([newer.revision]);
    await reconcileSavedDocumentDrafts({table:'sales_orders',owner:'staff',drafts:await a.list('staff'),documents:[cloud()],journal:a,currentOwner:()=> 'staff'});
    expect((await a.list('staff'))[0].payload.memo).toBe('Still unsaved');
  } finally {await a.close();await b.close();}
});

test('storage failures are reported to the caller without saving any cloud data', async () => {
  const journal={acknowledge:jest.fn().mockRejectedValue(new Error('storage failed'))};
  await expect(reconcileSavedDocumentDrafts({table:'sales_orders',owner:'staff',drafts:[{key:'a',owner:'staff',revision:'r',table:'sales_orders',id:'SO-test',payload:draft()}],documents:[cloud()],journal,currentOwner:()=> 'staff'})).rejects.toThrow('storage failed');
});

const estimate = () => ({id:'EST-test',memo:'',_version:3,
  items:[{sku:'TEE',sizes:{L:75,XL:100},unit_sell:8.5}],
  art_files:[{id:'ART-e',_version:1,status:'approved'}]});
const savedEstimate = () => ({...estimate(),_version:5,
  art_files:[{status:'approved',_version:3,id:'ART-e'}],
  _recoveryHydrated:true,_itemsHydrated:true,_decosHydrated:true,_artHydrated:true});

test('estimate recovery clears only matching copies, without requiring sales-order child tables', async () => {
  const journal={acknowledge:jest.fn().mockResolvedValue(true)};
  const base={key:'estimate-copy',revision:'v1',owner:'staff',table:'estimates',id:'EST-test',payload:estimate()};
  await reconcileSavedDocumentDrafts({owner:'staff',currentOwner:()=> 'staff',table:'estimates',
    documents:[savedEstimate()],journal,drafts:[base,
      {...base,key:'changed',payload:{...estimate(),items:[{sku:'TEE',sizes:{L:76,XL:100},unit_sell:8.5}]}},
      {...base,key:'other-table',table:'sales_orders'},
      {...base,key:'other-account',owner:'someone-else'}]});
  expect(journal.acknowledge.mock.calls).toEqual([[{key:base.key,owner:base.owner,revision:base.revision}]]);
  expect(_outboxGate({table:'estimates',payload:estimate(),baseVersion:3},savedEstimate())).toBe('drop');
});

test.each(['_recoveryHydrated','_itemsHydrated','_decosHydrated','_artHydrated'])('incomplete estimate load (%s) keeps backup and conflict', async flag => {
  const journal={acknowledge:jest.fn()};
  const row={...savedEstimate(),[flag]:false};
  await reconcileSavedDocumentDrafts({owner:'staff',currentOwner:()=> 'staff',table:'estimates',
    documents:[row],journal,drafts:[{key:'e',revision:'r',owner:'staff',table:'estimates',id:'EST-test',payload:estimate()}]});
  expect(journal.acknowledge).not.toHaveBeenCalled();
  expect(_outboxGate({table:'estimates',payload:estimate(),baseVersion:3},row)).toBe('conflict');
});
