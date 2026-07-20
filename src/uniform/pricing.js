// Uniform Builder pricing lives in one pure, testable calculation so the
// public route, coach portal, production proof, order queue, and checkout all
// quote the same amount.

export const DEFAULT_UNIFORM_PRICING = Object.freeze({
  publicBase: 80,
  // These stay at zero until National Sports enters approved surcharges. The
  // calculation accepts overrides now, so fabric pricing can go live without
  // another builder rewrite.
  fabricAdjustments: Object.freeze({
    sublimated: 0,
    matte: 0,
    mesh: 0,
    heather: 0,
    gloss: 0,
  }),
  // Sublimated decoration is included. Heat transfer is intentionally ready
  // for a future embellishment selector, but carries no invented charge today.
  decorationAdjustments: Object.freeze({
    sublimated: 0,
    heat_transfer: 0,
  }),
});

const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const money = (value) => Math.round((finite(value) + Number.EPSILON) * 100) / 100;

export function normalizeUniformDiscount(value) {
  return Math.min(100, Math.max(0, finite(value)));
}

export function customerUniformDiscount(customer) {
  if (!customer || typeof customer !== 'object') return 0;
  return normalizeUniformDiscount(
    customer.uniform_discount_percent
      ?? customer.custom_uniform_discount_percent
      ?? customer.coach_uniform_discount_percent
      ?? 0,
  );
}

export function calculateUniformPrice({
  quantity = 0,
  fabric = 'sublimated',
  decorationMethod = 'sublimated',
  discountPercent = 0,
  policy = {},
} = {}) {
  const fabricAdjustments = { ...DEFAULT_UNIFORM_PRICING.fabricAdjustments, ...(policy.fabricAdjustments || {}) };
  const decorationAdjustments = { ...DEFAULT_UNIFORM_PRICING.decorationAdjustments, ...(policy.decorationAdjustments || {}) };
  const publicBase = money(policy.publicBase ?? DEFAULT_UNIFORM_PRICING.publicBase);
  const fabricAdjustment = money(fabricAdjustments[fabric] ?? 0);
  const decorationAdjustment = money(decorationAdjustments[decorationMethod] ?? 0);
  const publicUnit = money(Math.max(0, publicBase + fabricAdjustment + decorationAdjustment));
  const appliedDiscountPercent = normalizeUniformDiscount(discountPercent);
  const discountPerUnit = money(publicUnit * appliedDiscountPercent / 100);
  const coachUnit = money(Math.max(0, publicUnit - discountPerUnit));
  const qty = Math.max(0, Math.floor(finite(quantity)));

  return {
    publicBase,
    fabric,
    fabricAdjustment,
    decorationMethod,
    decorationAdjustment,
    publicUnit,
    discountPercent: appliedDiscountPercent,
    discountPerUnit,
    coachUnit,
    quantity: qty,
    publicTotal: money(publicUnit * qty),
    savingsTotal: money(discountPerUnit * qty),
    coachTotal: money(coachUnit * qty),
    hasDiscount: appliedDiscountPercent > 0 && discountPerUnit > 0,
  };
}

export function formatUniformMoney(value) {
  return money(value).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', minimumFractionDigits: money(value) % 1 ? 2 : 0, maximumFractionDigits: 2,
  });
}
