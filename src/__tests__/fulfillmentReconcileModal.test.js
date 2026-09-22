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
const props = (over = {}) => ({ data: data(), onClose: noop, onApply: noop, onPin: noop, onUnpin: noop, onSaveRecheck: noop, onForce: noop, onOpenDecoPo: noop, onSyncDecoPo: noop, dirty: false, saving: false, ...over });

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
    expect(footer.textContent).toMatch(/re-check file/i);
  });
});

describe('accepting the change', () => {
  // Re-checking is read-only. Gating it on unsaved changes stranded a rep who had
  // already fixed the real problem outside the panel and just wanted to know whether
  // the file passes now: "still no way to recheck... its staying greyed out".
  test('always lets the rep re-check, even with nothing changed here', () => {
    render(<FulfillmentReconcileModal {...props({ dirty: false })} />);
    const btn = screen.getByRole('button', { name: /Re-check file/i });
    expect(btn.disabled).toBe(false);
  });

  test('offers to save as well once this order has unsaved changes', () => {
    render(<FulfillmentReconcileModal {...props({ dirty: true })} />);
    const btn = screen.getByRole('button', { name: /Save & re-check file/i });
    expect(btn.disabled).toBe(false);
  });

  test('points a rep who fixed something elsewhere at the re-check', () => {
    render(<FulfillmentReconcileModal {...props({ dirty: false })} />);
    expect(screen.getByText(/fixed something elsewhere/i)).toBeTruthy();
  });

  test('saving runs the caller back through the report', () => {
    const onSaveRecheck = jest.fn();
    render(<FulfillmentReconcileModal {...props({ dirty: true, onSaveRecheck })} />);
    fireEvent.click(screen.getByRole('button', { name: /Save & re-check file/i }));
    expect(onSaveRecheck).toHaveBeenCalledTimes(1);
  });

  test('and runs it from a clean order too', () => {
    const onSaveRecheck = jest.fn();
    render(<FulfillmentReconcileModal {...props({ dirty: false, onSaveRecheck })} />);
    fireEvent.click(screen.getByRole('button', { name: /Re-check file/i }));
    expect(onSaveRecheck).toHaveBeenCalledTimes(1);
  });

  test('shows progress and blocks double-submits while working', () => {
    render(<FulfillmentReconcileModal {...props({ dirty: true, saving: true })} />);
    expect(screen.getByRole('button', { name: /Working/i }).disabled).toBe(true);
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

// The live follow-up on SO-2021: the rep applied the suggested fix, so customers and
// the sales order now agree at 43 — but the Silver Screen job was submitted for 42
// and the file is still blocked. There is nothing left to change on the item grid,
// and the panel used to go completely silent about what to do next.
describe('when the sales order is right but the Silver Screen job is stale', () => {
  const soItemsOk = [{ sku: 'AT203', name: 'Hood', color: 'Red', sizes: { S: 1, XL: 1 } }];
  const linesOk = [
    { order_id: 'o1', sku: 'AT203', name: 'Hood', color: 'Red', size: 'S', qty: 1, player_name: 'Alexandra Green' },
    { order_id: 'o2', sku: 'AT203', name: 'Hood', color: 'Red', size: 'XL', qty: 1, player_name: 'Emily Colonnello' },
  ];
  const orders = { o1: { id: 'o1', order_number: 1010509 }, o2: { id: 'o2', order_number: 1010471 } };
  const staleJob = () => ({
    so: { id: 'SO-2021' }, storeName: 'St. Francis Cross Country', label: 'Silver Screen file', format: 'product',
    issues: ['SO-2021: 2 active customer units do not match 1 Silver Screen job units'],
    soItems: soItemsOk, orderById: orders, jobUnits: 1, verifyDetail: [],
    matchup: buildFulfillmentMatchup({ lines: linesOk, soItems: soItemsOk, orderById: orders }),
  });

  test('says which side is stale and what to do about it', () => {
    render(<FulfillmentReconcileModal {...props({ data: staleJob() })} />);
    expect(screen.getAllByText(/How to match them up/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Silver Screen job was submitted for 1/i)).toBeTruthy();
    // The order that matters: the garment has to reach Silver Screen BEFORE the
    // number here is changed, or the file ships more rows than they have to print.
    expect(screen.getByText(/onto their job first/i)).toBeTruthy();
    expect(screen.getByText(/Re-sending a job does not update that number on its own/i)).toBeTruthy();
  });

  test('does not claim the leftover issue is "not a unit-count problem"', () => {
    render(<FulfillmentReconcileModal {...props({ data: staleJob() })} />);
    expect(screen.getByText(/no quantity here left to change/i)).toBeTruthy();
    expect(screen.queryByText(/not a unit-count problem/i)).toBeNull();
    // ...and it points at the section that does explain it.
    expect(screen.getAllByText(/How to match them up/i).length).toBeGreaterThan(1);
  });

  test('offers no sales-order fixes, because there is nothing there left to fix', () => {
    render(<FulfillmentReconcileModal {...props({ data: staleJob() })} />);
    expect(screen.getByText(/Suggested fixes \(0\)/)).toBeTruthy();
  });

  test('never offers a one-click way to just make the block go away', () => {
    // Syncing the deco PO quantity on its own would clear the audit while the
    // decorator still holds the old count. That is the mismatch this whole check
    // exists to catch, so the panel explains it and offers no button for it.
    render(<FulfillmentReconcileModal {...props({ data: staleJob() })} />);
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels.some((l) => /sync/i.test(l))).toBe(false);
    expect(labels.some((l) => /job/i.test(l))).toBe(false);
  });

  test('links straight to the job on their portal when we know it', () => {
    const d = { ...staleJob(), jobId: 58505, jobUrl: 'https://example.invalid/orders/58505' };
    render(<FulfillmentReconcileModal {...props({ data: d })} />);
    const link = screen.getByRole('link', { name: /Open job #58505 on their portal/i });
    expect(link.getAttribute('href')).toBe('https://example.invalid/orders/58505');
    // The guidance step names the job too, so the link is not the only mention.
    expect(screen.getByText(/add it to job #58505 on the Silver Screen portal/i)).toBeTruthy();
  });
});

// "i just need to print the damn file. i need an option for that."
describe('the escape hatch', () => {
  const withOverride = (over = {}) => ({ ...data(), canOverride: true, ...over });

  test('offers both the workbook and the CSV as they stand', () => {
    const onForce = jest.fn();
    render(<FulfillmentReconcileModal {...props({ data: withOverride(), onForce })} />);
    fireEvent.click(screen.getByRole('button', { name: /Download anyway/i }));
    expect(onForce).toHaveBeenCalledWith('product');
    fireEvent.click(screen.getByRole('button', { name: /Export CSV anyway/i }));
    expect(onForce).toHaveBeenCalledWith('csv');
  });

  test('keeps re-check as the primary action, not the override', () => {
    render(<FulfillmentReconcileModal {...props({ data: withOverride() })} />);
    // The override is a plain button; only the re-check carries the primary fill.
    const recheck = screen.getByRole('button', { name: /Re-check file/i });
    expect(recheck.style.background).toBe('rgb(37, 99, 235)');
    expect(screen.getByRole('button', { name: /Download anyway/i }).style.background).toBe('');
  });

  test('withholds it when the file could not be built at all', () => {
    // Missing required ship-to columns: overriding would hand Silver Screen a sheet
    // their importer rejects, so there is nothing here to overrule.
    render(<FulfillmentReconcileModal {...props({ data: { ...data(), canOverride: false } })} />);
    expect(screen.queryByRole('button', { name: /anyway/i })).toBeNull();
    expect(screen.getByText(/their importer would reject it/i)).toBeTruthy();
  });

  test('only offers the CSV when the blocked report was not the workbook', () => {
    render(<FulfillmentReconcileModal {...props({ data: withOverride({ format: 'pdf', label: 'Player report' }) })} />);
    expect(screen.queryByRole('button', { name: /Download anyway/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Export CSV anyway/i })).toBeTruthy();
  });
});

// "where is sync to 43?" — the button that fixes a stale job lives on the deco PO's
// own page, reached by a small chip beside an item line. Naming the PO in a
// paragraph was not enough twice running, so the panel now jumps there.
describe('getting to the deco PO', () => {
  const staleWithPo = () => ({
    ...data(), jobUnits: 1, jobId: 58403, jobPoId: 'DPO 57243 SFXC',
    matchup: buildFulfillmentMatchup({
      lines: [{ order_id: 'o1', sku: 'A', name: 'A', color: 'Red', size: 'M', qty: 2, player_name: 'P' }],
      soItems: [{ sku: 'A', name: 'A', color: 'Red', sizes: { M: 2 } }],
      orderById: { o1: { id: 'o1', order_number: 1 } },
    }),
    soItems: [{ sku: 'A', name: 'A', color: 'Red', sizes: { M: 2 } }],
  });

  test('offers a jump straight to the PO that carries the job, by name', () => {
    const onOpenDecoPo = jest.fn();
    render(<FulfillmentReconcileModal {...props({ data: staleWithPo(), onOpenDecoPo })} />);
    fireEvent.click(screen.getByRole('button', { name: /Open DPO 57243 SFXC/i }));
    expect(onOpenDecoPo).toHaveBeenCalledTimes(1);
  });

  test('and the job link on their portal alongside it', () => {
    const d = { ...staleWithPo(), jobUrl: 'https://example.invalid/o/58403' };
    render(<FulfillmentReconcileModal {...props({ data: d })} />);
    expect(screen.getByRole('link', { name: /Open job #58403/i }).getAttribute('href'))
      .toBe('https://example.invalid/o/58403');
  });

  test('no jump when nothing told us which PO it is', () => {
    render(<FulfillmentReconcileModal {...props({ data: { ...staleWithPo(), jobPoId: '' } })} />);
    expect(screen.queryByRole('button', { name: /^Open /i })).toBeNull();
  });
});

// "still no sync button" — after being sent to the deco PO page twice. The write it
// makes now lives in the panel too, labelled as the claim it actually is.
describe('recording the job quantity from the panel', () => {
  const withSync = (over = {}) => ({
    ...data(), jobUnits: 1, jobId: 58403, jobPoId: 'DPO 57243 SFXC',
    jobPoSync: { poId: 'DPO 57243 SFXC', from: 42, to: 43, expected: 129 }, ...over,
  });

  test('offers the write, naming the PO and the number', () => {
    const onSyncDecoPo = jest.fn();
    render(<FulfillmentReconcileModal {...props({ data: withSync(), onSyncDecoPo })} />);
    fireEvent.click(screen.getByRole('button', { name: /Record 43 units on DPO 57243 SFXC/i }));
    expect(onSyncDecoPo).toHaveBeenCalledTimes(1);
  });

  test('states plainly that it does not change their job', () => {
    render(<FulfillmentReconcileModal {...props({ data: withSync() })} />);
    expect(screen.getByText(/does not add anything to their job/i)).toBeTruthy();
    expect(screen.getByText(/Only once Silver Screen is actually making 43/i)).toBeTruthy();
    expect(screen.getByText(/42 → 43/)).toBeTruthy();
  });

  test('no button when the deco PO already agrees with the order', () => {
    render(<FulfillmentReconcileModal {...props({ data: withSync({ jobPoSync: null }) })} />);
    expect(screen.queryByRole('button', { name: /Record .* units on/i })).toBeNull();
  });
});
