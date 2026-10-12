import React from 'react';
const format = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export default function ItemShipEstimate({ estimate }) {
  if (!estimate || estimate.state === 'shipped') return null;
  const e = estimate;
  return <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: e.state === 'delayed' ? '#92400e' : '#475569' }}>
    <div>{e.message}</div>
    {e.state !== 'delayed' && e.state !== 'ready' && e.arrival_date && <div>Estimated supplier arrival: {format(e.arrival_date)}</div>}
    {e.state !== 'delayed' && e.state !== 'ready' && e.ready_date && <div>Estimated stock ready: {format(e.ready_date)}</div>}
    {e.ship_date ? <div style={{ fontWeight: 700 }}>Estimated to ship: {format(e.ship_date)}</div> : e.ship_date === null && <div>Estimated ship date pending</div>}
    {e.production_days === null && <div>Production timing to be confirmed</div>}
    {e.production_days != null && <div>Production allowance: {e.production_days} business day{e.production_days === 1 ? '' : 's'}</div>}
  </div>;
}
