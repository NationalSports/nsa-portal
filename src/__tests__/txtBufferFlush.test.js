/* $Txt buffered input (src/components.js).
 *
 * Keystrokes buffer locally so the huge OrderEditor tree doesn't re-render per
 * character — but buffered text MUST still reach order state without a blur:
 * the 30s autosave, the beforeunload save, and the unsaved-changes tab-close
 * warning all read committed order state, so text that only committed on blur
 * was invisible to every safety net while the field stayed focused (closing the
 * tab mid-note silently lost the whole note, with no warning).
 *
 * Contract: commit on a short typing pause (TXT_IDLE_MS), at most TXT_MAX_MS
 * behind during continuous typing, and immediately on blur / Enter / unmount.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { $Txt } from '../components';

// Mirrors real usage: parent owns the value and re-renders on commit.
function Host({ onCommit, initial = '' }) {
  const [v, setV] = React.useState(initial);
  return <$Txt value={v} onChange={(nv) => { onCommit(nv); setV(nv); }} placeholder="note" />;
}

const type = (input, text) => fireEvent.change(input, { target: { value: text } });

beforeEach(() => jest.useFakeTimers());
afterEach(() => { act(() => jest.runOnlyPendingTimers()); jest.useRealTimers(); });

test('does not commit per keystroke', () => {
  const onCommit = jest.fn();
  const { getByPlaceholderText } = render(<Host onCommit={onCommit} />);
  const input = getByPlaceholderText('note');
  fireEvent.focus(input);
  type(input, 'h');
  act(() => jest.advanceTimersByTime(100));
  type(input, 'he');
  act(() => jest.advanceTimersByTime(100));
  type(input, 'hey');
  expect(onCommit).not.toHaveBeenCalled();
});

test('commits after a typing pause without blur', () => {
  const onCommit = jest.fn();
  const { getByPlaceholderText } = render(<Host onCommit={onCommit} />);
  const input = getByPlaceholderText('note');
  fireEvent.focus(input);
  type(input, 'navy body');
  act(() => jest.advanceTimersByTime(450));
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith('navy body');
  // Nothing further pending once raw === committed value.
  act(() => jest.advanceTimersByTime(5000));
  expect(onCommit).toHaveBeenCalledTimes(1);
});

test('stays at most ~1.5s behind during continuous typing (idle timer never fires)', () => {
  const onCommit = jest.fn();
  const { getByPlaceholderText } = render(<Host onCommit={onCommit} />);
  const input = getByPlaceholderText('note');
  fireEvent.focus(input);
  let text = '';
  // A keystroke every 300ms always resets the 400ms idle timer — only the
  // max-wait bound can commit.
  for (let i = 0; i < 6; i++) {
    text += 'x';
    type(input, text);
    if (i < 5) act(() => jest.advanceTimersByTime(300));
  }
  // 1500ms elapsed since first uncommitted keystroke → committed at the bound.
  expect(onCommit).toHaveBeenCalledWith('xxxxxx');
});

test('blur commits immediately', () => {
  const onCommit = jest.fn();
  const { getByPlaceholderText } = render(<Host onCommit={onCommit} />);
  const input = getByPlaceholderText('note');
  fireEvent.focus(input);
  type(input, 'left chest');
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith('left chest');
});

test('Enter commits (via blur) without waiting for the timer', () => {
  const onCommit = jest.fn();
  const { getByPlaceholderText } = render(<Host onCommit={onCommit} />);
  const input = getByPlaceholderText('note');
  fireEvent.focus(input);
  type(input, 'PMS 289');
  act(() => { input.blur = () => fireEvent.blur(input); fireEvent.keyDown(input, { key: 'Enter' }); });
  expect(onCommit).toHaveBeenCalledWith('PMS 289');
});

test('unmount flushes pending text (view switch mid-typing)', () => {
  const onCommit = jest.fn();
  const { getByPlaceholderText, unmount } = render(<Host onCommit={onCommit} />);
  const input = getByPlaceholderText('note');
  fireEvent.focus(input);
  type(input, 'rush — ship by Fri');
  unmount();
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith('rush — ship by Fri');
});

test('external value updates still re-seed an unfocused input', () => {
  const onCommit = jest.fn();
  function Outside() {
    const [v, setV] = React.useState('a');
    return (
      <div>
        <button onClick={() => setV('b')}>set</button>
        <$Txt value={v} onChange={(nv) => { onCommit(nv); setV(nv); }} placeholder="note" />
      </div>
    );
  }
  const { getByPlaceholderText, getByText } = render(<Outside />);
  fireEvent.click(getByText('set'));
  expect(getByPlaceholderText('note').value).toBe('b');
});
