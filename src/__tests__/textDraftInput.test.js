// Typing an item name used to write straight through to the order object, re-rendering the whole
// order editor for every character — the lag reps hit on custom items. TextDraftInput buffers the
// keystrokes locally and commits on blur, the same protocol QuantityDraftInput already uses for
// size cells. These tests pin both halves: the parent stays out of the keystroke path, and nothing
// the rep typed can be lost (every keystroke stages a draft; blur commits it).
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TextDraftInput from '../TextDraftInput';

// Mirrors the editor call site: the parent owns the draft ref and commits on blur.
function Harness({ onCommitSpy, onStageSpy, renderSpy, initial = 'Custom Jersey' }) {
  const [value, setValue] = React.useState(initial);
  renderSpy();
  return (
    <div>
      <TextDraftInput value={value} draftKey="0_name" placeholder="Item name..."
        onStage={onStageSpy}
        onCommit={(v, prev) => { onCommitSpy(v, prev); setValue(v); }} />
      <span data-testid="committed">{value}</span>
    </div>
  );
}

const setup = (initial) => {
  const onCommitSpy = jest.fn(); const onStageSpy = jest.fn(); const renderSpy = jest.fn();
  render(<Harness onCommitSpy={onCommitSpy} onStageSpy={onStageSpy} renderSpy={renderSpy} initial={initial} />);
  return { input: screen.getByPlaceholderText('Item name...'), onCommitSpy, onStageSpy, renderSpy };
};

const type = (input, text) => {
  fireEvent.focus(input);
  let acc = input.value;
  for (const ch of text) { acc += ch; fireEvent.change(input, { target: { value: acc } }); }
};

test('typing never re-renders the parent — the whole point of the buffer', () => {
  const { input, renderSpy } = setup('');
  const before = renderSpy.mock.calls.length;
  type(input, 'Custom Reversible Basketball Jersey');
  expect(renderSpy.mock.calls.length).toBe(before); // 34 characters, zero parent renders
  expect(input.value).toBe('Custom Reversible Basketball Jersey');
});

test('every keystroke stages a draft, so Save/autosave can flush what is typed', () => {
  const { input, onStageSpy } = setup('');
  type(input, 'Abc');
  expect(onStageSpy.mock.calls).toEqual([['0_name', 'A'], ['0_name', 'Ab'], ['0_name', 'Abc']]);
});

test('the field is marked for the editor draft flush', () => {
  const { input } = setup('');
  expect(input.dataset.sizingDraft).toBe('true');
});

test('blur commits the typed value and the value at focus', () => {
  const { input, onCommitSpy } = setup('Old Name');
  type(input, '!');
  expect(onCommitSpy).not.toHaveBeenCalled(); // nothing committed mid-word
  fireEvent.blur(input);
  expect(onCommitSpy).toHaveBeenCalledWith('Old Name!', 'Old Name');
  expect(screen.getByTestId('committed').textContent).toBe('Old Name!');
});

test('Enter commits (it blurs the field)', () => {
  const { input, onCommitSpy } = setup('');
  input.focus();
  type(input, 'Jersey');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onCommitSpy).toHaveBeenCalledWith('Jersey', '');
});

test('an outside value change lands while the field is idle', () => {
  const { input } = setup('First');
  type(input, ' Edit');
  fireEvent.blur(input);
  expect(input.value).toBe('First Edit');
});

test('an outside re-render never yanks the cursor back mid-word', () => {
  const onCommitSpy = jest.fn(); const onStageSpy = jest.fn();
  const Outside = () => {
    const [tick, setTick] = React.useState(0);
    return (
      <div>
        <TextDraftInput value={'Committed'} draftKey="0_name" placeholder="Item name..."
          onStage={onStageSpy} onCommit={onCommitSpy} />
        <button onClick={() => setTick(tick + 1)}>rerender</button>
      </div>
    );
  };
  render(<Outside />);
  const input = screen.getByPlaceholderText('Item name...');
  type(input, ' half-typed');
  fireEvent.click(screen.getByText('rerender')); // autosave stamp, sibling edit, anything
  expect(input.value).toBe('Committed half-typed');
});

test('focus + blur with no typing commits nothing', () => {
  const { input, onCommitSpy, onStageSpy } = setup('Untouched');
  fireEvent.focus(input);
  fireEvent.blur(input);
  expect(onStageSpy).not.toHaveBeenCalled();
  // onCommit still fires so the caller can close an inline editor; the caller's own
  // "no draft staged" guard is what keeps it from writing to the order.
  expect(onCommitSpy).toHaveBeenCalledWith('Untouched', 'Untouched');
});
