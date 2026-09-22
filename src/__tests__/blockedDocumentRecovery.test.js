jest.mock('@supabase/supabase-js',()=>({createClient:()=>null}));
import {
  _saveDocument, _preserveBlockedDocument, _outboxList, _dbSaveFailedIds,
  _isDocumentConflictCooling, _clearDocumentConflictCooldown, _setOnOutboxConflict,
  _retryFailedSaves,
} from '../lib/dbEngine';

beforeEach(()=>{localStorage.clear();_dbSaveFailedIds.clear();});
afterEach(()=>{localStorage.clear();_dbSaveFailedIds.clear();_setOnOutboxConflict(null);});

test.each([['estimates','EST-guard'],['sales_orders','SO-guard']])(
  'a rejected %s draft survives and does not enter automatic retry',async(table,id)=>{
    const notify=jest.fn();_setOnOutboxConflict(notify);
    const draft={id,customer_id:'C-1',memo:'keep my edit',_version:4,items:[{sku:'TEE',sizes:{M:2}}]};
    const save=jest.fn(payload=>{
      _dbSaveFailedIds.add(id);
      return _preserveBlockedDocument(table,payload);
    });
    expect(await _saveDocument(table,draft,save)).toBe(false);
    expect(_isDocumentConflictCooling(id)).toBe(true);
    expect(_dbSaveFailedIds.has(id)).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(_outboxList().find(e=>e.id===id).payload).toMatchObject(draft);
    draft.memo='newer edit';
    await _retryFailedSaves();
    expect(save).toHaveBeenCalledTimes(1);
    expect(_outboxList().find(e=>e.id===id).payload.memo).toBe('keep my edit');
    _clearDocumentConflictCooldown(id);
    expect(_isDocumentConflictCooling(id)).toBe(false);
    expect(_outboxList().some(e=>e.id===id)).toBe(true);
  }
);
