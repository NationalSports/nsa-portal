// Skip re-downloading load groups that haven't changed (migration 20261014220000_data_versions).
//
// The database keeps one change counter per load group (estimates, sales_orders, invoices,
// messages, assigned_todos, app_state), bumped by every write to any table in that group.
// Before a background reload, the app reads the counters (one tiny request) and compares them
// with the counters it read just BEFORE its last successful load of each group. Equal means no
// write has touched the group since that load started, so its rows can't differ from what the
// tab already has. Reading the counters before a load (never after) is what keeps this safe: a
// write that lands mid-load moves the counter past the recorded value, so the next check reloads.
//
// Anything unknown — the RPC failing, the migration not applied yet, a group with no counter,
// a group never loaded in this tab — counts as changed, so the fallback is today's behaviour.

let lastLoaded = {};

export const fetchDataVersions = async (client) => {
  if (!client?.rpc) return null;
  try {
    const { data, error } = await client.rpc('data_versions');
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
};

const known = (versions, group) => versions != null && versions[group] != null && lastLoaded[group] != null;

// True when every listed group is known and unchanged since its last successful load.
export const allUnchanged = (versions, groups) =>
  groups.every((g) => known(versions, g) && String(versions[g]) === String(lastLoaded[g]));

// The listed groups that need loading (changed or unknown).
export const changedGroups = (versions, groups) =>
  groups.filter((g) => !(known(versions, g) && String(versions[g]) === String(lastLoaded[g])));

// Record a successful load of `groups` whose reads started after `versions` was fetched.
export const markLoaded = (versions, groups) => {
  if (!versions) return;
  for (const g of groups) if (versions[g] != null) lastLoaded[g] = versions[g];
};

export const _resetDataVersionsForTest = () => { lastLoaded = {}; };
