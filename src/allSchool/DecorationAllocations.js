import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
export default function DecorationAllocations({ storeId, transfers = [] }) {
  const [rows, setRows] = useState([]); const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    (async () => {
      const [allocations, orders] = await Promise.all([
        supabase.from('all_school_decoration_allocations').select('transfer_code,required_qty,reserved_qty,consumed_qty,status,order_id').eq('store_id', storeId).eq('status', 'reserved'),
        supabase.from('webstore_orders').select('id,status').eq('store_id', storeId).in('status', ['paid', 'batched']),
      ]);
      if (!live) return;
      if (allocations.error || orders.error) { setError((allocations.error || orders.error).message); return; }
      const liveOrders = new Set((orders.data || []).map((o) => o.id)); const grouped = {};
      (allocations.data || []).filter((a) => liveOrders.has(a.order_id)).forEach((a) => {
        const row = grouped[a.transfer_code] ||= { code: a.transfer_code, required: 0, reserved: 0 };
        row.required += Number(a.required_qty) || 0; row.reserved += Number(a.reserved_qty) || 0;
      });
      setRows(Object.values(grouped));
    })();
    return () => { live = false; };
  }, [storeId, transfers]);
  return <div className="card" style={{ padding: 16 }}><h3 style={{ marginTop: 0 }}>All School decoration reservations</h3><p style={{ fontSize: 12, color: '#64748b' }}>Reservations belong to paid customer orders. They are part of the “On order” demand below; subtracting both would count demand twice. Incoming is supplier stock that has not been received.</p>{error && <p role="alert" style={{ color: '#b91c1c', fontSize: 12 }}>Reservations could not be loaded: {error}</p>}{rows.length ? <table style={{ width: '100%', fontSize: 13 }}><thead><tr><th style={{ textAlign: 'left' }}>Decoration</th><th>Required</th><th>Reserved</th><th>Short</th><th>Incoming</th></tr></thead><tbody>{rows.map((r) => { const stock = transfers.find((t) => t.code === r.code); const short = Math.max(0, r.required - r.reserved); return <tr key={r.code}><td>{stock?.label || r.code}</td><td style={{ textAlign: 'center' }}>{r.required}</td><td style={{ textAlign: 'center' }}>{r.reserved}</td><td style={{ textAlign: 'center', color: short ? '#b91c1c' : '#15803d', fontWeight: 700 }}>{short}</td><td style={{ textAlign: 'center' }}>{Number(stock?.incoming) || 0}{stock?.incoming_eta && ` · ${stock.incoming_eta}`}</td></tr>; })}</tbody></table> : !error && <p style={{ fontSize: 13, color: '#64748b' }}>No pending decoration reservations.</p>}</div>;
}
