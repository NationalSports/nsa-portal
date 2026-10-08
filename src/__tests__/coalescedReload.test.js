import {createCoalescedReload, shouldRefreshOnFocus} from '../lib/coalescedReload';

const tick = async ms => { jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('startup and hidden tabs retain events without issuing requests', async () => {
  let ready = false;
  const load = jest.fn().mockResolvedValue();
  const queue = createCoalescedReload({load, canRun: () => ready});
  queue.enqueue(['sales_orders'], 0);
  await tick(5000);
  expect(load).not.toHaveBeenCalled();
  queue.enqueue(['estimates'], 0);
  ready = true;
  await tick(0);
  expect([...load.mock.calls[0][0]]).toEqual(['sales_orders', 'estimates']);
  queue.stop();
});

test('events during a slow refresh form one follow-up without overlapping loads', async () => {
  let finish;
  const load = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue();
  const queue = createCoalescedReload({load, canRun: () => true});
  queue.enqueue(['sales_orders'], 0);
  await tick(0);
  for (let i = 0; i < 40; i++) queue.enqueue(['sales_orders', 'estimates'], 0);
  await tick(30000);
  expect(load).toHaveBeenCalledTimes(1);
  finish();
  await tick(0);
  await tick(1000);
  expect(load).toHaveBeenCalledTimes(2);
  expect([...load.mock.calls[1][0]]).toEqual(['sales_orders', 'estimates']);
  queue.stop();
});

test('unmount prevents queued work after an in-flight request completes', async () => {
  let finish;
  const load = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  const queue = createCoalescedReload({load, canRun: () => true});
  queue.enqueue(['sales_orders'], 0);
  await tick(0);
  queue.enqueue(['estimates'], 0);
  queue.stop();
  finish();
  await tick(0);
  await tick(20000);
  expect(load).toHaveBeenCalledTimes(1);
});

describe('shouldRefreshOnFocus', () => {
  const base = {now: 100000, lastRefreshAt: 90000, realtimeHealthy: true, lastRealtimeDropAt: 0};
  test('skips a refresh when realtime stayed connected and the tab refreshed within a minute', () => {
    expect(shouldRefreshOnFocus(base)).toBe(false);
  });
  test('refreshes once the last refresh is a minute old', () => {
    expect(shouldRefreshOnFocus({...base, now: 150000})).toBe(true);
  });
  test('refreshes whenever realtime is not fully connected', () => {
    expect(shouldRefreshOnFocus({...base, realtimeHealthy: false})).toBe(true);
  });
  test('refreshes when a realtime channel dropped since the last refresh (events may be lost)', () => {
    expect(shouldRefreshOnFocus({...base, lastRealtimeDropAt: 95000})).toBe(true);
    expect(shouldRefreshOnFocus({...base, lastRealtimeDropAt: 85000})).toBe(false);
  });
  test('refreshes when the tab has never refreshed', () => {
    expect(shouldRefreshOnFocus({...base, lastRefreshAt: 0})).toBe(true);
  });
});
