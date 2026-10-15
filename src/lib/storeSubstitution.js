import { isStoreSalesOrder } from './storeCloseout';

// Stock replacements never adopt a catalog sell price. Additional copied items
// and non-store orders retain their existing explicit pricing choices.
export function substitutionPrice(order, replacing, requested) {
  return replacing && isStoreSalesOrder(order) ? {mode:'keep'} : requested;
}

// Mutates the newly built replacement, leaving its new product costs intact.
export function preserveCustomerPrice(replacement, source) {
  replacement.unit_sell = Number(source.unit_sell) || 0;
  if (source._sizeSells) replacement._sizeSells = {...source._sizeSells};
  else delete replacement._sizeSells;
  return replacement;
}
