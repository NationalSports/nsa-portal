// Shipping-label PDFs are not part of the sales-order payload. Migration
// 20261007120000_so_shipping_labels_out_of_orders.sql moved every base64 label
// PDF out of sales_orders._shipments[].label_url into so_shipping_labels and left
// a short 'nsa-label:<id>' reference behind, so a tab no longer downloads ~21 MB of
// labels at boot and on every order reload. The PDF is fetched only on click.
//
// A shipment's label_url can hold any of three things; every Print/Download
// button that reads a SAVED shipment must go through these helpers:
//   'nsa-label:<id>'        — stored label, fetched here on click
//   'data:application/pdf…' — created in this tab and not yet re-read from the DB
//   'https://…'             — a ShipStation download link
import { supabase } from './supabase';

export const LABEL_REF_PREFIX = 'nsa-label:';
export const isStoredLabelRef = (url) => typeof url === 'string' && url.startsWith(LABEL_REF_PREFIX);

export async function resolveLabelUrl(url, client = supabase) {
  if (!isStoredLabelRef(url)) return url;
  const { data, error } = await client.from('so_shipping_labels').select('data_url')
    .eq('id', url.slice(LABEL_REF_PREFIX.length)).maybeSingle();
  if (error) throw new Error('Could not load the shipping label: ' + error.message);
  if (!data || !data.data_url) throw new Error('Shipping label not found');
  return data.data_url;
}

// Same behavior the inline Print Label buttons always had. A non-reference URL is
// printed without awaiting anything, so window.open stays inside the click gesture
// (popup blockers); a reference resolves to a data URL, which prints via iframe.
export async function printShippingLabel(url, client) {
  const u = isStoredLabelRef(url) ? await resolveLabelUrl(url, client) : url;
  if (u.startsWith('data:application/pdf')) {
    const iframe = document.createElement('iframe'); iframe.style.display = 'none'; document.body.appendChild(iframe);
    iframe.src = u; iframe.onload = () => {
      try { iframe.contentWindow.print(); } catch (e) { const a = document.createElement('a'); a.href = u; a.download = 'label.pdf'; a.click(); }
      setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 60000);
    };
  } else { const pw = window.open(u, '_blank'); if (pw) setTimeout(() => { try { pw.print(); } catch (e) {} }, 1500); }
}

// Same behavior the inline Download Label buttons always had.
export async function downloadShippingLabel(url, filename, client) {
  const u = isStoredLabelRef(url) ? await resolveLabelUrl(url, client) : url;
  const save = (href, name) => { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); };
  if (u.startsWith('data:application/pdf;base64,')) {
    try {
      const bin = atob(u.replace('data:application/pdf;base64,', ''));
      const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const bu = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
      save(bu, filename); setTimeout(() => URL.revokeObjectURL(bu), 5000);
    } catch (e) { save(u, 'label.pdf'); }
  } else save(u, 'label.pdf');
}
