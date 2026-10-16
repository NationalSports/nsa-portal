import { artLiveDsts } from '../constants';
import { hasConfirmedDstThreadOrder } from './dstThreadOrder';

// After Oct 16 in the business's Pacific timezone, including date-only legacy
// fields. Never use updated_at: editing an old job must not remove its exemption.
export const DST_THREAD_REQUIRED_FROM = '2026-10-17';
export const createdAfterThreadCutoff = value => {
  if (!value) return false;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s >= DST_THREAD_REQUIRED_FROM;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,|$)/);
  if (us) return `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}` >= DST_THREAD_REQUIRED_FROM;
  const time = Date.parse(s);
  if (!Number.isFinite(time)) return false;
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time));
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}` >= DST_THREAD_REQUIRED_FROM;
};
export const requiresDstThreadOrder = (art, job) => art?.deco_type === 'embroidery'
  && (createdAfterThreadCutoff(job?.created_at) || createdAfterThreadCutoff(art.created_at || art.uploaded));

export const requiredDstThreadMessage = (arts, job) => {
  const missing = (arts || []).filter(a => a && !a.archived && requiresDstThreadOrder(a, job)).filter(a => {
    const dst = artLiveDsts(a).slice(-1)[0];
    const url = typeof dst === 'string' ? dst : dst?.url;
    return !a.color_ways?.length || a.color_ways.some(cw => !hasConfirmedDstThreadOrder(cw, url)
      || !cw.inks?.length || cw.inks.some(ink => !String(ink || '').trim()));
  });
  return missing.length ? 'Confirm DST thread order before production for ' + missing.map(a => a.name || 'Embroidery').join('; ')
    + '. Open the artwork, attach its DST, enter one thread per stop in sewing order, and check “Use DST coloring”.' : '';
};
