/**
 * Renders the OMG Deposits card the way the OMG Stores page does, with a real
 * statement, and checks what a person actually sees.
 *
 * The parser has its own tests; this covers the piece they cannot — that the
 * card puts a matched row on its store and leaves an unmatched one waiting
 * rather than dropping it, and that a statement which fails its cross-checks
 * cannot be imported. Supabase is stubbed, so nothing here touches a database.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../lib/supabase', () => ({ supabase: null }));

const OmgDepositImport = require('../OmgDepositImport').default;

// The real 09/15/26 statement as pdf.js extracts it, trimmed to four stores:
// D2SVU is in the portal (and is the net-refund row), the other three are not.
const STATEMENT = [
  'National Sports Apparel LLC\tDeposit Statement',
  'Orange, CA 92865\tVQFGYBTFP',
  'Statement Date\t09/15/26\tTotal Collected\t$4,509.27',
  'Deposit Status\tpending\tOMG Fee Withheld\t($171.56)',
  'Bank Account FIRST FOUNDATION BANK – 7609\tProcessing Fee Withheld\t($150.53)',
  'Stores Included\t4\tNet Amount\t$4,187.18',
  'Work Order\tStore\tTotal Collected\tOMG Fee Processing Fee\tNet Deposit',
  'GEX63 | Alemany HS Wresting August 2026\t$3,286.23\t($124.89)\t($112.98)\t$3,048.36',
  'D2SVU | Dana Hills Football 2026\t($59.91)\t$2.28\t$1.79\t($55.84)',
  'K3Q93 | Concordia University Baseball September 2026\t$1,097.49\t($41.71)\t($35.43)\t$1,020.35',
  'KB5259 VUG6Y | Amador Valley Cross Country 2026\t$185.46\t($7.24)\t($3.91)\t$174.31',
].join('\n');

const STORES = [
  { id: 'OMG-sale_D2SVU', store_name: 'Dana Hills Football 2026', _omg_sale_code: 'D2SVU' },
];

const pdfFile = () => new File(['%PDF-1.4'], '9.15.26_Dep_OMG.pdf', { type: 'application/pdf' });

const renderCard = (extractPdfText, stores = STORES) => {
  const notify = jest.fn();
  render(<OmgDepositImport stores={stores} currentUser={{ id: 'u1' }} notify={notify} extractPdfText={extractPdfText}/>);
  return notify;
};

const openAndUpload = async (text) => {
  const notify = renderCard(async () => ({ fullText: text }));
  fireEvent.click(screen.getByRole('button', { name: /Import deposit statement/i }));
  const input = document.querySelector('input[type=file]');
  fireEvent.change(input, { target: { files: [pdfFile()] } });
  await waitFor(() => expect(notify).toHaveBeenCalled());
  return notify;
};

describe('OMG Deposits card', () => {
  test('the entry button is on the page before anything is uploaded', () => {
    renderCard(async () => ({ fullText: '' }));
    expect(screen.getByText('OMG Deposits')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import deposit statement/i })).toBeInTheDocument();
    expect(screen.getByText(/No deposit statements imported yet/i)).toBeInTheDocument();
  });

  test('the drop zone appears when the button is clicked', () => {
    renderCard(async () => ({ fullText: '' }));
    fireEvent.click(screen.getByRole('button', { name: /Import deposit statement/i }));
    expect(screen.getByText(/Drop the/i)).toBeInTheDocument();
  });

  test('a real statement shows its header, every row, and an enabled import', async () => {
    await openAndUpload(STATEMENT);
    expect(screen.getByText('VQFGYBTFP')).toBeInTheDocument();
    expect(screen.getByText(/\$4,187\.18/)).toBeInTheDocument();      // net deposit
    expect(screen.getByText('Alemany HS Wresting August 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import 4 store rows/i })).toBeEnabled();
  });

  test('a row whose store is in the portal is marked as applying to it', async () => {
    await openAndUpload(STATEMENT);
    // D2SVU is the only seeded store, so exactly one row applies now…
    expect(screen.getAllByText('This store')).toHaveLength(1);
    // …and the other three are kept, waiting for their store.
    expect(screen.getAllByText('Waits for this store')).toHaveLength(3);
    expect(screen.getByText(/1 of 4 rows match a store in the portal today/i)).toBeInTheDocument();
  });

  test('a matched row shows the portal store name, not the name OMG printed', async () => {
    const text = STATEMENT.replace('D2SVU | Dana Hills Football 2026', 'D2SVU | DANA HILLS FB (omg spelling)');
    await openAndUpload(text);
    expect(screen.getByText('Dana Hills Football 2026')).toBeInTheDocument();
  });

  test('the refund row keeps its printed negative signs', async () => {
    await openAndUpload(STATEMENT);
    expect(screen.getByText('($55.84)')).toBeInTheDocument();   // net deposit
    expect(screen.getByText('($59.91)')).toBeInTheDocument();   // collected
  });

  test('a statement that fails its cross-checks cannot be imported', async () => {
    const tampered = STATEMENT.replace('Stores Included\t4', 'Stores Included\t9');
    await openAndUpload(tampered);
    expect(screen.getByText(/did not read cleanly/i)).toBeInTheDocument();
    expect(screen.getByText(/Statement says 9 stores but 4 rows were read/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import 4 store rows/i })).toBeDisabled();
  });

  test('a file that is not a deposit statement is refused', async () => {
    await openAndUpload('Accounting Report\nTotal Collected\t$500.00');
    expect(screen.getByText(/not an OMG Deposit Statement/i)).toBeInTheDocument();
  });

  test('a PDF that cannot be read is reported, not swallowed', async () => {
    const notify = renderCard(async () => { throw new Error('password-protected'); });
    fireEvent.click(screen.getByRole('button', { name: /Import deposit statement/i }));
    fireEvent.change(document.querySelector('input[type=file]'), { target: { files: [pdfFile()] } });
    await waitFor(() => expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('password-protected'), 'error'));
  });

  test('a non-PDF is rejected before any parsing is attempted', async () => {
    const extract = jest.fn();
    const notify = renderCard(extract);
    fireEvent.click(screen.getByRole('button', { name: /Import deposit statement/i }));
    fireEvent.change(document.querySelector('input[type=file]'), {
      target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Drop the OMG Deposit Statement PDF/i), 'error'));
    expect(extract).not.toHaveBeenCalled();
  });
});
