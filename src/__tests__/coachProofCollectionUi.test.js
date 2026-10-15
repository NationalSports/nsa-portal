import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import CoachProofCollection from '../CoachProofCollection';
import { buildCoachProofCollection } from '../lib/coachProofCollection';

test('disabled drafts never resolve thumbnails; item and pending navigation stay in this order', () => {
  const entries = buildCoachProofCollection({ orderId: 'SO-1', items: [{ name: 'Pullover' }, { name: 'Cap' }], jobs: [
    { id: 'one', art_file_id: 'a', art_status: 'waiting_approval', sent_to_coach_at: 'now', items: [{ item_idx: 0 }] },
    { id: 'draft', art_file_id: 'b', art_status: 'waiting_approval', items: [] },
    { id: 'two', art_file_id: 'c', art_status: 'waiting_approval', sent_to_coach_at: 'now', items: [{ item_idx: 1 }] },
  ] });
  const onSelect = jest.fn(), previewFor = jest.fn(() => null);
  const props = { entries, activeKey: entries[0].key, orderLabel: 'Fall Gear', onSelect, previewFor };
  const { rerender } = render(<CoachProofCollection {...props} />);
  expect(screen.getByRole('region', { name: 'Order proof collection' })).toBeInTheDocument();
  expect(previewFor.mock.calls.map(([e]) => e.jobId)).not.toContain('draft');
  expect(screen.getByRole('button', { name: /Mockup in progress/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next pending design →' }));
  expect(onSelect).toHaveBeenLastCalledWith(entries[2]);
  fireEvent.click(screen.getByRole('button', { name: 'Next item →' }));
  expect(onSelect).toHaveBeenLastCalledWith(entries[2]);
  rerender(<CoachProofCollection {...props} busy />);
  screen.getAllByRole('button').forEach(button => expect(button).toBeDisabled());
});
