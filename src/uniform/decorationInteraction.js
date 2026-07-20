// A decoration must already be selected before a pointer-down can move it.
// Keeping this rule pure makes the accidental-drag safeguard easy to test.
export function shouldStartDecorationDrag(activeKey, hitKey) {
  return !!hitKey && activeKey === hitKey;
}
