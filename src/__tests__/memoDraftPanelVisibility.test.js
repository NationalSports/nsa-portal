import fs from 'fs';
import path from 'path';

// A memo being typed is backed up on every keystroke. The recovery panel must not list that copy
// while its own editor is open (it read as an error), but must list it once the editor is closed.
const source = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const m = source.match(/<DraftRecoveryPanel owner=\{cu\?\.id\} isVisible=\{(d=>[^\n]*?)\} onReview=/);
test('the memo being edited is hidden from the recovery panel; everything else is unchanged', () => {
  expect(m).not.toBeNull();
  const make = (memoCommand) => Function('isMySaveNotice', 'MEMO_DRAFT_TABLE', 'memoCommand', 'cu', 'return (' + m[1] + ')')(
    d => d.id !== 'not-mine', 'sales_order_memos', memoCommand, {id: 'rep-1'});
  const openMemo = {table: 'sales_order_memos', id: 'SO-1'};
  const otherMemo = {table: 'sales_order_memos', id: 'SO-2'};
  const orderDraft = {table: 'sales_orders', id: 'SO-1'};
  const editing = make({id: 'SO-1', ownerId: 'rep-1'});
  expect(editing(openMemo)).toBe(false);   // being typed right now
  expect(editing(otherMemo)).toBe(true);   // a different order's memo
  expect(editing(orderDraft)).toBe(true);  // the order itself, not the memo
  expect(make(null)(openMemo)).toBe(true); // editor closed: listed for recovery
  expect(make({id: 'SO-1', ownerId: 'rep-2'})(openMemo)).toBe(true); // someone else's editor
  expect(editing({table: 'sales_order_memos', id: 'not-mine'})).toBe(false); // rep filter still applies
});
