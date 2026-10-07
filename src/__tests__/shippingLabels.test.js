import { isStoredLabelRef, resolveLabelUrl, printShippingLabel, downloadShippingLabel } from '../lib/shippingLabels';

jest.mock('../lib/supabase', () => ({ supabase: { from: () => { throw new Error('default client must not be used in tests'); } } }));

const PDF = 'data:application/pdf;base64,' + btoa('%PDF-1.4 test');

// Minimal stand-in for supabase.from('so_shipping_labels').select().eq().maybeSingle().
const mockClient = (result) => {
  const calls = [];
  const q = {
    select: (cols) => { calls.push(['select', cols]); return q; },
    eq: (col, val) => { calls.push(['eq', col, val]); return q; },
    maybeSingle: () => Promise.resolve(result),
  };
  return { calls, from: (table) => { calls.push(['from', table]); return q; } };
};

describe('shipping label references', () => {
  test('only nsa-label: strings are stored references', () => {
    expect(isStoredLabelRef('nsa-label:abc')).toBe(true);
    expect(isStoredLabelRef(PDF)).toBe(false);
    expect(isStoredLabelRef('https://ssapi.shipstation.com/x')).toBe(false);
    expect(isStoredLabelRef(null)).toBe(false);
    expect(isStoredLabelRef({ href: 'x' })).toBe(false);
  });

  test('data and https labels pass through without a database call', async () => {
    const c = mockClient({ data: null, error: null });
    await expect(resolveLabelUrl(PDF, c)).resolves.toBe(PDF);
    await expect(resolveLabelUrl('https://ssapi.shipstation.com/x', c)).resolves.toBe('https://ssapi.shipstation.com/x');
    expect(c.calls).toEqual([]);
  });

  test('a reference is fetched by id from so_shipping_labels', async () => {
    const c = mockClient({ data: { data_url: PDF }, error: null });
    await expect(resolveLabelUrl('nsa-label:0123abcd', c)).resolves.toBe(PDF);
    expect(c.calls).toEqual([['from', 'so_shipping_labels'], ['select', 'data_url'], ['eq', 'id', '0123abcd']]);
  });

  test('a failed or empty lookup throws a readable error', async () => {
    await expect(resolveLabelUrl('nsa-label:x', mockClient({ data: null, error: { message: 'permission denied' } })))
      .rejects.toThrow('Could not load the shipping label: permission denied');
    await expect(resolveLabelUrl('nsa-label:x', mockClient({ data: null, error: null }))).rejects.toThrow('Shipping label not found');
  });
});

describe('print and download', () => {
  afterEach(() => { document.body.innerHTML = ''; jest.restoreAllMocks(); });

  test('an https label opens synchronously inside the click (popup blockers)', () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    printShippingLabel('https://ssapi.shipstation.com/x'); // deliberately not awaited
    expect(open).toHaveBeenCalledWith('https://ssapi.shipstation.com/x', '_blank');
  });

  test('a stored reference prints the fetched PDF through a hidden iframe', async () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    await printShippingLabel('nsa-label:abc', mockClient({ data: { data_url: PDF }, error: null }));
    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute('src')).toBe(PDF);
    expect(open).not.toHaveBeenCalled();
  });

  test('a stored reference downloads as a named PDF file', async () => {
    URL.createObjectURL = jest.fn(() => 'blob:label');
    URL.revokeObjectURL = jest.fn();
    const clicks = [];
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicks.push([this.getAttribute('href'), this.download]); });
    await downloadShippingLabel('nsa-label:abc', 'shipping-label-SO-1.pdf', mockClient({ data: { data_url: PDF }, error: null }));
    expect(clicks).toEqual([['blob:label', 'shipping-label-SO-1.pdf']]);
  });
});
