// Render tests for the reconcile panel. Both cases below are bugs that reached a
// deploy preview and were reported from the live SO-2021 view: the panel's content
// ran flush to the edges, and its actions sat below the scroll fold so there was
// "no button to actually accept or save the change".

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FulfillmentReconcileModal from '../FulfillmentReconcileModal';
import { buildFulfillmentMatchup } from '../lib/soPlayerReport';

const soItems = [{ sku: 'AT203', name: "Men's Fleece Hooded Sweatshirt", color: 'Team Power Red/ White', sizes: { S: 1 } }];
const lines = [
  { order_id: 'o1', sku: 'AT203', name: "Men's Fleece Hooded Sweatshirt", color: 'Team Power Red/ White', size: 'S', qty: 1, player_name: 'Alexandra Green' },
  { order_id: 'o2', sku: 'AT203', name: "Men's Fleece Hooded Sweatshirt", color: 'Team Power Red/ White', size: 'XL', qty: 1, player_name: 'Emily Colonnello' },
];
const orderById = { o1: { id: 'o1', order_number: 1010509 }, o2: { id: 'o2', order_number: 1010471 } };

const data = () => ({
  so: { id: 'SO-2021' }, storeName: 'St. Francis Cross Country', label: 'Silver Screen file', format: 'product',
  issues: ['SO-2021: 2 active customer units do not match 1 Silver Screen job units'],
  soItems, orderById, jobUnits: 1,
  matchup: buildFulfillmentMatchup({ lines, soItems, orderById }),
  verifyDetail: [{ order: '1010471', player: 'Emily Colonnello', name: "Men's Fleece Hooded Sweatshirt", sku: 'AT203', color: 'Team Power Red/ White', size: 'XL', wasSku: 'HR8472', wasSize: '', unmatched: false }],
});

const noop = () => {};
const props = (over = {}) => ({ data: data(), onClose: noop, onApply: noop, onPin: noop, onUnpin: noop, onSaveRecheck: noop, dirty: false, saving: false, ...over });

describe('reconcile panel layout', () => {
  // The app's padding lives on these classes, not on .modal — content placed
  // directly in .modal sits flush against the edges.
  test('uses the app modal header/body/footer, which is where padding comes from', () => {
    const { container } = render(<FulfillmentReconcileModal {...props()} />);
    expect(container.querySelector('.modal-header')).toBeTruthy();
    expect(container.querySelector('.modal-body')).toBeTruthy();
    expect(container.querySelector('.modal-footer')).toBeTruthy();
  });

  test('pins the header and footer so the actions are never scrolled out of reach', () => {
    const { container } = render(<FulfillmentReconcileModal {...props()} />);
    expect(container.querySelector('.modal-header').style.position).toBe('sticky');
    const footer = container.querySelector('.modal-footer');
    expect(footer.style.position).toBe('sticky');
    expect(footer.style.bottom).toBe('0px');
    // The save action lives in that pinned footer, not loose in the scrolling body.
    expect(footer.textContent).toMatch(/Save & re-check file/);
  });
});

describe('accepting the change', () => {
  test('offers a save action, disabled until something has actually changed', () => {
    const { rerender } = render(<FulfillmentReconcileModal {...props({ dirty: false })} />);
    const btn = () => screen.getByRole('button', { name: /Save & re-check file/i });
    expect(btn().disabled).toBe(true);
    rerender(<FulfillmentReconcileModal {...props({ dirty: true })} />);
    expect(btn().disabled).toBe(false);
  });

  test('saving runs the caller back through the report', () => {
    const onSaveRecheck = jest.fn();
    render(<FulfillmentReconcileModal {...props({ dirty: true, onSaveRecheck })} />);
    fireEvent.click(screen.getByRole('button', { name: /Save & re-check file/i }));
    expect(onSaveRecheck).toHaveBeenCalledTimes(1);
  });

  test('shows progress and blocks double-submits while saving', () => {
    render(<FulfillmentReconcileModal {...props({ dirty: true, saving: true })} />);
    expect(screen.getByRole('button', { name: /Saving/i }).disabled).toBe(true);
  });

  test('applying a fix hands up the edit and warns the figures are now historical', () => {
    const onApply = jest.fn();
    render(<FulfillmentReconcileModal {...props({ onApply })} />);
    fireEvent.click(screen.getByRole('button', { name: /Add 1 × XL/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0][0]).toMatchObject({ kind: 'add', size: 'XL', from: 0, to: 1 });
    expect(screen.getByText(/do not include the changes you just made/i)).toBeTruthy();
    expect(screen.getByText(/✓ Applied/)).toBeTruthy();
  });

  test('names the player behind the differing row', () => {
    render(<FulfillmentReconcileModal {...props()} />);
    expect(screen.getAllByText(/1010471 · Emily Colonnello/).length).toBeGreaterThan(0);
  });
});
