import {prepareRecoveryDraft,recoveryDifferences} from '../lib/recoveryReview';
import {savedDocumentMatchesDraft} from '../lib/savedDraftComparison';
import {_estDiffCmp} from '../lib/dbEngine';

const line=(id,qty)=>({line_id:id,sku:'TEE',color:'Red',sizes:{M:qty},unit_sell:10});
const cloud={id:'EST-review',_version:8,memo:'new memo',items:[line('a',2),line('b',5)]};
const draft={...cloud,_version:2,memo:'old memo',items:[line(undefined,3),line(undefined,6)]};
test('duplicate legacy lines require explicit one-to-one matching; ordering is not identity',()=>{
  expect(prepareRecoveryDraft(draft,cloud,'t').valid).toBe(false);
  expect(prepareRecoveryDraft(draft,cloud,'t',{0:'a',1:'a'}).valid).toBe(false);
  const result=prepareRecoveryDraft(draft,cloud,'t',{0:'b',1:'a'});
  expect(result.valid).toBe(true);
  expect(result.payload.items.map(item=>item.line_id)).toEqual(['b','a']);
  expect(result.payload.items.map(item=>item.sizes.M)).toEqual([3,6]);
  expect(result.payload).toMatchObject({_version:8,_obBaseVersion:8,_reviewedSaveToken:'t'});
});
test('review exposes changed memo, quantities and missing lines',()=>{
  const result=recoveryDifferences({...draft,items:[line('a',3)]},cloud);
  expect(result).toEqual(expect.arrayContaining([
    expect.objectContaining({field:'memo',cloud:'new memo',draft:'old memo'}),
    expect.objectContaining({field:'items › 1 › sizes › M',cloud:2,draft:3}),
    expect.objectContaining({field:'items › 2',cloud:cloud.items[1],draft:undefined}),
  ]));
});
test.each(['_sizeCosts','_sizeSells','_colorImage','_colorBackImage','_ss_live'])('saved content clears despite known display field %s',field=>{
  const saved={...cloud,items:[line('a',2)]};
  const backup={...saved,items:[{...saved.items[0],[field]:{M:123}}]};
  expect(_estDiffCmp(backup)).toBe(_estDiffCmp(saved));
  expect(savedDocumentMatchesDraft(backup,saved)).toBe(true);
  expect(recoveryDifferences(backup,saved)).toEqual([]);
});
test('unknown item fields and real nested prices remain significant',()=>{
  const backup={...cloud,items:[{...cloud.items[0],_shipping_cost:12},cloud.items[1]]};
  expect(savedDocumentMatchesDraft(backup,cloud)).toBe(false);
  expect(savedDocumentMatchesDraft({...cloud,items:[{...cloud.items[0],unit_sell:99},cloud.items[1]]},cloud)).toBe(false);
});
