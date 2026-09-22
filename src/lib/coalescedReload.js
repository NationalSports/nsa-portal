// Keep live updates queued while startup, saves, or an earlier refresh run.
// Each completed refresh consumes only its own groups; later events get another pass.
export function createCoalescedReload({load, canRun, onError = () => {}, retryMs = 1000}) {
  const pending = new Set();
  let timer = null;
  let running = false;
  let stopped = false;
  const schedule = delay => {
    if (stopped || running) return;
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  };
  const run = async () => {
    timer = null;
    if (stopped || running || !pending.size) return;
    if (!canRun()) { schedule(retryMs); return; }
    const groups = new Set(pending);
    pending.clear();
    running = true;
    try { await load(groups); }
    catch (error) { onError(error); }
    finally {
      running = false;
      if (pending.size) schedule(retryMs);
    }
  };
  return {
    enqueue(groups, delay = 10000) {
      if (stopped) return;
      groups.forEach(group => pending.add(group));
      schedule(delay);
    },
    stop() { stopped = true; clearTimeout(timer); pending.clear(); },
  };
}
