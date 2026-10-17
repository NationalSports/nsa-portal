import { confirmedEditorSave } from '../lib/confirmedEditorSave';
import fs from 'fs';
import path from 'path';

describe('confirmedEditorSave', () => {
  test('confirms an action only after the durable save succeeds', async () => {
    let finish;
    const onSaveNow = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const updated = { id: 'SO-1', status: 'complete' };

    let settled = false;
    const saving = confirmedEditorSave(updated, { onSaveNow }).then(result => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    expect(onSaveNow).toHaveBeenCalledWith(updated);
    expect(settled).toBe(false);

    finish(true);
    await expect(saving).resolves.toBe(true);
  });

  test.each([
    ['a rejected write', () => Promise.reject(new Error('offline'))],
    ['an explicit failed write', () => Promise.resolve(false)],
    ['a fire-and-forget result', () => undefined],
  ])('does not confirm %s', async (_label, save) => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(confirmedEditorSave(
      { id: 'SO-1', status: 'complete' },
      { onSaveNow: save },
    )).resolves.toBe(false);
    consoleError.mockRestore();
  });

  test('forwards retry confirmation callbacks to the durable save', async () => {
    const onConfirmed = jest.fn();
    const onSaveNow = jest.fn().mockResolvedValue(true);
    const updated = { id: 'SO-1' };
    await confirmedEditorSave(updated, { onSaveNow, saveOptions: { onConfirmed } });
    expect(onSaveNow).toHaveBeenCalledWith(updated, { onConfirmed });
  });
});

describe.each(['OrderEditor.js', 'OrderEditorClassic.js'])('%s confirmed action wiring', file => {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

  test('status actions do not use the fire-and-forget save path', () => {
    expect(source).not.toMatch(/status[^\n]{0,500}onSave\(|onSave\([^\n]{0,500}status/);
  });

  test('actions do not report success or clear unsaved state after onSave', () => {
    expect(source).not.toMatch(/onSave\([^\n]*\);[^\n]{0,200}(?:setDirty\(false\)|setSaved\(true\)|nf\()/);
  });

  test('user actions do not update local state and fire onSave directly', () => {
    expect(source).not.toMatch(/setO\([^\n]+\);onSave\(/);
    expect(source.match(/onSave\s*\(/g) || []).toHaveLength(0);
  });

  test('uses the shared strict acknowledgement helper', () => {
    expect(source).toContain("confirmedEditorSave(updated,{onSaveNow,onSave,saveOptions:{onConfirmed:acknowledge}})");
    expect(source).toContain('if(!followUpRan){followUpRan=true;if(onConfirmed)onConfirmed()}');
  });
});
