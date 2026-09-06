import {withStartupDeadline} from '../lib/startupDeadline';
afterEach(()=>jest.useRealTimers());
test('successful operations return normally and clear the timer',async()=>{
 jest.useFakeTimers();expect(await withStartupDeadline(()=>Promise.resolve('ok'),'Sign in')).toBe('ok');expect(jest.getTimerCount()).toBe(0);
});
test('rejections retain the original error and clear the timer',async()=>{
 jest.useFakeTimers();await expect(withStartupDeadline(()=>Promise.reject(new Error('offline')),'Sign in')).rejects.toThrow('offline');expect(jest.getTimerCount()).toBe(0);
});
test('hung operations time out with the correct phase',async()=>{
 jest.useFakeTimers();const operation=withStartupDeadline(()=>new Promise(()=>{}),'Loading your staff profile',100);
 const assertion=expect(operation).rejects.toThrow('Loading your staff profile took too long');jest.advanceTimersByTime(100);await assertion;
});
test('a late success cannot run the caller success handler after timeout',async()=>{
 jest.useFakeTimers();let resolve;const apply=jest.fn();const request=new Promise(r=>{resolve=r});
 const operation=withStartupDeadline(()=>request,'Restoring your session',100).then(apply);
 const assertion=expect(operation).rejects.toThrow('took too long');jest.advanceTimersByTime(100);await assertion;
 resolve('late user');await Promise.resolve();expect(apply).not.toHaveBeenCalled();
});
