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

// Tab-focus refresh gate. Returning to a portal tab used to reload every operational group
// (all orders with their lines/POs/jobs/art, estimates, invoices, messages + read receipts,
// todos) on EVERY switch back — ~15 times per tab per hour for a rep flipping between tabs
// (edge logs, 2026-10-07). Realtime events that arrive while a tab is hidden stay queued and
// run as soon as it is visible again, so the focus reload only adds something when realtime
// may have missed events (a channel dropped since the last refresh) or the data is getting
// old. Skip it only when realtime stayed connected AND the tab refreshed within minMs.
export function shouldRefreshOnFocus({now, lastRefreshAt, realtimeHealthy, lastRealtimeDropAt, minMs = 60000}) {
  if (!realtimeHealthy) return true;
  if (!(lastRefreshAt > 0) || lastRealtimeDropAt >= lastRefreshAt) return true;
  return now - lastRefreshAt >= minMs;
}
