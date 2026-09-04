// Allocate a money total by relative weights without losing a cent. Work in
// integer cents, floor each raw share, then give the leftover cents to the
// largest fractional remainders (stable by original component order).
export function allocateMoneyCents(total, weights = []) {
  if (!Array.isArray(weights) || !weights.length) return [];
  const sign = Number(total) < 0 ? -1 : 1;
  const totalCents = Math.round(Math.abs(Number(total) || 0) * 100);
  const clean = weights.map((w) => Math.max(0, Number(w) || 0));
  const weightSum = clean.reduce((sum, w) => sum + w, 0);
  const divisors = weightSum > 0 ? clean : clean.map(() => 1);
  const divisorSum = weightSum > 0 ? weightSum : divisors.length;
  const raw = divisors.map((w) => totalCents * w / divisorSum);
  const cents = raw.map(Math.floor);
  let left = totalCents - cents.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < left; i += 1) cents[order[i % order.length].index] += 1;
  return cents.map((value) => sign * value / 100);
}
