// Printable job ticket for the Team Shop fast-turn floor. The ticket carries a
// Code 128 barcode of the job's scan code — the same code families
// netlify/functions/_jobScanResolver.js resolves (DG-#### digitizer code, else
// the DST filename), so scanning a ticket at a floor station (src/floorstation)
// or a phone drives the 00192 stage machine via job-scan.
//
// Barcode: barcodeSvg from src/utils.js (jsbarcode, already a dependency —
// inline SVG so the print window never waits on an external image).
// Print: window.open + document.write + print, the pattern RosterOrders /
// OrderEditor use for their print sheets.
import { supabase } from '../lib/supabase';
import { barcodeSvg, fileDisplayName } from '../utils';
import { dgCodeOf, isDstFile } from '../constants';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Art rows for one SO — the same columns job-scan's buildIndex reads.
export async function fetchTicketArts(soId) {
  const { data, error } = await supabase
    .from('so_art_files')
    .select('so_id, id, name, files, prod_files')
    .eq('so_id', soId);
  if (error) throw error;
  return data || [];
}

// The scannable code for a job, derived exactly the way job-scan's buildIndex
// derives its index entries (art ids via _art_ids/art_file_id; DG codes and DST
// names off prod_files + files + art/job names): prefer the DG code (short,
// stable across file revisions), then a DST filename. For NON-embroidery jobs
// (DTF / screen print — no DST or DG to scan) fall back to the job-identity
// code JOB:<so_id>:<job_id>, which job-scan resolves straight to this job. An
// embroidery job with no DG/DST still returns code:null on purpose — the ticket
// shows the "upload the DST" prompt rather than a code the machine can't load a
// design from. Returns { code, dst }.
export function ticketCodeFor(job, arts) {
  const artIds = (Array.isArray(job._art_ids) && job._art_ids.length ? job._art_ids : [job.art_file_id]).filter(Boolean);
  const mine = (arts || []).filter((a) => a.so_id === job.so_id && artIds.includes(a.id));
  let dg = null;
  let dst = null;
  for (const art of mine) {
    for (const f of [...(art.prod_files || []), ...(art.files || [])]) {
      const name = fileDisplayName(f);
      if (!dst && isDstFile(name)) dst = name;
      if (!dg) dg = dgCodeOf(name);
    }
    if (!dg) dg = dgCodeOf(art.name) || dgCodeOf(job.art_name);
  }
  if (!dg) dg = dgCodeOf(job.art_name);
  const jobIdCode = (job.deco_type !== 'embroidery' && job.so_id && job.id) ? 'JOB:' + job.so_id + ':' + job.id : null;
  return { code: dg || dst || jobIdCode, dst };
}

// Print-ready ticket HTML (pure given the barcode SVG markup barcodeSvg
// produces — unit-testable under jsdom with a canvas measureText stub).
export function buildTicketHtml(job, order, arts) {
  const { code, dst } = ticketCodeFor(job, arts);
  const barcode = code ? barcodeSvg(code, { height: 64, width: 2, fontSize: 15 }) : '';
  const row = (label, value) => (value
    ? `<div class="row"><span class="lbl">${esc(label)}</span><span class="val">${esc(value)}</span></div>`
    : '');
  return `<!doctype html><html><head><title>Job ticket ${esc(job.id)}</title><style>
  @page{margin:0.35in}
  body{font-family:system-ui,-apple-system,sans-serif;color:#111;margin:0}
  .ticket{border:2px solid #111;border-radius:10px;padding:18px;max-width:420px}
  .art{font-size:22px;font-weight:800;margin:0 0 4px}
  .deco{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#333;margin:0 0 12px}
  .row{display:flex;gap:10px;font-size:14px;margin:3px 0}
  .lbl{width:80px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#666;padding-top:3px}
  .val{font-weight:700}
  .bc{margin-top:14px;text-align:center}
  .nocode{margin-top:14px;padding:10px;border:2px dashed #b91c1c;color:#b91c1c;font-size:12px;font-weight:700;text-align:center}
  </style></head><body><div class="ticket">
  <p class="art">${esc(job.art_name || 'Unassigned Art')}</p>
  <p class="deco">${esc(job.deco_type || '—')}</p>
  ${row('SO', job.so_id)}
  ${row('Job', job.id)}
  ${row('Buyer', order && (order.buyer_name || order.buyer_email))}
  ${row('Positions', job.positions)}
  ${row('Units', job.total_units)}
  ${job.deco_type === 'embroidery' ? row('DST file', dst || '(not digitized yet)') : ''}
  ${barcode
    ? `<div class="bc">${barcode}</div>`
    : '<div class="nocode">No scan code yet — art has no DG code or DST file</div>'}
  </div></body></html>`;
}

// Open the ticket in a print window (same open→write→print flow as
// RosterOrders.js / OrderEditor.js print sheets). Returns false when the popup
// was blocked so the caller can toast.
export function openTicket(job, order, arts) {
  const html = buildTicketHtml(job, order, arts);
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 250);
  return true;
}
