/* eslint-disable */
// Decorations persist via DELETE+INSERT (dbEngine _dbSaveSOInner / the save_estimate RPC), so any
// live-DB column missing from _decoCols is silently ERASED on every save. _cost_locked (the price
// lock lockPrices writes to freeze deco costs against vendor matrix changes) and names_list were
// wiped exactly this way for months behind a stale "schema cache" comment. This test pins them in.
import { _decoCols, _decoExtraCols } from '../constants';

describe('_decoCols persistence', () => {
  test('includes the live-DB columns that a DELETE+INSERT save must round-trip', () => {
    expect(_decoCols).toContain('_cost_locked');
    expect(_decoCols).toContain('names_list');
  });

  test('does not send print_color_b (column does not exist in the live DB)', () => {
    expect(_decoCols).not.toContain('print_color_b');
  });

  test('strip-on-retry set only names columns _decoCols actually sends', () => {
    [..._decoExtraCols].forEach(c => expect(_decoCols).toContain(c));
  });

  test('live-DB columns are not strippable on retry (a strip would wipe them silently)', () => {
    expect(_decoExtraCols.has('_cost_locked')).toBe(false);
    expect(_decoExtraCols.has('names_list')).toBe(false);
  });
});
