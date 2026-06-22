/* eslint-disable */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from './lib/supabase';

// ─── Size lists ───────────────────────────────────────────────────────────────
const SZ_STANDARD = ['YXS','YS','YM','YL','YXL','2XS','XS','S','M','L','XL','2XL','3XL','OSFA'];
const SZ_SOCKS = ['3XS','2XS','XS','Youth Sleeves','Small','Medium','Large'];
const STATUS_LABELS = { draft:'Draft', open:'Open', submitted:'Submitted', processing:'Processing', fulfilled:'Fulfilled' };
const STATUS_COLORS = { draft:'#94a3b8', open:'#2563eb', submitted:'#7c3aed', processing:'#d97706', fulfilled:'#15803d' };

// ─── Inventory hook (product_inventory + inventory_unified) ───────────────────
function useKitInventory(items) {
  const [inv, setInv] = useState({});
  const pidKey = (items || []).map(i => i.product_id).filter(Boolean).join(',');

  useEffect(() => {
    const productIds = (items || []).map(i => i.product_id).filter(Boolean);
    if (!productIds.length) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ data: prods }, { data: inHouse }] = await Promise.all([
          supabase.from('products').select('id,sku').in('id', productIds),
          supabase.from('product_inventory').select('product_id,size,quantity').in('product_id', productIds),
        ]);
        const skuByPid = {};
        (prods || []).forEach(p => { if (p.sku) skuByPid[p.id] = p.sku; });
        const skus = [...new Set(Object.values(skuByPid))];
        let vendorRows = [];
        if (skus.length) {
          const { data: v } = await supabase
            .from('inventory_unified')
            .select('sku,size,stock_qty,future_delivery_qty,future_delivery_date')
            .in('sku', skus);
          vendorRows = v || [];
        }
        if (cancelled) return;
        const map = {};
        (inHouse || []).forEach(r => {
          if (!map[r.product_id]) map[r.product_id] = {};
          const s = map[r.product_id][r.size] || { ih: 0, vendor: 0, incoming: 0, eta: null };
          s.ih += (r.quantity || 0);
          map[r.product_id][r.size] = s;
        });
        const pidBySku = {};
        Object.entries(skuByPid).forEach(([pid, sku]) => { pidBySku[sku] = pid; });
        vendorRows.forEach(r => {
          const pid = pidBySku[r.sku];
          if (!pid) return;
          if (!map[pid]) map[pid] = {};
          const s = map[pid][r.size] || { ih: 0, vendor: 0, incoming: 0, eta: null };
          s.vendor += (r.stock_qty || 0);
          if ((r.future_delivery_qty || 0) > 0) {
            s.incoming += r.future_delivery_qty;
            if (!s.eta) s.eta = r.future_delivery_date;
          }
          map[pid][r.size] = s;
        });
        setInv(map);
      } catch (e) { console.error('[RosterOrders] inv:', e); }
    })();
    return () => { cancelled = true; };
  }, [pidKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const getStock = useCallback((productId, size) => {
    const s = inv[productId]?.[size];
    if (!s) return { avail: 0, incoming: 0, eta: null };
    return { avail: (s.ih || 0) + (s.vendor || 0), incoming: s.incoming || 0, eta: s.eta };
  }, [inv]);

  return { inv, getStock };
}

// Availability dot color
const _dotColor = (avail, incoming) =>
  avail > 0 ? '#15803d' : incoming > 0 ? '#b45309' : '#dc2626';

// ─── Roster Table Editor ──────────────────────────────────────────────────────
function TeamRosterEditor({ team, kitTemplate, readOnly }) {
  const [players, setPlayers] = useState([]);
  const [sizes, setSizes] = useState({});
  const [loading, setLoading] = useState(true);
  const [addRow, setAddRow] = useState({ first_name: '', last_name: '', jersey_number: '', is_gk: false });
  const [addingRow, setAddingRow] = useState(false);
  const [lockLoading, setLockLoading] = useState(false);
  const [isLocked, setIsLocked] = useState(team?.locked || false);

  const kitItems = useMemo(() => kitTemplate?.items || [], [kitTemplate]);
  const { getStock } = useKitInventory(kitItems);
  const hasGK = players.some(p => p.is_gk);
  const gkItems = kitItems.filter(ki => ki.gk_only);
  const mainItems = kitItems.filter(ki => !ki.gk_only);

  useEffect(() => {
    setIsLocked(team?.locked || false);
  }, [team?.locked]);

  useEffect(() => {
    if (!team?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: ps } = await supabase.from('roster_players').select('*')
        .eq('team_id', team.id).order('sort_order').order('created_at');
      if (cancelled) return;
      const playerList = ps || [];
      setPlayers(playerList);
      if (playerList.length) {
        const { data: sz } = await supabase.from('roster_player_sizes').select('*')
          .in('player_id', playerList.map(p => p.id));
        if (!cancelled) {
          const smap = {};
          (sz || []).forEach(r => {
            if (!smap[r.player_id]) smap[r.player_id] = {};
            smap[r.player_id][r.kit_slot] = r.size;
          });
          setSizes(smap);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [team?.id]);

  const saveSize = useCallback(async (playerId, kitSlot, size) => {
    setSizes(prev => ({ ...prev, [playerId]: { ...(prev[playerId] || {}), [kitSlot]: size } }));
    await supabase.from('roster_player_sizes').upsert(
      { player_id: playerId, kit_slot: kitSlot, size, updated_at: new Date().toISOString() },
      { onConflict: 'player_id,kit_slot' }
    );
  }, []);

  const updatePlayer = useCallback((id, field, val) => {
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, [field]: val } : p));
  }, []);

  const savePlayer = useCallback(async (id, field, val) => {
    await supabase.from('roster_players').update({ [field]: val }).eq('id', id);
  }, []);

  const addPlayer = async () => {
    const { first_name, last_name, jersey_number, is_gk } = addRow;
    if (!first_name.trim() && !last_name.trim()) return;
    setAddingRow(true);
    const { data, error } = await supabase.from('roster_players').insert({
      team_id: team.id, first_name: first_name.trim(), last_name: last_name.trim(),
      jersey_number: jersey_number.trim(), is_gk, sort_order: players.length,
    }).select().single();
    setAddingRow(false);
    if (!error && data) {
      setPlayers(prev => [...prev, data]);
      setAddRow({ first_name: '', last_name: '', jersey_number: '', is_gk: false });
    }
  };

  const deletePlayer = async (id) => {
    if (!window.confirm('Remove this player from the roster?')) return;
    await supabase.from('roster_players').delete().eq('id', id);
    setPlayers(prev => prev.filter(p => p.id !== id));
  };

  const toggleLock = async () => {
    setLockLoading(true);
    const newLocked = !isLocked;
    await supabase.from('roster_teams').update({ locked: newLocked }).eq('id', team.id);
    setIsLocked(newLocked);
    setLockLoading(false);
  };

  const editable = !readOnly && !isLocked;

  const cellInput = (playerId, field, value, opts = {}) => (
    <input value={value || ''} placeholder={opts.placeholder || ''}
      onChange={e => updatePlayer(playerId, field, e.target.value)}
      onBlur={e => savePlayer(playerId, field, e.target.value)}
      style={{ width: opts.width || '100%', border: 'none', background: 'transparent',
        fontSize: 12.5, outline: 'none', textAlign: opts.center ? 'center' : 'left' }} />
  );

  const sizeCell = (player, ki) => {
    const val = (sizes[player.id] || {})[ki.slot] || '-';
    const stock = ki.product_id ? getStock(ki.product_id, val) : null;
    const sizeList = ki.sock ? SZ_SOCKS : SZ_STANDARD;
    return (
      <td key={ki.slot} style={{ padding: '4px 5px', textAlign: 'center', whiteSpace: 'nowrap',
        background: ki.gk_only ? '#f0f9ff' : 'transparent' }}>
        {editable ? (
          <>
            <select value={val} onChange={e => saveSize(player.id, ki.slot, e.target.value)}
              style={{ fontSize: 12, padding: '2px 2px', border: '1px solid #e2e8f0', borderRadius: 5,
                background: val === '-' ? '#f8fafc' : '#fff', cursor: 'pointer', maxWidth: 76 }}>
              <option value="-">—</option>
              {sizeList.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {stock && val !== '-' && (
              <span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
                marginLeft: 3, background: _dotColor(stock.avail, stock.incoming),
                verticalAlign: 'middle' }} title={`${stock.avail} avail${stock.incoming ? ` + ${stock.incoming} incoming` : ''}`} />
            )}
          </>
        ) : (
          <span style={{ fontWeight: val !== '-' ? 600 : 400, color: val === '-' ? '#94a3b8' : '#0b1220' }}>{val}</span>
        )}
      </td>
    );
  };

  if (loading) return <div style={{ padding: 20, color: '#64748b', fontSize: 13 }}>Loading roster…</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#0b1220' }}>{team.name}</div>
        <span style={{ fontSize: 11, color: '#64748b' }}>{players.length} player{players.length !== 1 ? 's' : ''}</span>
        {isLocked && <span style={{ background: '#dcfce7', color: '#15803d', borderRadius: 999, padding: '2px 10px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>LOCKED</span>}
        {!readOnly && (
          <button onClick={toggleLock} disabled={lockLoading}
            style={{ marginLeft: 'auto', padding: '5px 14px', borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: 12,
              border: isLocked ? '1px solid #15803d' : '1px solid #e2e8f0',
              background: isLocked ? '#f0fdf4' : '#f8fafc', color: isLocked ? '#15803d' : '#374151' }}>
            {lockLoading ? '…' : isLocked ? '🔓 Unlock roster' : '🔒 Lock roster'}
          </button>
        )}
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: '#0b1220', color: '#fff' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, minWidth: 80 }}>First</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, minWidth: 80 }}>Last</th>
              <th style={{ padding: '8px 6px', textAlign: 'center', fontSize: 11, fontWeight: 700, minWidth: 36 }}>#</th>
              {mainItems.map(ki => (
                <th key={ki.slot} style={{ padding: '8px 6px', textAlign: 'center', fontSize: 10, fontWeight: 700, minWidth: 72, lineHeight: 1.2, maxWidth: 90 }}>
                  {ki.label}
                  {ki.takes_number && <div style={{ fontWeight: 400, fontSize: 9, opacity: 0.7 }}>w/ #</div>}
                </th>
              ))}
              {hasGK && gkItems.map(ki => (
                <th key={ki.slot} style={{ padding: '8px 6px', textAlign: 'center', fontSize: 10, fontWeight: 700, minWidth: 72, background: '#1e3a5f' }}>{ki.label}</th>
              ))}
              {editable && <th style={{ width: 32 }}></th>}
            </tr>
          </thead>
          <tbody>
            {players.map((player, idx) => {
              const rowBg = player.is_loaner ? '#fefce8' : player.is_gk ? '#f0f9ff' : idx % 2 === 0 ? '#fff' : '#fafafa';
              return (
                <tr key={player.id} style={{ borderTop: '1px solid #f1f5f9', background: rowBg }}>
                  <td style={{ padding: '5px 10px' }}>
                    {editable ? cellInput(player.id, 'first_name', player.first_name, { placeholder: 'First' })
                      : <span>{player.first_name || '—'}</span>}
                  </td>
                  <td style={{ padding: '5px 10px' }}>
                    {editable ? cellInput(player.id, 'last_name', player.last_name, { placeholder: 'Last' })
                      : <span>{player.last_name || '—'}</span>}
                  </td>
                  <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                    {editable ? cellInput(player.id, 'jersey_number', player.jersey_number, { placeholder: '#', width: 36, center: true })
                      : <span style={{ fontWeight: 700 }}>{player.jersey_number || '—'}</span>}
                  </td>
                  {mainItems.map(ki => sizeCell(player, ki))}
                  {hasGK && gkItems.map(ki => {
                    if (!player.is_gk) return (
                      <td key={ki.slot} style={{ background: '#f0f9ff', padding: '5px 6px', textAlign: 'center', color: '#94a3b8', fontSize: 11 }}>—</td>
                    );
                    return sizeCell(player, ki);
                  })}
                  {editable && (
                    <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                      <button onClick={() => deletePlayer(player.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                        title="Remove player">×</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {editable && (
              <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
                <td style={{ padding: '5px 10px' }}>
                  <input value={addRow.first_name} placeholder="First" onChange={e => setAddRow(r => ({ ...r, first_name: e.target.value }))}
                    style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 12.5, outline: 'none' }} />
                </td>
                <td style={{ padding: '5px 10px' }}>
                  <input value={addRow.last_name} placeholder="Last" onChange={e => setAddRow(r => ({ ...r, last_name: e.target.value }))}
                    style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 12.5, outline: 'none' }} />
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                  <input value={addRow.jersey_number} placeholder="#" onChange={e => setAddRow(r => ({ ...r, jersey_number: e.target.value }))}
                    style={{ width: 36, textAlign: 'center', border: 'none', background: 'transparent', fontSize: 12.5, outline: 'none' }} />
                </td>
                {kitItems.map(ki => <td key={ki.slot}></td>)}
                <td style={{ padding: '4px 6px' }}>
                  <button onClick={addPlayer} disabled={addingRow || (!addRow.first_name.trim() && !addRow.last_name.trim())}
                    style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff',
                      fontSize: 12, cursor: 'pointer', fontWeight: 700, color: '#0b1220' }}>
                    {addingRow ? '…' : '+'}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
        {players.length} player{players.length !== 1 ? 's' : ''}
        {hasGK && ` · ${players.filter(p => p.is_gk).length} GK`}
        {players.some(p => p.is_loaner) && ` · ${players.filter(p => p.is_loaner).length} loaner`}
        {!editable && isLocked && <span style={{ color: '#15803d', marginLeft: 6 }}>· Roster locked</span>}
        {!editable && !isLocked && readOnly && <span style={{ color: '#94a3b8', marginLeft: 6 }}>· Read-only</span>}
      </div>
    </div>
  );
}

// ─── Totals / Buy-Sheet ────────────────────────────────────────────────────────
function RosterTotals({ session, teams, kitTemplate }) {
  const [allPlayers, setAllPlayers] = useState([]);
  const [allSizes, setAllSizes] = useState({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});

  const kitItems = kitTemplate?.items || [];
  const { inv, getStock } = useKitInventory(kitItems);

  // Build a teamId→name map
  const teamMap = useMemo(() => {
    const m = {};
    (teams || []).forEach(t => { m[t.id] = t.name; });
    return m;
  }, [teams]);

  useEffect(() => {
    if (!teams?.length) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const teamIds = teams.map(t => t.id);
      const { data: ps } = await supabase.from('roster_players').select('*').in('team_id', teamIds);
      const playerList = ps || [];
      if (!playerList.length) { if (!cancelled) { setAllPlayers([]); setLoading(false); } return; }
      const { data: sz } = await supabase.from('roster_player_sizes').select('*').in('player_id', playerList.map(p => p.id));
      if (cancelled) return;
      const smap = {};
      (sz || []).forEach(r => {
        if (!smap[r.player_id]) smap[r.player_id] = {};
        smap[r.player_id][r.kit_slot] = r.size;
      });
      setAllPlayers(playerList);
      setAllSizes(smap);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [teams, session?.id]);

  // Aggregate: for each kit slot, for each size, list of players and count
  const totals = useMemo(() => {
    const result = {};
    kitItems.forEach(ki => {
      const bySz = {};
      allPlayers.forEach(p => {
        if (ki.gk_only && !p.is_gk) return;
        const sz = (allSizes[p.id] || {})[ki.slot];
        if (!sz || sz === '-') return;
        if (!bySz[sz]) bySz[sz] = [];
        bySz[sz].push(p);
      });
      result[ki.slot] = bySz;
    });
    return result;
  }, [kitItems, allPlayers, allSizes]);

  const exportCSV = () => {
    const rows = [['Item', 'Size', 'Count', 'Players', 'Available', 'Incoming', 'ETA']];
    kitItems.forEach(ki => {
      const bySz = totals[ki.slot] || {};
      const sizeKeys = [...SZ_STANDARD, ...SZ_SOCKS].filter(s => bySz[s]);
      sizeKeys.forEach(sz => {
        const ps = bySz[sz] || [];
        const stock = ki.product_id ? getStock(ki.product_id, sz) : { avail: 0, incoming: 0, eta: null };
        const playerStr = ps.map(p => `${p.jersey_number ? '#' + p.jersey_number + ' ' : ''}${p.first_name || ''} ${p.last_name || ''}`.trim()).join('; ');
        rows.push([ki.label, sz, ps.length, playerStr, stock.avail, stock.incoming, stock.eta || '']);
      });
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `${session?.name || 'roster'}-totals.csv`;
    a.click();
  };

  if (loading) return <div style={{ padding: 24, color: '#64748b' }}>Building totals…</div>;

  const totalPlayers = allPlayers.length;
  const lockedTeams = (teams || []).filter(t => t.locked).length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 17, color: '#0b1220' }}>Totals — {session?.name}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {(teams || []).length} team{(teams || []).length !== 1 ? 's' : ''} · {totalPlayers} players
            · {lockedTeams} of {(teams || []).length} locked
          </div>
        </div>
        <button onClick={exportCSV}
          style={{ marginLeft: 'auto', padding: '7px 16px', borderRadius: 8, border: '1px solid #e2e8f0',
            background: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: '#0b1220' }}>
          ↓ Download CSV
        </button>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 16, fontSize: 11, flexWrap: 'wrap' }}>
        {[['#15803d','Can fill'],['#b45309','Short now / incoming'],['#dc2626','Short — must reorder']].map(([c, l]) => (
          <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#64748b' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, display: 'inline-block' }} />{l}
          </span>
        ))}
      </div>

      {/* Per-item sections */}
      {kitItems.map(ki => {
        const bySz = totals[ki.slot] || {};
        const sizeKeys = [...SZ_STANDARD, ...SZ_SOCKS].filter(s => bySz[s]);
        const totalUnits = sizeKeys.reduce((a, s) => a + (bySz[s]?.length || 0) * (ki.qty || 1), 0);
        if (!sizeKeys.length) return null;
        return (
          <div key={ki.slot} style={{ marginBottom: 20, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            {/* Item header */}
            <div style={{ background: '#0b1220', color: '#fff', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>{ki.label}</div>
              {ki.takes_number && <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 400 }}>w/ number</span>}
              {ki.qty > 1 && <span style={{ fontSize: 10, opacity: 0.7 }}>×{ki.qty} per player</span>}
              <div style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 13 }}>{totalUnits} units total</div>
            </div>

            {/* Size rows */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '6px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', width: 60 }}>Size</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#64748b', width: 60 }}>Need</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b' }}>Players</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#64748b', width: 100 }}>Available</th>
                  <th style={{ padding: '6px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#64748b', width: 120 }}>Incoming</th>
                  <th style={{ padding: '6px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#64748b', width: 60 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sizeKeys.map((sz, szIdx) => {
                  const ps = bySz[sz] || [];
                  const need = ps.length * (ki.qty || 1);
                  const stock = ki.product_id ? getStock(ki.product_id, sz) : { avail: 0, incoming: 0, eta: null };
                  const { avail, incoming, eta } = stock;
                  const statusColor = !ki.product_id ? '#94a3b8' :
                    avail >= need ? '#15803d' :
                    (avail + incoming) >= need ? '#b45309' : '#dc2626';
                  const statusLabel = !ki.product_id ? '—' :
                    avail >= need ? '✅ Can fill' :
                    (avail + incoming) >= need ? `🟡 Short ${need - avail} now` :
                    `🔴 Short ${need - avail - incoming}`;
                  const expandKey = ki.slot + '|' + sz;
                  const isExpanded = expanded[expandKey];

                  return (
                    <React.Fragment key={sz}>
                      <tr style={{ borderTop: szIdx > 0 ? '1px solid #f1f5f9' : 'none', background: szIdx % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={{ padding: '7px 14px', fontWeight: 800, fontSize: 13, color: '#0b1220' }}>{sz}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, fontSize: 13, color: '#0b1220' }}>{need}</td>
                        <td style={{ padding: '7px 10px' }}>
                          <button onClick={() => setExpanded(e => ({ ...e, [expandKey]: !isExpanded }))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 11.5, color: '#3b82f6', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s', fontSize: 9 }}>▶</span>
                            {ps.slice(0, 3).map(p => {
                              const num = p.jersey_number ? `#${p.jersey_number} ` : '';
                              const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
                              return num + name;
                            }).join(', ')}{ps.length > 3 ? ` + ${ps.length - 3} more` : ''}
                          </button>
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: avail >= need ? '#15803d' : avail > 0 ? '#b45309' : '#94a3b8', fontSize: 13 }}>
                          {ki.product_id ? avail.toLocaleString() : '—'}
                        </td>
                        <td style={{ padding: '7px 14px', textAlign: 'right', fontSize: 12, color: incoming > 0 ? '#1e40af' : '#94a3b8' }}>
                          {ki.product_id ? (incoming > 0 ? `${incoming.toLocaleString()}${eta ? ` · ${eta}` : ''}` : '—') : '—'}
                        </td>
                        <td style={{ padding: '7px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: statusColor, whiteSpace: 'nowrap' }}>
                          {statusLabel}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ background: '#f0f9ff', borderTop: '1px solid #e0f2fe' }}>
                          <td colSpan={6} style={{ padding: '8px 20px 10px' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                              {ps.length} player{ps.length !== 1 ? 's' : ''} needing {sz} {ki.label}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                              {ps.map(p => (
                                <span key={p.id} style={{ fontSize: 12, color: '#0b1220' }}>
                                  {p.jersey_number ? <b>#{p.jersey_number}</b> : null}
                                  {p.jersey_number ? ' ' : ''}{[p.first_name, p.last_name].filter(Boolean).join(' ') || '—'}
                                  <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 4 }}>({teamMap[p.team_id] || 'Unknown team'})</span>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
                  <td colSpan={2} style={{ padding: '6px 14px', fontWeight: 800, fontSize: 12, color: '#64748b', textAlign: 'right' }}>
                    Total: {totalUnits} units
                  </td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ─── Staff: Session Detail ────────────────────────────────────────────────────
function SessionDetail({ session, customer, onBack }) {
  const [teams, setTeams] = useState([]);
  const [kitTemplate, setKitTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [addingTeam, setAddingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [view, setView] = useState('teams'); // teams | totals
  const [openTeam, setOpenTeam] = useState(null);
  const [inviteForm, setInviteForm] = useState({}); // { teamId: {email, name, sending} }
  const [coachAccounts, setCoachAccounts] = useState({});

  useEffect(() => {
    if (!session?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: ts }, { data: kt }] = await Promise.all([
        supabase.from('roster_teams').select('*').eq('session_id', session.id).order('sort_order').order('created_at'),
        session.kit_template_id
          ? supabase.from('roster_kit_templates').select('*').eq('id', session.kit_template_id).single()
          : { data: null },
      ]);
      if (cancelled) return;
      const teamList = ts || [];
      setTeams(teamList);
      setKitTemplate(kt);
      // Load coach assignments
      if (teamList.length) {
        const { data: tc } = await supabase.from('roster_team_coaches')
          .select('team_id, coach_id, role, coach_accounts(email, name)')
          .in('team_id', teamList.map(t => t.id));
        if (!cancelled) {
          const cmap = {};
          (tc || []).forEach(r => {
            if (!cmap[r.team_id]) cmap[r.team_id] = [];
            cmap[r.team_id].push({ ...r.coach_accounts, role: r.role, id: r.coach_id });
          });
          setCoachAccounts(cmap);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [session?.id]);

  const addTeam = async () => {
    if (!newTeamName.trim()) return;
    setAddingTeam(true);
    const { data, error } = await supabase.from('roster_teams').insert({
      session_id: session.id, name: newTeamName.trim(), sort_order: teams.length,
    }).select().single();
    setAddingTeam(false);
    if (!error && data) { setTeams(prev => [...prev, data]); setNewTeamName(''); }
  };

  const deleteTeam = async (id) => {
    if (!window.confirm('Delete this team and all its roster data?')) return;
    await supabase.from('roster_teams').delete().eq('id', id);
    setTeams(prev => prev.filter(t => t.id !== id));
    if (openTeam?.id === id) setOpenTeam(null);
  };

  const inviteCoach = async (teamId) => {
    const f = inviteForm[teamId] || {};
    const email = (f.email || '').trim();
    const name = (f.name || '').trim();
    if (!email) return;
    setInviteForm(prev => ({ ...prev, [teamId]: { ...prev[teamId], sending: true } }));
    try {
      // Ensure coach_account exists
      const { data: existing } = await supabase.from('coach_accounts').select('id').eq('email', email).maybeSingle();
      let coachId = existing?.id;
      if (!coachId) {
        const { data: created } = await supabase.from('coach_accounts')
          .insert({ email, name: name || email, customer_id: customer.id }).select('id').single();
        coachId = created?.id;
      }
      if (coachId) {
        const team = teams.find(t => t.id === teamId);
        await supabase.from('roster_team_coaches').upsert(
          { team_id: teamId, coach_id: coachId, role: 'editor' },
          { onConflict: 'team_id,coach_id' }
        );
        // Send invite email (reuse existing function)
        await fetch('/.netlify/functions/coach-invite', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, name: name || email, team: `${team?.name || ''} — ${session.name}` }),
        });
        setCoachAccounts(prev => ({
          ...prev, [teamId]: [...(prev[teamId] || []).filter(c => c.email !== email), { email, name, role: 'editor', id: coachId }],
        }));
        setInviteForm(prev => ({ ...prev, [teamId]: { email: '', name: '', sending: false } }));
      }
    } catch (e) {
      console.error(e);
      setInviteForm(prev => ({ ...prev, [teamId]: { ...prev[teamId], sending: false } }));
    }
  };

  if (loading) return <div style={{ padding: 24, color: '#64748b' }}>Loading session…</div>;

  return (
    <div>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', fontWeight: 700, fontSize: 13, padding: 0 }}>← Back</button>
        <div>
          <div style={{ fontWeight: 900, fontSize: 17, color: '#0b1220' }}>{session.name}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {session.season && <span>{session.season} · </span>}
            {teams.length} team{teams.length !== 1 ? 's' : ''}
            {session.deadline && <span> · Deadline: {session.deadline}</span>}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={() => setView('teams')}
            style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #e2e8f0', fontWeight: 700, fontSize: 12, cursor: 'pointer',
              background: view === 'teams' ? '#0b1220' : '#fff', color: view === 'teams' ? '#fff' : '#374151' }}>
            Teams
          </button>
          <button onClick={() => setView('totals')}
            style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #e2e8f0', fontWeight: 700, fontSize: 12, cursor: 'pointer',
              background: view === 'totals' ? '#0b1220' : '#fff', color: view === 'totals' ? '#fff' : '#374151' }}>
            Totals / Buy-Sheet
          </button>
        </div>
      </div>

      {view === 'totals' && (
        <RosterTotals session={session} teams={teams} kitTemplate={kitTemplate} />
      )}

      {view === 'teams' && (
        <>
          {/* Teams list */}
          {teams.map(team => (
            <div key={team.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ background: '#f8fafc', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                onClick={() => setOpenTeam(openTeam?.id === team.id ? null : team)}>
                <span style={{ transform: openTeam?.id === team.id ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s', fontSize: 10, color: '#64748b' }}>▶</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#0b1220' }}>{team.name}</span>
                {team.locked && <span style={{ background: '#dcfce7', color: '#15803d', borderRadius: 999, padding: '1px 8px', fontSize: 10, fontWeight: 700 }}>LOCKED</span>}
                {(coachAccounts[team.id] || []).length > 0 && (
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    {(coachAccounts[team.id] || []).map(c => c.name || c.email).join(', ')}
                  </span>
                )}
                <button onClick={e => { e.stopPropagation(); deleteTeam(team.id); }}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: 15, padding: '0 4px' }}>×</button>
              </div>
              {openTeam?.id === team.id && (
                <div style={{ padding: 16, borderTop: '1px solid #f1f5f9' }}>
                  <TeamRosterEditor team={team} kitTemplate={kitTemplate} readOnly={false} />
                  {/* Invite coach */}
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Invite coach to this team</div>
                    {(coachAccounts[team.id] || []).map(c => (
                      <div key={c.id || c.email} style={{ fontSize: 12, color: '#0b1220', marginBottom: 4 }}>
                        👤 {c.name || c.email} <span style={{ color: '#94a3b8' }}>({c.email})</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <input placeholder="Coach email" value={(inviteForm[team.id] || {}).email || ''}
                        onChange={e => setInviteForm(prev => ({ ...prev, [team.id]: { ...(prev[team.id] || {}), email: e.target.value } }))}
                        style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, width: 200 }} />
                      <input placeholder="Coach name" value={(inviteForm[team.id] || {}).name || ''}
                        onChange={e => setInviteForm(prev => ({ ...prev, [team.id]: { ...(prev[team.id] || {}), name: e.target.value } }))}
                        style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, width: 160 }} />
                      <button onClick={() => inviteCoach(team.id)} disabled={(inviteForm[team.id] || {}).sending || !(inviteForm[team.id] || {}).email}
                        style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                        {(inviteForm[team.id] || {}).sending ? 'Sending…' : 'Invite & email'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Add team */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={newTeamName} placeholder="Add team name (e.g. GU9 Premier Schiefer R)"
              onChange={e => setNewTeamName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTeam()}
              style={{ flex: 1, padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
            <button onClick={addTeam} disabled={addingTeam || !newTeamName.trim()}
              style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              {addingTeam ? '…' : '+ Team'}
            </button>
          </div>
          {!kitTemplate && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12.5, color: '#92400e' }}>
              ⚠️ No kit template configured for this session — coaches can add players but size columns won't appear until a kit template is assigned.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Staff: create session form ───────────────────────────────────────────────
function CreateSessionModal({ customer, onCreated, onClose }) {
  const [form, setForm] = useState({ name: '', season: new Date().getFullYear().toString(), deadline: '', notes: '' });
  const [kitItems, setKitItems] = useState([
    { slot: 'jersey_white', label: 'Jersey (White)', takes_number: true, qty: 1, product_id: '' },
    { slot: 'jersey_navy', label: 'Jersey (Navy)', takes_number: true, qty: 1, product_id: '' },
    { slot: 'shorts', label: 'Shorts', qty: 2, product_id: '' },
    { slot: 'training_shirt', label: 'Training Shirt', qty: 2, product_id: '' },
    { slot: 'game_day_shirt', label: 'Game Day Shirt', takes_number: true, qty: 1, product_id: '' },
    { slot: 'socks', label: 'Socks', qty: 2, product_id: '', sock: true },
    { slot: 'jacket', label: 'Jacket', optional: true, product_id: '' },
    { slot: 'pants', label: 'Pants', optional: true, product_id: '' },
    { slot: 'backpack', label: 'Backpack', optional: true, product_id: '' },
    { slot: 'keeper_jersey', label: 'Keeper Jersey', gk_only: true, optional: true, product_id: '' },
    { slot: 'keeper_shorts', label: 'Keeper Shorts', gk_only: true, optional: true, product_id: '' },
    { slot: 'keeper_socks', label: 'Keeper Socks', gk_only: true, optional: true, product_id: '', sock: true },
  ]);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      // Save kit template
      const { data: kt, error: kte } = await supabase.from('roster_kit_templates').insert({
        customer_id: customer.id, name: form.name.trim() + ' Kit', items: kitItems,
      }).select().single();
      if (kte) throw kte;
      // Save session
      const { data: sess, error: se } = await supabase.from('roster_order_sessions').insert({
        customer_id: customer.id, kit_template_id: kt.id,
        name: form.name.trim(), season: form.season, deadline: form.deadline || null,
        notes: form.notes, status: 'open',
      }).select().single();
      if (se) throw se;
      onCreated(sess);
    } catch (e) { console.error(e); setSaving(false); }
  };

  const updateItem = (idx, field, val) => {
    setKitItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 40, overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 700, margin: '0 16px 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0b1220' }}>New Roster Order Session</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          {[['name', 'Session name', 'e.g. Younger Girls 2026', '1 / -1'],
            ['season', 'Season', 'e.g. 2026', undefined],
            ['deadline', 'Deadline (coaches lock by)', undefined, undefined, 'date'],
            ['notes', 'Notes', undefined, undefined]].map(([field, label, placeholder, gridCol, type]) => (
            <div key={field} style={{ gridColumn: gridCol }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>{label}</label>
              <input type={type || 'text'} value={form[field]} placeholder={placeholder}
                onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Kit items</div>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Label','Slot key','Product ID (optional)','Qty','#?','GK only'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748b' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kitItems.map((ki, idx) => (
                <tr key={ki.slot} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '4px 6px' }}>
                    <input value={ki.label} onChange={e => updateItem(idx, 'label', e.target.value)}
                      style={{ border: 'none', fontSize: 12, width: '100%', outline: 'none' }} />
                  </td>
                  <td style={{ padding: '4px 6px', fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>{ki.slot}</td>
                  <td style={{ padding: '4px 6px' }}>
                    <input value={ki.product_id} placeholder="paste product ID"
                      onChange={e => updateItem(idx, 'product_id', e.target.value)}
                      style={{ border: 'none', fontSize: 11, width: '100%', outline: 'none', fontFamily: 'monospace', color: '#1e40af' }} />
                  </td>
                  <td style={{ padding: '4px 6px', width: 36, textAlign: 'center' }}>
                    <input type="number" min={1} max={9} value={ki.qty || 1} onChange={e => updateItem(idx, 'qty', parseInt(e.target.value) || 1)}
                      style={{ width: 36, textAlign: 'center', border: 'none', fontSize: 12, outline: 'none' }} />
                  </td>
                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                    <input type="checkbox" checked={!!ki.takes_number} onChange={e => updateItem(idx, 'takes_number', e.target.checked)} />
                  </td>
                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                    <input type="checkbox" checked={!!ki.gk_only} onChange={e => updateItem(idx, 'gk_only', e.target.checked)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 20px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving || !form.name.trim()}
            style={{ padding: '8px 24px', border: 'none', borderRadius: 8, background: '#0b1220', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            {saving ? 'Creating…' : 'Create session'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Staff: exported component (embeds in CustDetail roster tab) ──────────────
export function RosterOrdersStaff({ customer, nf }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [openSession, setOpenSession] = useState(null);

  useEffect(() => {
    if (!customer?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('roster_order_sessions').select('*')
        .eq('customer_id', customer.id).order('created_at', { ascending: false });
      if (!cancelled) { setSessions(data || []); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [customer?.id]);

  const onCreated = (sess) => {
    setSessions(prev => [sess, ...prev]);
    setShowCreate(false);
    setOpenSession(sess);
  };

  if (openSession) {
    return (
      <div style={{ padding: 20 }}>
        <SessionDetail session={openSession} customer={customer} onBack={() => setOpenSession(null)} />
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 16, color: '#0b1220' }}>Roster Orders</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Season-by-season kit ordering for {customer.name}</div>
        </div>
        <button onClick={() => setShowCreate(true)}
          style={{ padding: '8px 18px', borderRadius: 9, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
          + New session
        </button>
      </div>
      {loading ? (
        <div style={{ color: '#64748b', fontSize: 13 }}>Loading…</div>
      ) : sessions.length === 0 ? (
        <div style={{ padding: '32px 20px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 12 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
          <div style={{ fontWeight: 700, color: '#374151', marginBottom: 6 }}>No roster order sessions yet</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Create a session to replace the Google Sheet workflow — coaches fill in player sizes, you see live totals vs. inventory.</div>
          <button onClick={() => setShowCreate(true)}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Create first session
          </button>
        </div>
      ) : (
        <div>
          {sessions.map(sess => (
            <div key={sess.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 10, cursor: 'pointer' }}
              onClick={() => setOpenSession(sess)}>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#0b1220' }}>{sess.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {sess.season && `${sess.season} · `}
                    Created {new Date(sess.created_at).toLocaleDateString()}
                    {sess.deadline && ` · Deadline: ${sess.deadline}`}
                  </div>
                </div>
                <span style={{ background: '#f1f5f9', color: STATUS_COLORS[sess.status] || '#64748b', borderRadius: 999, padding: '3px 12px', fontSize: 11, fontWeight: 700 }}>
                  {STATUS_LABELS[sess.status] || sess.status}
                </span>
                <span style={{ color: '#94a3b8', fontSize: 16 }}>›</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {showCreate && <CreateSessionModal customer={customer} onCreated={onCreated} onClose={() => setShowCreate(false)} />}
    </div>
  );
}

// ─── Coach: exported component (embeds in CoachPortal) ───────────────────────
export function RosterOrdersCoach({ customer }) {
  const [teams, setTeams] = useState([]);
  const [sessions, setSessions] = useState({});
  const [kitTemplates, setKitTemplates] = useState({});
  const [loading, setLoading] = useState(true);
  const [coachId, setCoachId] = useState(null);
  const [openTeam, setOpenTeam] = useState(null);
  const [viewTotals, setViewTotals] = useState(null); // session if viewing totals

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Identify the coach from auth session
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) { setLoading(false); return; }
      const { data: coach } = await supabase.from('coach_accounts').select('id').eq('email', user.email).maybeSingle();
      if (!coach?.id || cancelled) { setLoading(false); return; }
      setCoachId(coach.id);

      // Get their team assignments
      const { data: tc } = await supabase.from('roster_team_coaches').select('team_id, role').eq('coach_id', coach.id);
      if (!tc?.length || cancelled) { setLoading(false); return; }
      const teamIds = tc.map(r => r.team_id);

      // Get teams (filter by customer for this portal session)
      const { data: ts } = await supabase.from('roster_teams').select('*').in('id', teamIds);
      const teamList = ts || [];

      // Get sessions & kit templates for those teams
      const sessionIds = [...new Set(teamList.map(t => t.session_id))];
      const { data: ss } = await supabase.from('roster_order_sessions').select('*')
        .in('id', sessionIds).eq('customer_id', customer.id).neq('status', 'draft');
      const sessMap = {};
      (ss || []).forEach(s => { sessMap[s.id] = s; });

      const ktIds = [...new Set((ss || []).map(s => s.kit_template_id).filter(Boolean))];
      let ktMap = {};
      if (ktIds.length) {
        const { data: kts } = await supabase.from('roster_kit_templates').select('*').in('id', ktIds);
        (kts || []).forEach(kt => { ktMap[kt.id] = kt; });
      }

      if (!cancelled) {
        // Only show teams from sessions that belong to this customer
        const filteredTeams = teamList.filter(t => sessMap[t.session_id]);
        setTeams(filteredTeams);
        setSessions(sessMap);
        setKitTemplates(ktMap);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [customer?.id]);

  if (loading) return null;
  if (!teams.length) return null;

  const sessionTeams = {};
  teams.forEach(t => {
    const s = sessions[t.session_id];
    if (!s) return;
    if (!sessionTeams[s.id]) sessionTeams[s.id] = { session: s, teams: [] };
    sessionTeams[s.id].teams.push(t);
  });

  if (viewTotals) {
    const { session, teams: sessTeams } = viewTotals;
    const kt = kitTemplates[session.kit_template_id];
    return (
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ background: '#0b1f3a', color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800 }}>📋 {session.name}</span>
          <button onClick={() => setViewTotals(null)}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid rgba(255,255,255,.3)', color: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
            ← Back to teams
          </button>
        </div>
        <div style={{ padding: 16 }}>
          <RosterTotals session={session} teams={sessTeams} kitTemplate={kt} />
        </div>
      </div>
    );
  }

  if (openTeam) {
    const sess = sessions[openTeam.session_id];
    const kt = sess ? kitTemplates[sess.kit_template_id] : null;
    return (
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ background: '#0b1f3a', color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800 }}>📋 {sess?.name}</span>
          <span style={{ opacity: 0.7, fontSize: 13 }}>· {openTeam.name}</span>
          <button onClick={() => setOpenTeam(null)}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid rgba(255,255,255,.3)', color: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
            ← All teams
          </button>
        </div>
        <div style={{ padding: 16 }}>
          <TeamRosterEditor team={openTeam} kitTemplate={kt} readOnly={false} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {Object.values(sessionTeams).map(({ session, teams: sessTeams }) => (
        <div key={session.id} style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ background: '#0b1f3a', color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span style={{ fontWeight: 800 }}>📋 {session.name}</span>
              {session.deadline && <span style={{ marginLeft: 10, fontSize: 11, opacity: 0.7 }}>Deadline: {session.deadline}</span>}
            </div>
            <button onClick={() => setViewTotals({ session, teams: sessTeams })}
              style={{ background: 'none', border: '1px solid rgba(255,255,255,.3)', color: '#fff', borderRadius: 6, padding: '4px 12px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
              View totals
            </button>
          </div>
          <div style={{ padding: 12 }}>
            {sessTeams.map(team => (
              <div key={team.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, marginBottom: 6,
                background: '#f8fafc', border: '1px solid #f1f5f9', cursor: 'pointer' }}
                onClick={() => setOpenTeam(team)}>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#0b1220', flex: 1 }}>{team.name}</span>
                {team.locked
                  ? <span style={{ background: '#dcfce7', color: '#15803d', borderRadius: 999, padding: '2px 9px', fontSize: 10, fontWeight: 700 }}>LOCKED ✓</span>
                  : <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '2px 9px', fontSize: 10, fontWeight: 700 }}>In progress</span>}
                <span style={{ color: '#94a3b8', fontSize: 14 }}>›</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
