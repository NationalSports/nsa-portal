import { catalogGroups, catalogEditorRows } from './catalogGroups';
const main = { id: 'main-blue', kind: 'single', variant_group_id: 'main', school_style_group_id: 'hoodie', active: true, sort_order: 1 };
const black = { ...main, id: 'main-black', sort_order: 2 };
const script = { ...main, id: 'script-blue', variant_group_id: 'script', active: false, sort_order: 3 };
const scriptBlack = { ...script, id: 'script-black', sort_order: 4 };
const rows = [main, black, script, scriptBlack];

test('one catalog item includes hidden logo alternatives without publishing them', () => {
  const groups = catalogGroups(rows, true);
  expect(groups).toHaveLength(1);
  expect(groups[0].rep).toBe(main);
  expect(groups[0].designs).toHaveLength(2);
  expect(groups[0].allRows).toHaveLength(4);
  expect(script.active).toBe(false);
});

test('editing an alternative retains only that design colors, even when it is not a visible row', () => {
  const groups = catalogGroups(rows, true);
  expect(catalogEditorRows(groups, script.id)).toEqual([script, scriptBlack]);
  expect(catalogEditorRows(groups, black.id)).toEqual([main, black]);
  expect(catalogEditorRows(groups, 'deleted')).toEqual([]);
});

test('respects the published first logo and its first configured color', () => {
  const activeScript = { ...script, active: true };
  expect(catalogGroups([main, black, activeScript, scriptBlack], true, { hoodie: 'script' })[0].rep).toBe(activeScript);
  expect(catalogGroups(rows, true, { hoodie: 'script' })[0].rep).toBe(main);
});

test('keeps different programs, standalone garments, and bundles separate', () => {
  const extra = [{ ...script, id: 'baseball', variant_group_id: 'baseball', school_program_ids: ['baseball'] }, { id: 'pants', kind: 'single' }, { id: 'pack', kind: 'bundle', school_style_group_id: 'hoodie' }];
  expect(catalogGroups([...rows, ...extra], true)).toHaveLength(4);
});

test('ordinary stores retain one row per color group and hidden-only listings stay accessible', () => {
  expect(catalogGroups(rows)).toHaveLength(2);
  expect(catalogGroups([script, scriptBlack], true)[0].rep).toBe(script);
});
