// Match Array.find(row => row.id === id), including first-duplicate wins.
// Build inside each refresh/setter; do not cache across changing local state.
export function indexFirstById(rows = []) {
  const index = new Map();
  for (const row of rows) {
    const id = row.id;
    // Map considers NaN equal to NaN; strict equality in the old lookup did not.
    if (id === id && !index.has(id)) index.set(id, row);
  }
  return index;
}
