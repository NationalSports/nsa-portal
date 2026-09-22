import { stampEstimateDraftLineIds } from '../lib/orderLineIdentity';

test('two new identical garments retain their identities through save cloning and later edits', () => {
  const draft = { items: [{ sku: 'JERSEY', color: 'Custom', sizes: {} }, { sku: 'JERSEY', color: 'Custom', sizes: {} }] };
  stampEstimateDraftLineIds(draft, { items: [] });
  const ids = draft.items.map(i => i.line_id);
  expect(ids.every(Boolean)).toBe(true);
  expect(new Set(ids).size).toBe(2);
  const saved = JSON.parse(JSON.stringify(draft));
  const edited = { items: draft.items.map(i => ({ ...i, sizes: { M: 5 } })).reverse() };
  stampEstimateDraftLineIds(edited, saved);
  expect(edited.items.map(i => i.line_id)).toEqual([...ids].reverse());
});

test('does not guess identities for an already ambiguous legacy draft', () => {
  const draft = { items: [{ sku: 'JERSEY' }, { sku: 'JERSEY' }] };
  stampEstimateDraftLineIds(draft, { items: [{ sku: 'JERSEY', line_id: 'a' }, { sku: 'JERSEY', line_id: 'b' }] });
  expect(draft.items.every(i => !i.line_id)).toBe(true);
});

test.each([{ _itemsHydrated: false, items: [] }, { _recoveryHydrated: false, items: [] }, { items: [{ sku: 'JERSEY' }] }])('does not invent identities from an untrusted base', base => {
  const draft = { items: [{ sku: 'JERSEY' }] };
  stampEstimateDraftLineIds(draft, base);
  expect(draft.items[0].line_id).toBeUndefined();
});
