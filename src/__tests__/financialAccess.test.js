import { canViewFinancials, FINANCIALS_ALLOWED_USER_IDS } from '../lib/financialAccess';

describe('financials identity allowlist', () => {
  test('allows only Steve, Gayle, and Mike Peterson team identities', () => {
    expect(FINANCIALS_ALLOWED_USER_IDS).toEqual([
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000010',
      '00000000-0000-0000-0000-000000000011',
    ]);
    FINANCIALS_ALLOWED_USER_IDS.forEach(id=>expect(canViewFinancials({id,role:'admin'})).toBe(true));
    expect(canViewFinancials({id:'A1',name:'Andrea Accounting',role:'admin'})).toBe(false);
    expect(canViewFinancials({id:'OTHER',name:'Steve Peterson',role:'super_admin'})).toBe(false);
    expect(canViewFinancials(null)).toBe(false);
  });
});
