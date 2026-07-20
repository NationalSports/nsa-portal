// Server-owned custom-uniform pricing. Browser totals are previews only; every
// order is repriced here immediately before it is written or paid.

const DEFAULT_POLICY = Object.freeze({
  publicBase: 80,
  fabricAdjustments: Object.freeze({ sublimated: 0, matte: 0, mesh: 0, heather: 0, gloss: 0 }),
  decorationAdjustments: Object.freeze({ sublimated: 0, heat_transfer: 0 }),
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const money = (value) => Math.round((finite(value) + Number.EPSILON) * 100) / 100;
const discount = (value) => Math.min(100, Math.max(0, finite(value)));

async function loadPolicy(sb) {
  try {
    const { data, error } = await sb.from('uniform_settings').select('value').eq('key', 'pricing_policy').maybeSingle();
    if (error) throw error;
    return data && data.value && typeof data.value === 'object' ? data.value : DEFAULT_POLICY;
  } catch (error) {
    console.error('[uniform-pricing] policy fallback:', error.message);
    return DEFAULT_POLICY;
  }
}

async function customerForEmail(sb, email) {
  if (!email) return null;
  try {
    const query = sb.from('coach_accounts').select('customer_id');
    // Lightweight unit-test clients may not implement case-insensitive match;
    // production Supabase always does. In that case the safe fallback is the
    // public price, never an unverified discount.
    if (!query || typeof query.ilike !== 'function') return null;
    const { data: coach, error: coachError } = await query
      .ilike('email', String(email).trim()).eq('status', 'active').maybeSingle();
    if (coachError) throw coachError;
    if (!coach || !coach.customer_id) return null;
    const { data: customer, error: customerError } = await sb.from('customers')
      .select('id,name,uniform_discount_percent').eq('id', coach.customer_id).maybeSingle();
    if (customerError) throw customerError;
    return customer || null;
  } catch (error) {
    console.error('[uniform-pricing] customer lookup:', error.message);
    return null;
  }
}

function calculate({ quantity, fabric, decorationMethod, discountPercent, policy = DEFAULT_POLICY }) {
  const fabricAdjustments = { ...DEFAULT_POLICY.fabricAdjustments, ...(policy.fabricAdjustments || {}) };
  const decorationAdjustments = { ...DEFAULT_POLICY.decorationAdjustments, ...(policy.decorationAdjustments || {}) };
  const publicBase = money(policy.publicBase ?? DEFAULT_POLICY.publicBase);
  const fabricAdjustment = money(fabricAdjustments[fabric] ?? 0);
  const decorationAdjustment = money(decorationAdjustments[decorationMethod] ?? 0);
  const publicUnit = money(Math.max(0, publicBase + fabricAdjustment + decorationAdjustment));
  const appliedDiscount = discount(discountPercent);
  const discountPerUnit = money(publicUnit * appliedDiscount / 100);
  const coachUnit = money(Math.max(0, publicUnit - discountPerUnit));
  const qty = Math.max(0, Math.floor(finite(quantity)));
  return {
    publicBase, fabric, fabricAdjustment, decorationMethod, decorationAdjustment,
    publicUnit, discountPercent: appliedDiscount, discountPerUnit, coachUnit,
    quantity: qty, publicTotal: money(publicUnit * qty),
    savingsTotal: money(discountPerUnit * qty), coachTotal: money(coachUnit * qty),
    hasDiscount: appliedDiscount > 0 && discountPerUnit > 0,
  };
}

async function authoritativeUniformQuote(sb, body) {
  const customer = await customerForEmail(sb, body.contact_email);
  const policy = await loadPolicy(sb);
  const config = body.config && typeof body.config === 'object' ? body.config : {};
  const quote = calculate({
    quantity: body.total_qty,
    fabric: String(config.fabric || 'sublimated'),
    decorationMethod: String(config.decorationMethod || 'sublimated'),
    discountPercent: customer ? customer.uniform_discount_percent : 0,
    policy,
  });
  return { customer, policy, quote };
}

module.exports = { DEFAULT_POLICY, calculate, authoritativeUniformQuote, customerForEmail, loadPolicy };
