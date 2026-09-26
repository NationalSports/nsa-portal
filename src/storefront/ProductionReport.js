import React, { useEffect, useMemo, useState } from 'react';
import { buildProductionReport } from '../lib/webstoreProductionReport';
import './ProductionReport.css';

const endpoint = '/.netlify/functions/webstore-production-report';
const label = (d) => d.kind === 'art'
  ? [d.art_name || d.name || 'Artwork', d.type || d.deco_type, d.position || d.placement].filter(Boolean).join(' · ')
  : [d.kind || 'Personalization', d.position || d.placement, d.type || d.num_method].filter(Boolean).join(' · ');
const unitCount = (items) => items.reduce((n, i) => n + (Number(i.qty) || 0), 0);

export default function ProductionReport() {
  const token = window.location.pathname.split('/').filter(Boolean).pop();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [tab, setTab] = useState('overview');
  const load = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', token }), cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.data) throw new Error(json.error || 'Could not open report');
      setData(json.data);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [token]);
  const report = useMemo(() => data && buildProductionReport(data), [data]);
  const store = data?.store || {};
  const batchIds = [...new Set(report?.production.map((i) => i.so_id) || [])];
  const batchName = (id) => {
    const so = (data?.salesOrders || []).find((s) => s.id === id);
    return so?.webstore_batch_no ? `Batch ${so.webstore_batch_no} · ${id}` : id;
  };
  const artById = Object.fromEntries((data?.art || []).map((a) => [a.id, a]));
  const artwork = (data?.art || []).filter((a) => a.preview_url || (a.mockup_files || []).length || Object.values(a.item_mockups || {}).flat().length || a.files?.length);
  const tabs = [['overview', 'Overview'], ['garments', 'Garments & quantities'], ['decoration', 'Decoration & mocks'], ['players', 'Player report']];
  const qty = (n) => <strong className="pr-qty">{n}</strong>;
  const productionTable = (items) => <table className="pr-table"><thead><tr><th>Garment</th><th>SKU / color</th><th>Size curve</th><th>Units</th></tr></thead><tbody>
    {items.map((i) => <tr key={i.id}><td><div className="pr-product">{i.image && <img src={i.image} alt="" />}<b>{i.name || i.sku || 'Garment'}</b></div></td><td>{i.sku || '—'}<small>{i.color}</small></td><td><div className="pr-sizes">{Object.entries(i.sizes || {}).filter(([s, n]) => !/^(drop_ship|unit_cost|_)/i.test(s) && Number(n) > 0).map(([s, n]) => <span key={s}>{s} <b>{n}</b></span>)}</div></td><td>{qty(i.units)}</td></tr>)}
  </tbody></table>;
  if (busy && !data) return <div className="pr-loading">Loading production report…</div>;
  if (error && !data) return <div className="pr-loading"><h2>Report unavailable</h2><p>{error}</p><button onClick={load}>Retry</button></div>;
  return <div className="pr-page" style={{ '--pr-primary': /^#[0-9a-f]{6}$/i.test(store.primary_color || '') ? store.primary_color : '#142b50' }}>
    <header className="pr-hero"><div className="pr-shell"><div className="pr-top"><span>NATIONAL SPORTS APPAREL / PRODUCTION</span><div className="pr-actions"><button onClick={load} disabled={busy}>↻ Refresh</button><button onClick={() => window.print()}>↓ Print / Save PDF</button></div></div>
      <div className="pr-brand">{store.logo_url && <img src={store.logo_url} alt="" />}<div><p>STORE PRODUCTION PACKET</p><h1>{store.name}</h1><span>Live production record · updated {new Date(data.fetchedAt).toLocaleString()}</span></div></div>
      <div className="pr-stats"><div><b>{report.orders.length}</b><span>Orders</span></div><div><b>{report.productionUnits}</b><span>SO garment units</span></div><div><b>{report.players.length}</b><span>Player groups</span></div><div><b>{batchIds.length}</b><span>Production batches</span></div></div>
    </div></header>
    <main className="pr-shell">
      <nav className="pr-tabs" aria-label="Report sections">{tabs.map(([id, name]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{name}</button>)}</nav>
      {error && <div className="pr-alert">Refresh failed: {error}. Displaying the previous snapshot.</div>}
      {!!report.problems.length && <div className="pr-alert"><b>Needs reconciliation before production</b><ul>{report.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
      {!!report.unbatched.length && <div className="pr-alert">{report.unbatched.length} player line{report.unbatched.length === 1 ? '' : 's'} ({unitCount(report.unbatched)} units) have not been assigned to a production SO. They appear in the player report but are outside the SO garment totals.</div>}
      {Object.entries(report.unassignedBySo).map(([id, count]) => <div className="pr-alert" key={id}>{batchName(id)} has {count} SO garment unit{count === 1 ? '' : 's'} beyond its assigned player lines. Check whether these are intentional extras before decorating.</div>)}
      <section className={tab === 'overview' ? '' : 'pr-hidden'}><h2>Production at a glance</h2><p className="pr-intro">Current sales order quantities and decoration instructions. Open the other sections for garment size curves, artwork, and each player's items.</p>
        {batchIds.length ? batchIds.map((id) => <article className="pr-card" key={id}><div className="pr-card-head"><h3>{batchName(id)}</h3><b>{report.production.filter((i) => i.so_id === id).reduce((n, i) => n + i.units, 0)} units</b></div><div className="pr-summary">{report.production.filter((i) => i.so_id === id).map((i) => <div key={i.id}><span>{i.name || i.sku} <small>{i.sku} · {i.color}</small></span><b>{i.units}</b></div>)}</div></article>) : <div className="pr-empty">No production sales orders yet.</div>}
      </section>
      <section className={tab === 'garments' ? '' : 'pr-hidden'}><h2>Garments & quantities</h2><p className="pr-intro">These size curves come directly from the current production sales orders and reflect subsequent SKU and quantity edits.</p>
        {batchIds.map((id) => <article className="pr-card" key={id}><div className="pr-card-head"><h3>{batchName(id)}</h3></div>{productionTable(report.production.filter((i) => i.so_id === id))}</article>)}
        {!batchIds.length && <div className="pr-empty">No production sales orders yet.</div>}
      </section>
      <section className={tab === 'decoration' ? '' : 'pr-hidden'}><h2>Decoration & production mocks</h2><p className="pr-intro">Decoration instructions are attached to each current SO garment. Artwork shown below is attached to this store's production batches.</p>
        {report.production.map((i) => <article className="pr-card" key={i.id}><div className="pr-card-head"><div><small>{batchName(i.so_id)}</small><h3>{i.name || i.sku} · {i.color || 'Color unspecified'}</h3><small>{i.sku} · {i.units} units</small></div>{i.image && <img className="pr-garment-mock" src={i.image} alt={`${i.name || i.sku} garment preview`} />}</div>
          {i.decorations.length ? <ul className="pr-decos">{i.decorations.map((d, index) => { const art = artById[d.art_file_id]; return <li key={index}><b>{d.kind === 'art' ? (art?.name || 'Artwork') : (d.kind || 'Personalization')}</b><span>{label(d)}</span>{art?.preview_url && <img src={art.preview_url} alt={art.name || 'Artwork'} />}</li>; })}</ul> : <p className="pr-muted">No decoration recorded on this SO garment.</p>}
        </article>)}
        <h2>Production art & mocks</h2><div className="pr-art-grid">{artwork.map((a, i) => { const image = Object.values(a.item_mockups || {}).flat()[0] || a.mockup_files?.[0] || a.preview_url; return <article className="pr-card" key={a.id + i}>{image && <img src={typeof image === 'string' ? image : image.url} alt={a.name || 'Production art'} />}<b>{a.name || 'Artwork'}</b><small>{batchName(a.so_id)}</small>{a.files?.length > 0 && <div className="pr-files">{a.files.map((f, j) => { const href = typeof f === 'string' ? f : f.url; return href && <a key={j} href={href} target="_blank" rel="noopener noreferrer">↗ {typeof f === 'string' ? 'Production file' : (f.name || 'Production file')}</a>; })}</div>}</article>; })}</div>
        {!artwork.length && <div className="pr-empty">No production mocks attached to these batches.</div>}
      </section>
      <section className={tab === 'players' ? '' : 'pr-hidden'}><h2>Player report</h2><p className="pr-intro">Active order lines reconciled to their linked sales orders. SKU and size substitutions appear on each affected line.</p>
        {report.players.map((p, idx) => <article className="pr-card pr-player" key={idx}><div className="pr-card-head"><div><h3>{p.name}{p.number && <span className="pr-number"> #{p.number}</span>}</h3><small>{p.soId ? batchName(p.soId) : 'Not yet batched'} · Order {p.orders.join(', ')}</small></div><b>{p.units} units</b></div><table className="pr-table"><thead><tr><th>Garment</th><th>SKU / color</th><th>Size</th><th>Qty</th></tr></thead><tbody>{p.lines.map((l, i) => <tr key={i}><td>{l.name || l.sku || 'Garment'}{(l._wasSku || l._wasSize || l._verify || l._unmatched) && <small className="pr-change">{l._wasSku && `Was SKU ${l._wasSku} · `}{l._wasSize && `Was size ${l._wasSize} · `}{(l._verify || l._unmatched) && 'Verify mapping'}</small>}</td><td>{l._effSku || l.sku || '—'}<small>{l.color}</small></td><td>{l.size || 'OS'}</td><td>{qty(l.qty)}</td></tr>)}</tbody></table></article>)}
        {!report.players.length && <div className="pr-empty">No player orders yet.</div>}
      </section>
      <footer>National Sports Apparel · Production reference · Refresh before starting work. A saved PDF is a snapshot from its print date.</footer>
    </main>
  </div>;
}
