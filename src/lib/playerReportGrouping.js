// Packing slips must preserve source orders even when buyers or players match.
// JSON encoding keeps names/numbers containing delimiters from colliding.
export function playerReportGroupKey(line, order = {}) {
  const name = (line.player_name || '').trim().toLowerCase();
  const number = String(line.player_number ?? '').trim();
  return JSON.stringify([
    line.order_id || order.id || order.order_number || order.omg_order_number || line.id || '',
    name, number,
  ]);
}
