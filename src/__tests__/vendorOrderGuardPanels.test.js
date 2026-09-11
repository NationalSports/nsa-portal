import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DuplicateMergeWarning, UnacceptedLinesPanel } from '../VendorOrderGuardPanels';
import { collapseVendorLines, reconcileVendorLines } from '../lib/vendorOrderGuards';

// The duplicated-queue shape from batch NSA 4632 (SO-2277), and a legitimate cross-SO merge.
const dupedQueue = collapseVendorLines([
  { style: 'AT203', color: 'Black/ White', size: 'L', sku: 'B029F8505', quantity: 4, sourceSO: 'SO-2277' },
  { style: 'AT203', color: 'Black/ White', size: 'L', sku: 'B029F8505', quantity: 4, sourceSO: 'SO-2277' },
], l => l.sku).duplicates;

const crossSoMerge = collapseVendorLines([
  { style: 'AT203', color: 'Black/ White', size: 'L', sku: 'B029F8505', quantity: 4, sourceSO: 'SO-1111' },
  { style: 'AT203', color: 'Black/ White', size: 'L', sku: 'B029F8505', quantity: 2, sourceSO: 'SO-2222' },
], l => l.sku).duplicates;

describe('DuplicateMergeWarning', () => {
  test('renders nothing when there is nothing to merge', () => {
    const { container } = render(<DuplicateMergeWarning duplicates={[]} acknowledged={false} onAcknowledge={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('shows the combined quantity and the parts it came from', () => {
    render(<DuplicateMergeWarning duplicates={dupedQueue} acknowledged={false} onAcknowledge={() => {}} vendorName="S&S" />);
    expect(screen.getByText(/8 units will be ordered as ONE combined quantity/i)).toBeInTheDocument();
    expect(screen.getByText('AT203 Black/ White L')).toBeInTheDocument();
    expect(screen.getByText('B029F8505')).toBeInTheDocument();
  });

  test('escalates when every part came from the SAME sales order (the NSA 4632 fault)', () => {
    render(<DuplicateMergeWarning duplicates={dupedQueue} acknowledged={false} onAcknowledge={() => {}} vendorName="S&S" />);
    expect(screen.getByText(/being combined from lines on the/i)).toBeInTheDocument();
    expect(screen.getByText(/NSA 4632 fault/i)).toBeInTheDocument();
    expect(screen.getByText(/cancel, fix the batch queue/i)).toBeInTheDocument();
  });

  test('does NOT escalate a legitimate merge across two sales orders', () => {
    render(<DuplicateMergeWarning duplicates={crossSoMerge} acknowledged={false} onAcknowledge={() => {}} vendorName="S&S" />);
    expect(screen.queryByText(/NSA 4632 fault/i)).not.toBeInTheDocument();
    expect(screen.getByText(/6 units will be ordered as ONE combined quantity/i)).toBeInTheDocument();
  });

  test('the acknowledgement checkbox reports back to the modal', () => {
    const onAck = jest.fn();
    render(<DuplicateMergeWarning duplicates={dupedQueue} acknowledged={false} onAcknowledge={onAck} vendorName="S&S" />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onAck).toHaveBeenCalledWith(true);
  });
});

describe('UnacceptedLinesPanel', () => {
  const sent = [
    { sku: 'B029F8505', style: 'AT203', color: 'Black/ White', size: 'L', quantity: 8, sourceSO: 'SO-2277' },
    { sku: 'B029F8706', style: 'AT203', color: 'Team Power Red/ White', size: 'XL', quantity: 8, sourceSO: 'SO-2277' },
  ];

  test('stays silent on a fully-accepted order', () => {
    const r = reconcileVendorLines(sent, { raw: { lines: [{ sku: 'B029F8505', qty: 8 }, { sku: 'B029F8706', qty: 8 }] } }, l => l.sku);
    const { container } = render(<UnacceptedLinesPanel reconcile={r} vendorName="S&S" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('names the dropped line so it can be re-ordered', () => {
    const r = reconcileVendorLines(sent, { raw: { lines: [{ sku: 'B029F8505', qty: 8 }] } }, l => l.sku);
    render(<UnacceptedLinesPanel reconcile={r} vendorName="S&S" poNumber="NSA 4632" />);
    expect(screen.getByText(/did NOT accept every line/i)).toBeInTheDocument();
    expect(screen.getByText(/AT203 Team Power Red\/ White XL/)).toBeInTheDocument();
    expect(screen.getByText(/they are not on the order and still need to be bought/i)).toBeInTheDocument();
  });

  test('says "could not verify" — not "dropped" — when the vendor returned no line detail', () => {
    const r = reconcileVendorLines(sent, { raw: { orderNumber: '75771511' } }, l => l.sku);
    render(<UnacceptedLinesPanel reconcile={r} vendorName="S&S" poNumber="NSA 4632" />);
    expect(screen.getByText(/returned no line detail/i)).toBeInTheDocument();
    expect(screen.queryByText(/did NOT accept every line/i)).not.toBeInTheDocument();
  });
});
