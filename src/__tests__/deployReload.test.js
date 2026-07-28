/* Tests for the deploy-reload watcher's health-aware behavior (src/deployReload.js, 2026-07-28).
 *
 * Background: the watcher originally force-reloaded EVERY open tab within ~90s of any deploy,
 * safe or not. During July's deploy cadence (10-20 merges/day) that meant reps' tabs were yanked
 * mid-work several times a day ("the portal keeps booting me"). The force existed for one case —
 * a tab stuck in a failed-save retry loop, which never becomes "safe" and hammers the API with
 * stale requests — so the force is now scoped to exactly that case. Healthy tabs get a banner
 * (onPendingReload) and reload only when the save pipeline is quiet AND the user is idle; past
 * idleDeadlineMs the idle requirement drops but isSafe still holds.
 *
 * The load-bearing cases are the two "never" assertions: an active healthy tab is never yanked
 * by the stuck-tab deadline, and no tab is ever reloaded mid-save no matter how old the pending
 * build is.
 */

// CRA's jest predates advanceTimersByTimeAsync: advance in steps, flushing microtasks between
// them so async interval callbacks (fetch → then → tick) get to schedule their next timer.
const advanceAsync = async (ms, step = 5000) => {
  for (let t = 0; t < ms; t += step) {
    jest.advanceTimersByTime(Math.min(step, ms - t));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }
};

describe('startDeployReloadWatcher — health-aware reload', () => {
  let reloadSpy;
  let buildId;

  const mockLocation = () => {
    reloadSpy = jest.fn();
    delete window.location;
    window.location = { reload: reloadSpy };
  };

  const mockFetch = () => {
    global.fetch = jest.fn(async (url) => ({
      ok: String(url).startsWith('/build-meta.json'),
      text: async () => JSON.stringify({ id: buildId }),
    }));
  };

  const start = async (opts) => {
    const mod = require('../deployReload');
    mod._resetDeployReloadForTests();
    mod.startDeployReloadWatcher(opts);
    // Let the baseline seed (async fingerprint) resolve before the first interval tick.
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers('modern');
    buildId = 1;
    mockLocation();
    mockFetch();
  });
  afterEach(() => { jest.useRealTimers(); delete global.fetch; });

  test('healthy ACTIVE tab: banner fires, stuck-tab deadline does NOT yank it, idle triggers reload', async () => {
    const onPendingReload = jest.fn();
    const onReload = jest.fn();
    let idle = false;
    await start({
      isSafe: () => true,
      hasFailedSaves: () => false,
      isUserIdle: () => idle,
      onPendingReload,
      onReload,
      maxDeferMs: 30000,
    });
    buildId = 2; // deploy lands
    await advanceAsync(180000); // first interval tick detects it
    expect(onPendingReload).toHaveBeenCalledTimes(1);
    // Way past the old force deadline: an active healthy tab must NOT reload.
    await advanceAsync(10 * 60 * 1000);
    expect(reloadSpy).not.toHaveBeenCalled();
    // The rep steps away → reload (plus up to 20s of anti-stampede jitter).
    idle = true;
    await advanceAsync(5000 + 20000);
    expect(onReload).toHaveBeenCalledWith('safe-idle');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  test('stuck tab (failed-save loop, never safe) still force-reloads past maxDeferMs', async () => {
    const onReload = jest.fn();
    await start({
      isSafe: () => false,
      hasFailedSaves: () => true,
      isUserIdle: () => false,
      onReload,
      maxDeferMs: 30000,
    });
    buildId = 2;
    await advanceAsync(180000); // detect
    await advanceAsync(30000 + 5000 + 20000); // deadline + tick + jitter
    expect(onReload).toHaveBeenCalledWith('stuck-forced');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  test('healthy tab past idleDeadlineMs reloads without idle — but NEVER while unsafe', async () => {
    const onReload = jest.fn();
    let safe = false;
    await start({
      isSafe: () => safe,
      hasFailedSaves: () => false,
      isUserIdle: () => false,
      onReload,
      maxDeferMs: 30000,
      idleDeadlineMs: 120000,
    });
    buildId = 2;
    await advanceAsync(180000); // detect
    // Far past every deadline while a save is perpetually in flight: no reload, ever.
    await advanceAsync(60 * 60 * 1000);
    expect(reloadSpy).not.toHaveBeenCalled();
    // Pipeline quiets down → the deadline path takes it even though the user never idled.
    safe = true;
    await advanceAsync(5000 + 20000);
    expect(onReload).toHaveBeenCalledWith('deadline');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  test('banner "Reload now" reloads immediately with reason user (no jitter)', async () => {
    const onReload = jest.fn();
    let reloadNow;
    await start({
      isSafe: () => false,
      hasFailedSaves: () => false,
      isUserIdle: () => false,
      onPendingReload: (fn) => { reloadNow = fn; },
      onReload,
    });
    buildId = 2;
    await advanceAsync(180000); // detect → banner
    expect(typeof reloadNow).toBe('function');
    reloadNow();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    jest.advanceTimersByTime(0);
    expect(onReload).toHaveBeenCalledWith('user');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // A later idle/safe flip must not double-reload.
    await advanceAsync(10 * 60 * 1000);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  test('no deploy → no banner, no reload', async () => {
    const onPendingReload = jest.fn();
    await start({ isSafe: () => true, hasFailedSaves: () => false, isUserIdle: () => true, onPendingReload });
    await advanceAsync(30 * 60 * 1000);
    expect(onPendingReload).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
