import {renderHook,act} from '@testing-library/react';
import {useRecoveryHandoff} from '../lib/useRecoveryHandoff';
import {draftJournal} from '../lib/draftJournal';
jest.mock('../lib/draftJournal',()=>({draftJournal:{stage:jest.fn()},currentDraftOwner:()=>globalThis.localStorage.getItem('test-owner')}));
const receipt={key:'lane',owner:'gayle',revision:'latest',ts:1};
let target,payload,revision,saving;
const setup=()=>renderHook(()=>useRecoveryHandoff(target,{
  id:'EST-2796',table:'estimates',owner:'gayle',capture:()=>payload,
  revision:()=>revision,isSaving:()=>saving,
}));
beforeEach(()=>{
  localStorage.setItem('test-owner','gayle');
  target={current:null};payload={id:'EST-2796',items:[{sku:'TEE',sizes:{S:1,M:8}}]};revision=2;saving=false;
  draftJournal.stage.mockReset().mockResolvedValue(receipt);
});
test('preserves the latest sizes durably before closing is allowed; pauses autosave',async()=>{
  const {result}=setup();let finish;
  draftJournal.stage.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  let promise;act(()=>{promise=target.current.preserve('gayle');});
  expect(result.current.current).toBe(true);
  expect(draftJournal.stage).toHaveBeenCalledWith('gayle','estimates',payload);
  let preserved;await act(async()=>{finish(receipt);preserved=await promise;});
  expect(preserved.payload.items[0].sizes).toEqual({S:1,M:8});
  expect(preserved.payload._draftRecovery).toEqual({key:'lane',owner:'gayle',revision:'latest'});
  expect(result.current.current).toBe(true);
});
test('storage failure keeps editor open and resumes autosave',async()=>{
  const {result}=setup();draftJournal.stage.mockRejectedValue(new Error('Disk full'));
  await expect(target.current.preserve('gayle')).rejects.toThrow('Disk full');
  expect(result.current.current).toBe(false);
});
test('prepares a copy with normal estimate pricing and status without mutating the editor',async()=>{
  setup();payload.status='draft';
  const preserved=await target.current.preserve('gayle',copy=>{
    copy.status='open';copy.items[0].decorations=[{_cost_locked:3}];return copy;
  });
  expect(preserved.payload.status).toBe('open');
  expect(preserved.payload.items[0].decorations).toEqual([{_cost_locked:3}]);
  expect(payload.status).toBe('draft');expect(payload.items[0].decorations).toBeUndefined();
});
test.each(['edit','account','save','unmount'])('%s during checkpoint prevents closing',async kind=>{
  const {result,unmount}=setup();let finish;
  draftJournal.stage.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const promise=target.current.preserve('gayle');
  if(kind==='edit'){payload={...payload,items:[]};revision++;}
  if(kind==='account')localStorage.setItem('test-owner','steve');
  if(kind==='save')saving=true;
  if(kind==='unmount')unmount();
  finish(receipt);
  await expect(promise).rejects.toThrow('editor changed');
  expect(result.current.current).toBe(false);
});
test('active save and unfinished field prevent staging an older snapshot',async()=>{
  setup();saving=true;
  await expect(target.current.preserve('gayle')).rejects.toThrow('current save');
  saving=false;payload=null;
  await expect(target.current.preserve('gayle')).rejects.toThrow('active field');
  expect(draftJournal.stage).not.toHaveBeenCalled();
});
test('a second click cannot stage or close twice',async()=>{
  setup();let finish;draftJournal.stage.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const first=target.current.preserve('gayle');
  await expect(target.current.preserve('gayle')).rejects.toThrow('already preparing');
  finish(receipt);await first;expect(draftJournal.stage).toHaveBeenCalledTimes(1);
});
