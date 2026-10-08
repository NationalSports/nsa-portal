import fs from 'fs';
import path from 'path';

// Execute the actual callback while substituting only transport and React setters.
const source = fs.readFileSync(path.join(__dirname, '..', 'Webstores.js'), 'utf8');
const start = source.indexOf('const duplicateStore = useCallback(') + 'const duplicateStore = useCallback('.length;
const end = source.indexOf('\n  }, [stores, flash, loadDetail]);', start) + 4;
const callback = source.slice(start, end);
const src = { id: 'source', name: 'School', slug: 'school' };
const store = { id: 'copy', name: 'School (Copy)', status: 'draft' };
function setup(fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, store }) })) {
  const deps = { duplicatingStoreRef: { current: false }, window: { confirm: jest.fn(() => true) }, stores: [src],
    slugify: s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''), authFetch: fetch,
    setDuplicatingStoreId: jest.fn(), setStores: jest.fn(), flash: jest.fn(), setEditing: jest.fn(),
    setSel: jest.fn(), setTab: jest.fn(), setFocusOrderId: jest.fn(), setDetail: jest.fn(), loadDetail: jest.fn().mockResolvedValue(null) };
  return { deps, run: Function(...Object.keys(deps), 'return (' + callback + ')')(...Object.values(deps)) };
}
test.each([{}, { rebrand: true }])('duplicate creates a copy and opens its settings for options %p', async opts => {
  const { deps, run } = setup();
  expect(await run(src, opts)).toBe(store);
  expect(deps.setStores.mock.calls[0][0]([src])).toEqual([store, src]);
  expect(deps.setEditing).toHaveBeenCalledWith(store); expect(deps.setSel).toHaveBeenCalledWith(store);
  expect(deps.setDetail).toHaveBeenCalledWith(null); expect(deps.loadDetail).toHaveBeenCalledWith(store);
  expect(deps.setDuplicatingStoreId).toHaveBeenLastCalledWith(null);
});
test.each([{ asTemplate: true }, { startFromTemplate: true }])('template workflow keeps its own destination %p', async opts => {
  const { deps, run } = setup(); await run(src, opts);
  expect(deps.setEditing).not.toHaveBeenCalled(); expect(deps.setSel).not.toHaveBeenCalled();
});
test('repeated clicks issue one clone request while pending', async () => {
  let resolve; const pending = new Promise(r => { resolve = r; });
  const { deps, run } = setup(jest.fn(() => pending));
  const first = run(src); expect(await run(src)).toBeNull();
  expect(deps.authFetch).toHaveBeenCalledTimes(1);
  resolve({ ok: true, json: async () => ({ ok: true, store }) }); await first;
  expect(deps.duplicatingStoreRef.current).toBe(false);
});
test('network failure is visible and releases the latch without opening a nonexistent copy', async () => {
  const { deps, run } = setup(jest.fn().mockRejectedValue(new Error('network error')));
  expect(await run(src)).toBeNull(); expect(deps.flash).toHaveBeenLastCalledWith(expect.stringContaining('Refresh the store list before retrying'));
  expect(deps.setEditing).not.toHaveBeenCalled(); expect(deps.setStores).not.toHaveBeenCalled();
  expect(deps.duplicatingStoreRef.current).toBe(false);
});
test('server rejection is visible, clears busy state and creates no local ghost store', async () => {
  const { deps, run } = setup(jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Could not clone' }) }));
  expect(await run(src)).toBeNull(); expect(deps.flash).toHaveBeenLastCalledWith('Could not duplicate: Could not clone');
  expect(deps.setStores).not.toHaveBeenCalled(); expect(deps.setDuplicatingStoreId).toHaveBeenLastCalledWith(null);
});
