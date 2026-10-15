import { substitutionPrice, preserveCustomerPrice } from '../lib/storeSubstitution';

const revenue = item => Object.entries(item.sizes).reduce((sum,[size,qty]) => sum + qty * (item._sizeSells?.[size] ?? item.unit_sell),0);

test.each([{omg_store_id:'OMG'},{webstore_id:'WEB'}])('stock substitution keeps agreed price despite a requested catalog repricing: %j', order => {
  expect(substitutionPrice(order,true,{mode:'product'})).toEqual({mode:'keep'});
  expect(substitutionPrice(order,true)).toEqual({mode:'keep'});
  const source={sku:'OLD',unit_sell:20,_sizeSells:{M:20,'2XL':23},sizes:{M:3,'2XL':2},nsa_cost:8};
  const replacement=preserveCustomerPrice({sku:'NEW',unit_sell:35,_sizeSells:{M:35,'2XL':40},sizes:{...source.sizes},nsa_cost:15,_sizeCosts:{M:15,'2XL':17}},source);
  expect(revenue(replacement)).toBe(revenue(source));
  expect(revenue(replacement)).toBe(106);
  expect(replacement.nsa_cost).toBe(15);
  expect(replacement._sizeCosts).toEqual({M:15,'2XL':17});
  replacement._sizeSells.M=99;
  expect(source._sizeSells.M).toBe(20);
});

test('partial substitution retains total money and does not import replacement size upcharges', () => {
  const original={unit_sell:20,sizes:{M:5}};
  const kept={...original,sizes:{M:2}};
  const replacement=preserveCustomerPrice({unit_sell:30,_sizeSells:{M:35},sizes:{M:3},nsa_cost:18},original);
  expect(replacement._sizeSells).toBeUndefined();
  expect(revenue(kept)+revenue(replacement)).toBe(100);
});

test('zero-price replacements stay free; explicit new-item and non-store choices remain available', () => {
  expect(preserveCustomerPrice({unit_sell:50,nsa_cost:12},{unit_sell:0}).unit_sell).toBe(0);
  expect(substitutionPrice({},true,{mode:'product'})).toEqual({mode:'product'});
  expect(substitutionPrice({omg_store_id:'OMG'},false,{mode:'product'})).toEqual({mode:'product'});
});
