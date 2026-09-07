import { createBillApplySession, billAttemptJournal, billingAttemptKey } from '../billApplySession';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const write = (save = jest.fn(async () => true)) => ({save, isCurrent: jest.fn(() => true), publish: jest.fn()});
const options = writes => ({prepare: jest.fn(() => writes), record: jest.fn(async () => true), complete: jest.fn()});

test('no mutation and no-evidence retry cannot record or complete', async () => {
  const session = createBillApplySession(); const opts = options([]);
  await expect(session.run('invoice|1', opts)).rejects.toThrow('Nothing was written');
  await expect(session.run('invoice|1', {...opts,retry:true})).rejects.toThrow('No verified pending');
  expect(opts.record).not.toHaveBeenCalled();expect(opts.complete).not.toHaveBeenCalled();
});

test.each([false, undefined, null])('unconfirmed result %s blocks bookkeeping and publication', async result => {
  const session=createBillApplySession(); const w=write(jest.fn(async()=>result));const opts=options([w]);
  await expect(session.run('invoice|1',opts)).rejects.toThrow('not confirmed');
  expect(w.publish).not.toHaveBeenCalled();expect(opts.record).not.toHaveBeenCalled();expect(opts.complete).not.toHaveBeenCalled();
});

test('awaits all multi-order saves and retries only failed writes without recalculation',async()=>{
  const session=createBillApplySession();const gate=deferred();
  const first=write();const second=write(jest.fn().mockReturnValueOnce(gate.promise).mockResolvedValueOnce(true));const opts=options([first,second]);
  const attempt=session.run('invoice|1',opts);
  await Promise.resolve();expect(opts.record).not.toHaveBeenCalled();
  gate.resolve(false);await expect(attempt).rejects.toThrow('not confirmed');
  expect(first.publish).not.toHaveBeenCalled();
  await expect(session.run('invoice|1',{...opts,retry:true})).resolves.toBe(true);
  expect(opts.prepare).toHaveBeenCalledTimes(1);expect(first.save).toHaveBeenCalledTimes(1);expect(second.save).toHaveBeenCalledTimes(2);
  expect(first.publish).toHaveBeenCalledTimes(1);expect(opts.record).toHaveBeenCalledTimes(1);expect(opts.complete).toHaveBeenCalledTimes(1);
});

test('rejected saves remain retryable and concurrent calls cannot share collection',async()=>{
  const session=createBillApplySession();const gate=deferred();const opts=options([write(()=>gate.promise)]);
  const attempt=session.run('invoice|1',opts);
  await expect(session.run('invoice|2',options([write()]))).rejects.toThrow('Another bill');
  gate.resolve(false);await expect(attempt).rejects.toThrow('not confirmed');
  await expect(session.run('invoice|2',options([write()]))).rejects.toThrow('pending bill');
  const rejected=createBillApplySession();await expect(rejected.run('x',options([write(()=>Promise.reject(new Error('offline')))]))).rejects.toThrow('not confirmed');
});

test('ledger-only retry retains original record and does not resave or republish',async()=>{
  const session=createBillApplySession();const w=write();const opts=options([w]);
  opts.record.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await expect(session.run('invoice|1',opts)).rejects.toThrow('ledger did not confirm');
  expect(opts.complete).not.toHaveBeenCalled();
  const changedRecord=jest.fn(async()=>true);
  await session.run('invoice|1',{...opts,record:changedRecord,retry:true});
  expect(changedRecord).not.toHaveBeenCalled();expect(opts.record).toHaveBeenCalledTimes(2);
  expect(w.save).toHaveBeenCalledTimes(1);expect(w.publish).toHaveBeenCalledTimes(1);
});

test('changed targets are not overwritten before retry or during asynchronous save',async()=>{
  const session=createBillApplySession();const w=write();w.isCurrent.mockReturnValue(false);const opts=options([w]);
  await expect(session.run('invoice|1',opts)).rejects.toThrow('changed');expect(w.save).not.toHaveBeenCalled();
  const other=createBillApplySession();const v=write();v.isCurrent.mockReturnValueOnce(true).mockReturnValue(false);
  const otherOpts=options([v]);await expect(other.run('invoice|2',otherOpts)).rejects.toThrow('changed while saving');
  expect(v.publish).not.toHaveBeenCalled();expect(otherOpts.record).not.toHaveBeenCalled();
});

test('credit and invoice attempts do not share an identity',()=>{
  expect(billingAttemptKey({parsed:{doc_number:' A ',is_credit:true}})).toBe('credit|a');
  expect(billingAttemptKey({parsed:{doc_number:' A '}})).toBe('invoice|a');
});

test('reload cannot treat a partially written bill as a fresh apply or successful retry',async()=>{
  const data=new Map();const storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};
  const journal=billAttemptJournal(storage);const session=createBillApplySession(journal);
  const opts=options([write(jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true))]);
  await expect(session.run('invoice|1',opts)).rejects.toThrow('not confirmed');
  const reloaded=createBillApplySession(billAttemptJournal(storage));
  expect(reloaded.isUnfinished('invoice|1')).toBe(true);
  await expect(reloaded.run('invoice|1',options([write()]))).rejects.toThrow('interrupted');
  await session.run('invoice|1',{...opts,retry:true});
  expect(reloaded.isUnfinished('invoice|1')).toBe(false);
});

test('unavailable retry journal prevents writes rather than losing partial-attempt evidence',async()=>{
  const journal={has:()=>false,add:()=>{throw new Error('quota')},remove:jest.fn()};
  const w=write();await expect(createBillApplySession(journal).run('invoice|1',options([w]))).rejects.toThrow('quota');
  expect(w.save).not.toHaveBeenCalled();
});
