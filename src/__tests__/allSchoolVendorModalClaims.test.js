import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SanMarPreviewModal from '../SanMarPreviewModal';
import SSOrderModal from '../SSOrderModal';
import * as vendors from '../vendorApis';
jest.mock('../vendorApis', () => ({
  sanmarSubmitPO: jest.fn(), sanmarResolvePartIds: jest.fn(), sanmarGetWarehouseStock: jest.fn(), sanmarStyleVariants: jest.fn(),
  ssSubmitOrder: jest.fn(), ssResolveSkus: jest.fn(), ssSearchProducts: jest.fn(), ssGetOrders: jest.fn(), ssGetWarehouseStock: jest.fn(), ssGetDaysInTransit: jest.fn(),
}));
const batchPOs = [{ so_id: 'SO-1', items: [{ sku: 'PC61', color: 'Navy', sizes: { M: 1 }, unit_cost: 5, _sanmar_partIds: { M: '123' }, _ss_skus: { M: 'B123' } }] }];
const shipTo = { companyName: 'NSA', address1: '123 Main', city: 'Orange', region: 'CA', postalCode: '92867', country: 'US' };
beforeEach(() => {
  vendors.sanmarGetWarehouseStock.mockResolvedValue({});
  vendors.ssGetWarehouseStock.mockResolvedValue({});
  vendors.ssGetDaysInTransit.mockResolvedValue({});
});
const configs = [
  { name: 'SanMar', Modal: SanMarPreviewModal, send: vendors.sanmarSubmitPO, button: /Submit Order to SanMar/, confirm: /I confirm this is a real order/ },
  { name: 'S&S', Modal: SSOrderModal, send: vendors.ssSubmitOrder, button: /Place Order with S&S/, confirm: /I confirm this is a real order/ },
];
async function submit(Modal, button, confirm, props) {
  render(<Modal batchPOs={batchPOs} poNumber="NSA 1234" shipTo={shipTo} onClose={() => {}} {...props} />);
  await waitFor(() => expect(screen.getByLabelText(confirm).disabled).toBe(false));
  fireEvent.click(screen.getByLabelText(confirm));
  fireEvent.click(screen.getByRole('button', { name: button }));
}
describe.each(configs)('$name durable purchase claim', ({ Modal, send, button, confirm }) => {
  test('claim refusal blocks vendor I/O and does not mark an unknown supplier outcome', async () => {
    const before = jest.fn(async () => false), error = jest.fn();
    await submit(Modal, button, confirm, { onBeforeSubmit: before, onSubmitError: error });
    expect(await screen.findByText(/purchase could not be reserved/)).toBeTruthy();
    expect(before).toHaveBeenCalledTimes(1); expect(send).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  test('claim failure is a presend error and does not consume an unknown outcome callback', async () => {
    const before = jest.fn(async () => { throw new Error('claim failed'); }), error = jest.fn();
    await submit(Modal, button, confirm, { onBeforeSubmit: before, onSubmitError: error });
    expect(await screen.findByText('claim failed')).toBeTruthy();
    expect(send).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  test('request error after a durable claim is recorded once before the UI offers recovery', async () => {
    const before = jest.fn(async () => true), error = jest.fn(async () => true);
    send.mockRejectedValue(new Error('request timed out'));
    await submit(Modal, button, confirm, { onBeforeSubmit: before, onSubmitError: error });
    expect(await screen.findByText('request timed out')).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1); expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0].message).toBe('request timed out');
  });
});

test.each([['placed-1', true], ['other-1', false]])('S&S bridge readback ID %s can record success only for the actual placed order', async (readbackId, expectedSuccess) => {
  const placed = { orderNumber: 'placed-1', poNumber: 'NSA 1234' };
  vendors.ssSubmitOrder.mockResolvedValue({ ...placed, raw: [placed], lineErrors: [] });
  vendors.ssGetOrders.mockResolvedValue([{ ...placed, orderNumber: readbackId, lines: [{ sku: 'B123', qtyOrdered: 1 }] }]);
  const before = jest.fn(async ({ payload }) => { payload._allSchoolSubmissionToken = '00000000-0000-4000-8000-000000000001'; return true; });
  const success = jest.fn(async () => true), error = jest.fn(async () => true);
  await submit(SSOrderModal, /Place Order with S&S/, /I confirm this is a real order/, { onBeforeSubmit: before, onSubmitted: success, onSubmitError: error });
  await waitFor(() => expect(expectedSuccess ? success : error).toHaveBeenCalledTimes(1));
  expect(expectedSuccess ? error : success).not.toHaveBeenCalled();
  expect(vendors.ssSubmitOrder).toHaveBeenCalledTimes(1);
});
