// A save acknowledges exactly the edit submitted, never a newer draft or a
// superseding request. A 'stale', undefined, or merely queued result is not saved.
export function canAcknowledgeSave(result, revision, currentRevision, attempt, currentAttempt) {
  return result === true && revision === currentRevision && attempt === currentAttempt;
}
