// Regression: the OMG report proxy used a 7s per-attempt timeout while the upstream
// report API normally answers in 6.0-6.8s (measured on a small 41 KB report; real store
// reports are bigger). Every attempt aborted, all three retries were identically too
// short, and staff got "Report fetch failed: 504" on a perfectly healthy report.

const { fetchOmgReport } = require('../../netlify/functions/omg-report-proxy');

const URL = 'https://report.ordermygear.com/reports/48ff450f-30dc-46c0-5101-698fe5464e53';

// Fake clock: `now` advances only when a fetch "takes" time or we sleep, so the
// budget arithmetic is exercised without any real waiting.
const makeClock = () => {
  const c = { t: 0 };
  c.now = () => c.t;
  c.sleep = async (ms) => { c.t += ms; };
  return c;
};

// A fetch that takes `ms` of fake time, honouring the abort signal the same way a
// real one would: if the timeout fires first, reject with an AbortError.
const slowFetch = (clock, ms, result) => jest.fn(async (_url, opts) => {
  const budget = clock.abortAfter;
  clock.t += Math.min(ms, budget);
  if (ms > budget) {
    const e = new Error('The operation was aborted');
    e.name = 'AbortError';
    throw e;
  }
  return result;
});

// Capture the per-attempt timeout the helper chooses, since that is the thing that
// was wrong. setTimeout is what carries it to the AbortController.
const withTimeoutCapture = (fn) => {
  const real = global.setTimeout;
  const seen = [];
  global.setTimeout = (cb, ms) => { seen.push(ms); return real(() => {}, 0); };
  return fn(seen).finally(() => { global.setTimeout = real; });
};

describe('fetchOmgReport timeout budget', () => {
  test('a 6.8s response — normal for this API — succeeds instead of aborting', async () => {
    const clock = makeClock();
    await withTimeoutCapture(async (seen) => {
      clock.abortAfter = 12000; // what the helper should now allow on attempt 1
      const ok = { ok: true, status: 200 };
      const res = await fetchOmgReport(URL, {
        fetchImpl: slowFetch(clock, 6800, ok), sleep: clock.sleep, now: clock.now,
      });
      expect(res.response).toBe(ok);
      expect(res.attempts).toBe(1);
      // The old 7000 would have aborted a report only slightly larger than this one.
      expect(seen[0]).toBeGreaterThan(7000);
    });
  });

  test('first attempt gets the full per-attempt timeout, not a shortened slice', async () => {
    const clock = makeClock();
    await withTimeoutCapture(async (seen) => {
      clock.abortAfter = 12000;
      await fetchOmgReport(URL, {
        fetchImpl: slowFetch(clock, 100, { ok: true, status: 200 }), sleep: clock.sleep, now: clock.now,
      });
      expect(seen[0]).toBe(12000);
    });
  });

  test('retries on a transient 5xx and returns the eventual success', async () => {
    const clock = makeClock();
    const ok = { ok: true, status: 200 };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(ok);
    const res = await fetchOmgReport(URL, { fetchImpl, sleep: clock.sleep, now: clock.now });
    expect(res.response).toBe(ok);
    expect(res.attempts).toBe(2);
  });

  test('retries stay inside the total budget so the function is never killed mid-flight', async () => {
    const clock = makeClock();
    await withTimeoutCapture(async (seen) => {
      // Every attempt burns its whole timeout and comes back 504.
      const fetchImpl = jest.fn(async () => { clock.t += clock.abortAfter; return { ok: false, status: 504 }; });
      clock.abortAfter = 12000;
      await fetchOmgReport(URL, { fetchImpl, sleep: clock.sleep, now: clock.now });
      // 12000 + 250 delay leaves 10750 of the 23000 budget; the helper must not hand
      // an attempt more time than remains, or the 26s function cap kills it.
      expect(seen.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(23000);
      expect(clock.t).toBeLessThan(26000);
    });
  });

  test('out of budget returns the last real response rather than starting a doomed attempt', async () => {
    const clock = makeClock();
    const last = { ok: false, status: 502 };
    // One attempt eats almost the entire budget, so no second attempt can fit.
    const fetchImpl = jest.fn(async () => { clock.t += 22000; return last; });
    const res = await fetchOmgReport(URL, { fetchImpl, sleep: clock.sleep, now: clock.now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.response).toBe(last);
  });
});
