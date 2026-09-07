import {isVendorPOEligible, poEligibleVendors} from '../lib/vendorPoEligibility';
import {_vendCols} from '../constants';

const supplier = {id:'v3', name:'SanMar', is_active:true};
const overhead = {id:'qbo-1', name:'ADP', is_active:true, po_eligible:false};
const inactive = {id:'ns_9', name:'Old Vendor', is_active:false};

test('a vendor that predates the flag stays selectable',()=>{
  expect(isVendorPOEligible(supplier)).toBe(true);
  expect(isVendorPOEligible({...supplier, po_eligible:true})).toBe(true);
});
test('an overhead vendor is excluded from PO pickers',()=>{
  expect(isVendorPOEligible(overhead)).toBe(false);
});
test('an inactive vendor is excluded regardless of the flag',()=>{
  expect(isVendorPOEligible(inactive)).toBe(false);
  expect(isVendorPOEligible({...inactive, po_eligible:true})).toBe(false);
});
test('nothing is eligible when there is no vendor',()=>{
  expect(isVendorPOEligible(null)).toBe(false);
  expect(isVendorPOEligible(undefined)).toBe(false);
});
test('the list filter drops overhead and inactive vendors',()=>{
  expect(poEligibleVendors([supplier,overhead,inactive]).map(v=>v.id)).toEqual(['v3']);
  expect(poEligibleVendors()).toEqual([]);
});
test('an item already assigned to an excluded vendor still shows it',()=>{
  // Otherwise switching the flag would blank the vendor on existing items.
  expect(poEligibleVendors([supplier,overhead],'qbo-1').map(v=>v.id)).toEqual(['v3','qbo-1']);
  expect(poEligibleVendors([supplier,inactive],'ns_9').map(v=>v.id)).toEqual(['v3','ns_9']);
});
test('the flag is persisted with the vendor row',()=>{
  // Without this the checkbox would appear to work and silently never save.
  expect(_vendCols).toContain('po_eligible');
});
