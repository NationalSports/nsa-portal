import fs from 'fs';
import path from 'path';

// SO-1518: tabbing through School PO # / Memo / Alert Days without typing marked the order
// "Unsaved" and the 30s autosave then pushed an unchanged order. A blur commits only a change.
// Both editors must behave the same, so each handler is taken verbatim from each file.
const editors = ['OrderEditorClassic.js', 'OrderEditor.js'];
const fields = ['po_number', 'memo', 'booking_alert_days'];
const handler = (file, field) => {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const m = src.match(new RegExp("onBlur=\\{(e=>\\{[^\\n]*?sv\\('" + field + "'[^\\n]*?\\})\\}"));
  expect(m).not.toBeNull();
  return m[1];
};

describe.each(editors)('%s header blur', file => {
  test.each(fields)('%s: unchanged blur is a no-op, a real change is committed', field => {
    const sv = jest.fn();
    const o = {po_number: 'PO-1', memo: 'Fall Tees', booking_alert_days: null};
    const blur = Function('o', 'sv', 'return (' + handler(file, field) + ')')(o, sv);
    const same = {po_number: 'PO-1', memo: 'Fall Tees', booking_alert_days: '100'}[field];
    blur({target: {value: same}});
    expect(sv).not.toHaveBeenCalled();
    blur({target: {value: field === 'booking_alert_days' ? '120' : 'changed'}});
    expect(sv).toHaveBeenCalledTimes(1);
  });
});

test('both editors use the identical blur logic', () => {
  fields.forEach(f => expect(handler(editors[0], f)).toBe(handler(editors[1], f)));
});
