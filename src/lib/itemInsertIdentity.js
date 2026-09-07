// Postgres does not promise that INSERT ... RETURNING rows are returned in the
// same order as the input array. Child records must join through item_index.
export function insertedItemIdsByIndex(rows) {
  return new Map((rows || []).map(row => [Number(row.item_index), row.id]));
}
