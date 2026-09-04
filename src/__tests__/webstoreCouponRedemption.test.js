/** @jest-environment node */

const { bumpCouponUse } = require('../../netlify/functions/_webstoreEmail');

describe('coupon redemption handoff', () => {
  test('uses the order-keyed idempotent RPC when available', async () => {
    const calls = [];
    const sb = {
      rpc: jest.fn(async (fn, args) => {
        calls.push([fn, args]);
        return { data: true, error: null };
      }),
      from: jest.fn(() => { throw new Error('legacy counter should not run'); }),
    };

    await expect(bumpCouponUse(sb, 'store-1', 'SAVE', '11111111-1111-4111-8111-111111111111')).resolves.toBe(true);
    expect(calls).toEqual([['redeem_webstore_coupon_for_order', { p_order_id: '11111111-1111-4111-8111-111111111111' }]]);
  });

  test('falls back to the compare-and-swap counter only when the RPC is missing', async () => {
    const rows = [
      { data: [{ id: 'coupon-1', used_count: 2 }] },
      { data: [{ id: 'coupon-1' }] },
    ];
    const sb = {
      rpc: jest.fn(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function redeem_webstore_coupon_for_order in the schema cache' } })),
      from: jest.fn(() => {
        const chain = {
          select: () => chain, update: () => chain, eq: () => chain,
          ilike: () => chain, limit: () => chain,
          then: (resolve, reject) => Promise.resolve(rows.shift()).then(resolve, reject),
        };
        return chain;
      }),
    };

    await expect(bumpCouponUse(sb, 'store-1', 'SAVE', '11111111-1111-4111-8111-111111111111')).resolves.toBe(true);
    expect(sb.from).toHaveBeenCalledTimes(2);
  });
});
