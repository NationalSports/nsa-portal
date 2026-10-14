const ACTIVE_STORE_REQUEST_STATUSES = new Set(['queued', 'building']);

function hasActiveStoreRequests(requests) {
  return (Array.isArray(requests) ? requests : []).some((request) => (
    request && ACTIVE_STORE_REQUEST_STATUSES.has(request.status)
  ));
}

function resolveStoreRequestPanelOpen(savedState, requests) {
  if (savedState === 'open') return true;
  if (savedState === 'closed') return false;
  return hasActiveStoreRequests(requests);
}

function newlyReadyStoreIds(previousRequests, nextRequests) {
  const previousById = new Map((Array.isArray(previousRequests) ? previousRequests : [])
    .filter(Boolean).map((request) => [request.id, request]));
  return [...new Set((Array.isArray(nextRequests) ? nextRequests : [])
    .filter((request) => (
      request?.status === 'ready'
      && request.store_id
      && previousById.get(request.id)?.status !== 'ready'
    ))
    .map((request) => request.store_id))];
}

function readyStoreIdsNeedingRefresh(previousRequests, nextRequests, knownStoreIds) {
  const known = knownStoreIds instanceof Set ? knownStoreIds : new Set(knownStoreIds || []);
  const transitioned = newlyReadyStoreIds(previousRequests, nextRequests);
  const missing = (Array.isArray(nextRequests) ? nextRequests : [])
    .filter((request) => request?.status === 'ready' && request.store_id && !known.has(request.store_id))
    .map((request) => request.store_id);
  return [...new Set([...transitioned, ...missing])];
}

function nextCustomerPickerIndex(currentIndex, key, resultCount) {
  if (!resultCount) return -1;
  if (key === 'ArrowDown') return Math.min(currentIndex + 1, resultCount - 1);
  if (key === 'ArrowUp') return currentIndex <= 0 ? resultCount - 1 : currentIndex - 1;
  return currentIndex;
}

module.exports = {
  hasActiveStoreRequests,
  resolveStoreRequestPanelOpen,
  newlyReadyStoreIds,
  readyStoreIdsNeedingRefresh,
  nextCustomerPickerIndex,
};
