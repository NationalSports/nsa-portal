import React, { useState, useMemo, useCallback, useRef } from 'react';
import './styles/portal.css';

// ─── ICONS (inline SVGs to avoid dependency issues) ───────────
const Icon = ({ name, size = 18 }) => {
  const icons = {
    home: <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,
    users: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,
    building: <><path d="M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18z"/><path d="M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2"/><path d="M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/></>,
    package: <><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>,
    box: <><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></>,
    search: <><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    edit: <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    upload: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
    x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    chevron: <polyline points="9 18 15 12 9 6"/>,
    dollar: <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>,
    grid: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
    warehouse: <><path d="M22 8.35V20a2 2 0 01-2 2H4a2 2 0 01-2-2V8.35A2 2 0 013.26 6.5l8-3.2a2 2 0 011.48 0l8 3.2A2 2 0 0122 8.35z"/><path d="M6 18h12M6 14h12"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>;
};

// ─── DEMO DATA ────────────────────────────────────────────────
const DEMO_CUSTOMERS = [
  { id: 'c1', parent_id: null, name: 'Orange Lutheran High School', alpha_tag: 'OLu', contact_name: 'Athletic Director', contact_email: 'athletics@orangelutheran.org', contact_phone: '714-555-0100', billing_city: 'Orange', billing_state: 'CA', billing_zip: '92867', shipping_city: 'Orange', shipping_state: 'CA', pricing_tier: 'A', tax_rate: 0.0775, is_active: true },
  { id: 'c1a', parent_id: 'c1', name: 'OLu Baseball', alpha_tag: 'OLuB', contact_name: 'Coach Martinez', contact_email: 'martinez@orangelutheran.org', contact_phone: '714-555-0101', shipping_city: 'Orange', shipping_state: 'CA', pricing_tier: 'A', is_active: true },
  { id: 'c1b', parent_id: 'c1', name: 'OLu Football', alpha_tag: 'OLuF', contact_name: 'Coach Davis', contact_email: 'davis@orangelutheran.org', shipping_city: 'Orange', shipping_state: 'CA', pricing_tier: 'A', is_active: true },
  { id: 'c1c', parent_id: 'c1', name: 'OLu Track & Field', alpha_tag: 'OLuT', contact_name: 'Coach Chen', contact_email: 'chen@orangelutheran.org', shipping_city: 'Orange', shipping_state: 'CA', pricing_tier: 'A', is_active: true },
  { id: 'c2', parent_id: null, name: 'St. Francis High School', alpha_tag: 'SF', contact_name: 'AD Office', contact_email: 'ad@stfrancis.edu', billing_city: 'La Cañada', billing_state: 'CA', shipping_city: 'La Cañada', shipping_state: 'CA', pricing_tier: 'B', tax_rate: 0.0950, is_active: true },
  { id: 'c2a', parent_id: 'c2', name: 'St. Francis Lacrosse', alpha_tag: 'SFL', contact_name: 'Coach Resch', contact_email: 'resch@stfrancis.edu', shipping_city: 'La Cañada', shipping_state: 'CA', pricing_tier: 'B', is_active: true },
  { id: 'c3', parent_id: null, name: 'Clovis Unified School District', alpha_tag: 'CUSD', contact_name: 'District Office', billing_city: 'Clovis', billing_state: 'CA', pricing_tier: 'B', tax_rate: 0.0863, is_active: true },
  { id: 'c3a', parent_id: 'c3', name: 'Clovis High Badminton', alpha_tag: 'CHBad', contact_name: 'Coach Kim', shipping_city: 'Clovis', shipping_state: 'CA', pricing_tier: 'B', is_active: true },
];

const DEMO_VENDORS = [
  { id: 'v1', name: 'Adidas', vendor_type: 'upload', nsa_carries_inventory: true, click_automation: true, invoice_scan_enabled: true, is_active: true },
  { id: 'v2', name: 'Under Armour', vendor_type: 'upload', nsa_carries_inventory: true, click_automation: false, invoice_scan_enabled: true, is_active: true },
  { id: 'v3', name: 'SanMar', vendor_type: 'api', api_provider: 'sanmar', nsa_carries_inventory: false, is_active: true },
  { id: 'v4', name: 'S&S Activewear', vendor_type: 'api', api_provider: 'ss_activewear', nsa_carries_inventory: false, is_active: true },
  { id: 'v5', name: 'Richardson', vendor_type: 'upload', nsa_carries_inventory: false, is_active: true },
  { id: 'v6', name: 'Rawlings', vendor_type: 'upload', nsa_carries_inventory: false, is_active: true },
  { id: 'v7', name: 'Badger', vendor_type: 'upload', nsa_carries_inventory: false, is_active: true },
];

const DEMO_PRODUCTS = [
  { id: 'p1', vendor_id: 'v1', sku: 'JX4453', name: 'Adidas Unisex Pregame Tee', brand: 'Adidas', color: 'Team Power Red/White', category: 'Tees', retail_price: 55.50, nsa_cost: 18.50, available_sizes: ['XS','S','M','L','XL','2XL'], is_active: true,
    _inv: { XS: 0, S: 12, M: 8, L: 5, XL: 3, '2XL': 0 }, _click: { XS: 45, S: 120, M: 89, L: 67, XL: 34, '2XL': 18 } },
  { id: 'p2', vendor_id: 'v1', sku: 'HF7245', name: 'Adidas Team Issue Hoodie', brand: 'Adidas', color: 'Team Power Red/White', category: 'Hoodies', retail_price: 85.00, nsa_cost: 28.50, available_sizes: ['S','M','L','XL','2XL'], is_active: true,
    _inv: { S: 3, M: 6, L: 4, XL: 2, '2XL': 0 }, _click: { S: 55, M: 78, L: 92, XL: 41, '2XL': 22 } },
  { id: 'p3', vendor_id: 'v1', sku: 'JR9291', name: 'Adidas Dropset Control Trainer', brand: 'Adidas', color: 'Grey Two/FTW White', category: 'Footwear', retail_price: 120.00, nsa_cost: 37.12, available_sizes: ['12','13','14','15'], is_active: true,
    _inv: { '12': 10, '13': 4, '14': 1, '15': 1 }, _click: {} },
  { id: 'p4', vendor_id: 'v2', sku: '1370399', name: 'Under Armour Team Polo', brand: 'Under Armour', color: 'Cardinal/White', category: 'Polos', retail_price: 65.00, nsa_cost: 22.00, available_sizes: ['S','M','L','XL','2XL'], is_active: true,
    _inv: { S: 0, M: 10, L: 15, XL: 12, '2XL': 8 }, _click: {} },
  { id: 'p5', vendor_id: 'v3', sku: 'PC61', name: 'Port & Company Essential Tee', brand: 'Port & Company', color: 'Jet Black', category: 'Tees', retail_price: 8.98, nsa_cost: 2.85, available_sizes: ['S','M','L','XL','2XL','3XL'], is_active: true,
    _inv: { S: 20, M: 15, L: 10, XL: 5, '2XL': 0, '3XL': 0 }, _sanmar: { S: 4521, M: 3890, L: 5102, XL: 2847, '2XL': 1203, '3XL': 445 } },
  { id: 'p6', vendor_id: 'v3', sku: 'K500', name: 'Port Authority Silk Touch Polo', brand: 'Port Authority', color: 'Navy', category: 'Polos', retail_price: 22.98, nsa_cost: 8.20, available_sizes: ['XS','S','M','L','XL','2XL','3XL','4XL'], is_active: true,
    _inv: { XS: 0, S: 0, M: 0, L: 0, XL: 0, '2XL': 0, '3XL': 0, '4XL': 0 }, _sanmar: { XS: 890, S: 3200, M: 4100, L: 5600, XL: 3800, '2XL': 2100, '3XL': 890, '4XL': 320 } },
  { id: 'p7', vendor_id: 'v5', sku: '112', name: 'Richardson Trucker Cap', brand: 'Richardson', color: 'Black/White', category: 'Hats', retail_price: 12.00, nsa_cost: 4.50, available_sizes: ['OSFA'], is_active: true,
    _inv: { OSFA: 50 } },
];

// ─── TOAST COMPONENT ──────────────────────────────────────────
function Toast({ message, type = 'success' }) {
  if (!message) return null;
  return <div className={`toast toast-${type}`}>{message}</div>;
}

// ─── CSV IMPORT MODAL ─────────────────────────────────────────
function CsvImportModal({ isOpen, onClose, onImport, type, fields }) {
  const [data, setData] = useState(null);
  const [raw, setRaw] = useState('');
  const fileRef = useRef();

  const parseCSV = (text) => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
      return obj;
    });
    return { headers, rows };
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      setRaw(text);
      setData(parseCSV(text));
    };
    reader.readAsText(file);
  };

  if (!isOpen) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 800 }}>
        <div className="modal-header">
          <h2>Import {type} from CSV</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            Expected columns: <strong>{fields.join(', ')}</strong>
          </p>
          <div className="csv-dropzone" onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: 'none' }} />
            <Icon name="upload" size={24} />
            <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: '#334155' }}>Click to upload CSV</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>or drag and drop</div>
          </div>
          {data && (
            <div className="csv-preview">
              <div style={{ fontSize: 12, fontWeight: 600, margin: '12px 0 6px', color: '#166534' }}>
                ✓ {data.rows.length} rows found
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr>{data.headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>{data.headers.map(h => <td key={h}>{row[h]}</td>)}</tr>
                    ))}
                    {data.rows.length > 5 && <tr><td colSpan={data.headers.length} style={{ textAlign: 'center', color: '#94a3b8' }}>... and {data.rows.length - 5} more rows</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-success" disabled={!data} onClick={() => { onImport(data.rows); onClose(); setData(null); }}>
            Import {data ? data.rows.length : 0} {type}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CUSTOMER FORM MODAL ──────────────────────────────────────
function CustomerModal({ isOpen, onClose, onSave, customer, parents }) {
  const [form, setForm] = useState(customer || { parent_id: null, name: '', alpha_tag: '', contact_name: '', contact_email: '', contact_phone: '', billing_address_line1: '', billing_city: '', billing_state: '', billing_zip: '', shipping_address_line1: '', shipping_city: '', shipping_state: '', shipping_zip: '', pricing_tier: 'B', notes: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  React.useEffect(() => { setForm(customer || { parent_id: null, name: '', alpha_tag: '', contact_name: '', contact_email: '', contact_phone: '', billing_address_line1: '', billing_city: '', billing_state: '', billing_zip: '', shipping_address_line1: '', shipping_city: '', shipping_state: '', shipping_zip: '', pricing_tier: 'B', notes: '' }); }, [customer, isOpen]);

  if (!isOpen) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{customer?.id ? 'Edit Customer' : 'New Customer'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Parent Customer (leave blank for parent)</label>
            <select className="form-select" value={form.parent_id || ''} onChange={e => set('parent_id', e.target.value || null)}>
              <option value="">— This is a parent customer —</option>
              {parents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-row form-row-2">
            <div className="form-group">
              <label className="form-label">Name *</label>
              <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder={form.parent_id ? "e.g. OLu Baseball" : "e.g. Orange Lutheran High School"} />
            </div>
            <div className="form-group">
              <label className="form-label">Alpha Tag (for POs)</label>
              <input className="form-input" value={form.alpha_tag || ''} onChange={e => set('alpha_tag', e.target.value)} placeholder="e.g. OLuB" />
            </div>
          </div>
          <div className="form-row form-row-3">
            <div className="form-group">
              <label className="form-label">Contact Name</label>
              <input className="form-input" value={form.contact_name || ''} onChange={e => set('contact_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.contact_email || ''} onChange={e => set('contact_email', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input className="form-input" value={form.contact_phone || ''} onChange={e => set('contact_phone', e.target.value)} />
            </div>
          </div>
          {!form.parent_id && <>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginTop: 8, marginBottom: 6, textTransform: 'uppercase' }}>Billing Address</div>
            <div className="form-row form-row-4">
              <div className="form-group" style={{ gridColumn: 'span 2' }}><input className="form-input" placeholder="Street" value={form.billing_address_line1 || ''} onChange={e => set('billing_address_line1', e.target.value)} /></div>
              <div className="form-group"><input className="form-input" placeholder="City" value={form.billing_city || ''} onChange={e => set('billing_city', e.target.value)} /></div>
              <div className="form-row form-row-2" style={{ gap: 6 }}>
                <input className="form-input" placeholder="State" value={form.billing_state || ''} onChange={e => set('billing_state', e.target.value)} />
                <input className="form-input" placeholder="ZIP" value={form.billing_zip || ''} onChange={e => set('billing_zip', e.target.value)} />
              </div>
            </div>
          </>}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginTop: 8, marginBottom: 6, textTransform: 'uppercase' }}>Shipping Address</div>
          <div className="form-row form-row-4">
            <div className="form-group" style={{ gridColumn: 'span 2' }}><input className="form-input" placeholder="Street" value={form.shipping_address_line1 || ''} onChange={e => set('shipping_address_line1', e.target.value)} /></div>
            <div className="form-group"><input className="form-input" placeholder="City" value={form.shipping_city || ''} onChange={e => set('shipping_city', e.target.value)} /></div>
            <div className="form-row form-row-2" style={{ gap: 6 }}>
              <input className="form-input" placeholder="State" value={form.shipping_state || ''} onChange={e => set('shipping_state', e.target.value)} />
              <input className="form-input" placeholder="ZIP" value={form.shipping_zip || ''} onChange={e => set('shipping_zip', e.target.value)} />
            </div>
          </div>
          <div className="form-row form-row-2">
            <div className="form-group">
              <label className="form-label">Pricing Tier</label>
              <select className="form-select" value={form.pricing_tier || 'B'} onChange={e => set('pricing_tier', e.target.value)}>
                <option value="A">A — 40% off retail (contract)</option>
                <option value="B">B — 35% off retail (standard)</option>
                <option value="C">C — 30% off retail</option>
                <option value="custom">Custom multiplier</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <input className="form-input" value={form.notes || ''} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { onSave({ ...form, id: form.id || 'c' + Date.now(), is_active: true }); onClose(); }}>
            {customer?.id ? 'Save Changes' : 'Create Customer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PRODUCT DETAIL MODAL ─────────────────────────────────────
function ProductDetailModal({ isOpen, onClose, product, vendor }) {
  if (!isOpen || !product) return null;
  const totalNSA = product.available_sizes.reduce((a, s) => a + (product._inv?.[s] || 0), 0);
  const hasClick = vendor?.click_automation;
  const hasSanMar = vendor?.api_provider === 'sanmar';
  const extInv = product._click || product._sanmar || {};
  const totalExt = Object.values(extInv).reduce((a, v) => a + v, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 750 }}>
        <div className="modal-header">
          <h2>{product.name}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <div style={{ width: 100, height: 100, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>👕</div>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 800, color: '#1e40af', background: '#dbeafe', display: 'inline-block', padding: '2px 10px', borderRadius: 4 }}>{product.sku}</div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{product.brand} · {product.color}</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>Category: {product.category}</div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12 }}>
                <span>Retail: <strong>${product.retail_price?.toFixed(2)}</strong></span>
                <span style={{ color: '#dc2626' }}>NSA Cost: <strong>${product.nsa_cost?.toFixed(2)}</strong></span>
                <span style={{ color: '#166534' }}>Tier A: <strong>${(product.retail_price * 0.60).toFixed(2)}</strong></span>
                <span style={{ color: '#d97706' }}>Tier B: <strong>${(product.retail_price * 0.65).toFixed(2)}</strong></span>
              </div>
            </div>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase' }}>Inventory by Size</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Source</th>
                  {product.available_sizes.map(s => <th key={s} style={{ textAlign: 'center', minWidth: 50 }}>{s}</th>)}
                  <th style={{ textAlign: 'center', minWidth: 60, background: '#1e40af', color: '#fff', borderRadius: '4px 4px 0 0' }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 700 }}>🏠 NSA Warehouse</td>
                  {product.available_sizes.map(s => {
                    const q = product._inv?.[s] || 0;
                    return <td key={s} style={{ textAlign: 'center', fontWeight: 700, color: q > 0 ? '#166534' : '#dc2626', background: q > 0 ? '#dcfce720' : '#fee2e220' }}>{q}</td>;
                  })}
                  <td style={{ textAlign: 'center', fontWeight: 800, background: '#1e40af', color: '#fff' }}>{totalNSA}</td>
                </tr>
                {(hasClick || hasSanMar) && (
                  <tr>
                    <td style={{ fontWeight: 700 }}>{hasClick ? '🔗 Adidas CLICK' : hasSanMar ? '📦 SanMar' : ''}</td>
                    {product.available_sizes.map(s => {
                      const q = extInv[s] || 0;
                      return <td key={s} style={{ textAlign: 'center', color: q > 0 ? '#1e40af' : '#94a3b8' }}>{q > 0 ? q.toLocaleString() : '—'}</td>;
                    })}
                    <td style={{ textAlign: 'center', fontWeight: 700, background: '#dbeafe', color: '#1e40af' }}>{totalExt.toLocaleString()}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState('dashboard');
  const [toast, setToast] = useState(null);
  const [customers, setCustomers] = useState(DEMO_CUSTOMERS);
  const [vendors] = useState(DEMO_VENDORS);
  const [products, setProducts] = useState(DEMO_PRODUCTS);

  // Modals
  const [custModal, setCustModal] = useState({ open: false, customer: null });
  const [csvModal, setCsvModal] = useState({ open: false, type: '', fields: [] });
  const [productDetail, setProductDetail] = useState(null);

  // Search
  const [search, setSearch] = useState('');

  const notify = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  // Customer helpers
  const parentCustomers = useMemo(() => customers.filter(c => !c.parent_id), [customers]);
  const getChildren = useCallback((pid) => customers.filter(c => c.parent_id === pid), [customers]);

  const saveCustomer = (cust) => {
    setCustomers(prev => {
      const exists = prev.find(c => c.id === cust.id);
      if (exists) return prev.map(c => c.id === cust.id ? cust : c);
      return [...prev, cust];
    });
    notify(cust.id ? 'Customer saved' : 'Customer created');
  };

  const importCustomers = (rows) => {
    const newCusts = rows.map((r, i) => ({
      id: 'cimp' + Date.now() + i,
      parent_id: r.parent_name ? customers.find(c => c.name === r.parent_name)?.id || null : null,
      name: r.name, alpha_tag: r.alpha_tag || '', contact_name: r.contact_name || '',
      contact_email: r.contact_email || '', contact_phone: r.contact_phone || '',
      billing_city: r.billing_city || '', billing_state: r.billing_state || '', billing_zip: r.billing_zip || '',
      shipping_city: r.shipping_city || r.billing_city || '', shipping_state: r.shipping_state || r.billing_state || '',
      pricing_tier: r.pricing_tier || 'B', is_active: true,
    }));
    setCustomers(prev => [...prev, ...newCusts]);
    notify(`Imported ${newCusts.length} customers`);
  };

  const importProducts = (rows) => {
    const newProds = rows.map((r, i) => ({
      id: 'pimp' + Date.now() + i,
      vendor_id: vendors.find(v => v.name.toLowerCase() === (r.vendor || '').toLowerCase())?.id || null,
      sku: r.sku, name: r.name, brand: r.brand || '', color: r.color || '',
      category: r.category || '', retail_price: parseFloat(r.retail_price) || 0,
      nsa_cost: parseFloat(r.nsa_cost) || 0,
      available_sizes: (r.sizes || 'XS,S,M,L,XL,2XL').split(',').map(s => s.trim()),
      is_active: true, _inv: {},
    }));
    setProducts(prev => [...prev, ...newProds]);
    notify(`Imported ${newProds.length} products`);
  };

  // Filtered data
  const filteredProducts = useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter(p => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q));
  }, [products, search]);

  // ─── RENDER PAGES ───────────────────────────────────────────
  const renderDashboard = () => (
    <>
      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Customers</div><div className="stat-value">{parentCustomers.length}</div><div className="stat-sub">{customers.length - parentCustomers.length} sub-customers</div></div>
        <div className="stat-card"><div className="stat-label">Vendors</div><div className="stat-value">{vendors.length}</div><div className="stat-sub">{vendors.filter(v => v.vendor_type === 'api').length} API connected</div></div>
        <div className="stat-card"><div className="stat-label">Products</div><div className="stat-value">{products.length}</div><div className="stat-sub">{products.reduce((a, p) => a + p.available_sizes.length, 0)} size variants</div></div>
        <div className="stat-card"><div className="stat-label">In Warehouse</div><div className="stat-value">{products.reduce((a, p) => a + Object.values(p._inv || {}).reduce((b, v) => b + v, 0), 0)}</div><div className="stat-sub">total units</div></div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h2>Quick Actions</h2></div>
        <div className="card-body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => { setPage('customers'); setCustModal({ open: true, customer: null }); }}><Icon name="plus" size={14} /> New Customer</button>
          <button className="btn btn-secondary" onClick={() => { setPage('products'); setCsvModal({ open: true, type: 'Products', fields: ['sku', 'name', 'brand', 'color', 'vendor', 'category', 'retail_price', 'nsa_cost', 'sizes'] }); }}><Icon name="upload" size={14} /> Import Products CSV</button>
          <button className="btn btn-secondary" onClick={() => { setPage('customers'); setCsvModal({ open: true, type: 'Customers', fields: ['name', 'alpha_tag', 'parent_name', 'contact_name', 'contact_email', 'billing_city', 'billing_state', 'pricing_tier'] }); }}><Icon name="upload" size={14} /> Import Customers CSV</button>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h2>Recent Products</h2></div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>SKU</th><th>Product</th><th>Brand</th><th>NSA Stock</th><th>Retail</th><th>Cost</th></tr></thead>
              <tbody>
                {products.slice(0, 5).map(p => {
                  const nsaTotal = Object.values(p._inv || {}).reduce((a, v) => a + v, 0);
                  return (
                    <tr key={p.id} onClick={() => setProductDetail(p)}>
                      <td><span style={{ fontFamily: 'monospace', fontWeight: 700, background: '#f1f5f9', padding: '2px 8px', borderRadius: 3, color: '#1e40af' }}>{p.sku}</span></td>
                      <td style={{ fontWeight: 600 }}>{p.name}<br /><span style={{ fontSize: 11, color: '#94a3b8' }}>{p.color}</span></td>
                      <td><span className="badge badge-blue">{p.brand}</span></td>
                      <td style={{ fontWeight: 700, color: nsaTotal > 0 ? '#166534' : '#dc2626' }}>{nsaTotal}</td>
                      <td>${p.retail_price?.toFixed(2)}</td>
                      <td style={{ color: '#64748b' }}>${p.nsa_cost?.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );

  const renderCustomers = () => (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <div className="search-bar" style={{ flex: 1 }}>
          <Icon name="search" />
          <input placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={() => setCustModal({ open: true, customer: null })}><Icon name="plus" size={14} /> New Customer</button>
        <button className="btn btn-secondary" onClick={() => setCsvModal({ open: true, type: 'Customers', fields: ['name','alpha_tag','parent_name','contact_name','contact_email','contact_phone','billing_city','billing_state','billing_zip','shipping_city','shipping_state','pricing_tier'] })}><Icon name="upload" size={14} /> Import CSV</button>
      </div>
      {parentCustomers.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || getChildren(p.id).some(c => c.name.toLowerCase().includes(search.toLowerCase()))).map(parent => (
        <div key={parent.id} className="card" style={{ marginBottom: 10 }}>
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="building" size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{parent.name}</span>
                <span className="badge badge-blue">{parent.alpha_tag}</span>
                <span className="badge badge-green">Tier {parent.pricing_tier}</span>
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                {parent.contact_name && `${parent.contact_name} · `}
                {parent.billing_city && `${parent.billing_city}, ${parent.billing_state}`}
                {parent.contact_email && ` · ${parent.contact_email}`}
              </div>
            </div>
            <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); setCustModal({ open: true, customer: parent }); }}><Icon name="edit" size={12} /></button>
            <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); setCustModal({ open: true, customer: { parent_id: parent.id, pricing_tier: parent.pricing_tier } }); }}><Icon name="plus" size={12} /> Sub</button>
          </div>
          {getChildren(parent.id).length > 0 && (
            <div style={{ borderTop: '1px solid #f1f5f9' }}>
              {getChildren(parent.id).map(child => (
                <div key={child.id} style={{ padding: '8px 16px 8px 64px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #f8fafc' }}
                  onClick={() => setCustModal({ open: true, customer: child })}>
                  <span style={{ color: '#cbd5e1' }}>└</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{child.name}</span>
                  <span className="badge badge-gray">{child.alpha_tag}</span>
                  {child.contact_name && <span style={{ fontSize: 11, color: '#94a3b8' }}>{child.contact_name}</span>}
                  {child.contact_email && <span style={{ fontSize: 11, color: '#94a3b8' }}>· {child.contact_email}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );

  const renderVendors = () => (
    <>
      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Total Vendors</div><div className="stat-value">{vendors.length}</div></div>
        <div className="stat-card"><div className="stat-label">API Connected</div><div className="stat-value">{vendors.filter(v => v.vendor_type === 'api').length}</div></div>
        <div className="stat-card"><div className="stat-label">NSA Inventory</div><div className="stat-value">{vendors.filter(v => v.nsa_carries_inventory).length}</div></div>
        <div className="stat-card"><div className="stat-label">Invoice Scan</div><div className="stat-value">{vendors.filter(v => v.invoice_scan_enabled).length}</div></div>
      </div>
      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Vendor</th><th>Type</th><th>NSA Warehouse</th><th>Live Inventory</th><th>Invoice Scan</th><th>Status</th></tr></thead>
              <tbody>
                {vendors.map(v => (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 700, fontSize: 14 }}>{v.name}</td>
                    <td><span className={`badge ${v.vendor_type === 'api' ? 'badge-purple' : 'badge-gray'}`}>{v.vendor_type === 'api' ? '🔗 API' : '📄 Upload'}</span></td>
                    <td>{v.nsa_carries_inventory ? <span className="badge badge-green">✓ Yes</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                    <td>{v.api_provider ? <span className="badge badge-blue">Live</span> : v.click_automation ? <span className="badge badge-amber">CLICK Daily</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                    <td>{v.invoice_scan_enabled ? <span className="badge badge-green">✓ Enabled</span> : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                    <td>{v.is_active ? <span className="badge badge-green">Active</span> : <span className="badge badge-red">Inactive</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );

  const renderProducts = () => (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <div className="search-bar" style={{ flex: 1 }}>
          <Icon name="search" />
          <input placeholder="Search by SKU, name, or brand..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-secondary" onClick={() => setCsvModal({ open: true, type: 'Products', fields: ['sku','name','brand','color','vendor','category','retail_price','nsa_cost','sizes'] })}><Icon name="upload" size={14} /> Import CSV</button>
      </div>
      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          {filteredProducts.map(p => {
            const v = vendors.find(vv => vv.id === p.vendor_id);
            const nsaTotal = Object.values(p._inv || {}).reduce((a, val) => a + val, 0);
            const extInv = p._click || p._sanmar || {};
            const hasExt = Object.values(extInv).some(val => val > 0);

            return (
              <div key={p.id} style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                onClick={() => setProductDetail(p)}
                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <div style={{ width: 60, height: 60, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>👕</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, background: '#dbeafe', padding: '2px 8px', borderRadius: 3, color: '#1e40af', fontSize: 14 }}>{p.sku}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{p.name}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                      <span className="badge badge-blue" style={{ marginRight: 6 }}>{p.brand}</span>
                      {p.color}
                      <span style={{ marginLeft: 8 }}>Retail: ${p.retail_price?.toFixed(2)}</span>
                      <span style={{ marginLeft: 8, color: '#dc2626' }}>Cost: ${p.nsa_cost?.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 2, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {p.available_sizes.map(s => {
                        const q = p._inv?.[s] || 0;
                        return (
                          <div key={s} className={`size-cell ${q > 10 ? 'in-stock' : q > 0 ? 'low-stock' : 'no-stock'}`}>
                            <div className="size-label">{s}</div>
                            <div className="size-qty">{q}</div>
                          </div>
                        );
                      })}
                      <div className="size-cell total">
                        <div className="size-label">TOTAL</div>
                        <div className="size-qty">{nsaTotal}</div>
                      </div>
                      {hasExt && (
                        <span style={{ fontSize: 10, color: '#2563eb', marginLeft: 6 }}>
                          + {v?.click_automation ? 'CLICK' : v?.api_provider === 'sanmar' ? 'SanMar' : 'Vendor'} available
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {filteredProducts.length === 0 && <div className="empty">No products found. Try a different search or import via CSV.</div>}
        </div>
      </div>
    </>
  );

  const renderInventory = () => {
    const allItems = products.flatMap(p => 
      p.available_sizes.map(s => ({
        product: p, size: s, sku: `${p.sku}-${s}`,
        nsa: p._inv?.[s] || 0,
        ext: (p._click?.[s] || p._sanmar?.[s] || 0),
        extLabel: p._click ? 'CLICK' : p._sanmar ? 'SanMar' : '',
      }))
    ).filter(item => item.nsa > 0 || search);

    const filteredInv = search
      ? allItems.filter(i => i.sku.toLowerCase().includes(search.toLowerCase()) || i.product.name.toLowerCase().includes(search.toLowerCase()))
      : allItems.filter(i => i.nsa > 0);

    const totalUnits = allItems.reduce((a, i) => a + i.nsa, 0);
    const totalSKUs = allItems.filter(i => i.nsa > 0).length;

    return (
      <>
        <div className="stats-row">
          <div className="stat-card"><div className="stat-label">Total Units</div><div className="stat-value">{totalUnits}</div></div>
          <div className="stat-card"><div className="stat-label">Active SKU/Sizes</div><div className="stat-value">{totalSKUs}</div></div>
          <div className="stat-card"><div className="stat-label">Products in Warehouse</div><div className="stat-value">{products.filter(p => Object.values(p._inv || {}).some(v => v > 0)).length}</div></div>
          <div className="stat-card"><div className="stat-label">Low Stock Alerts</div><div className="stat-value" style={{ color: '#d97706' }}>{allItems.filter(i => i.nsa > 0 && i.nsa <= 5).length}</div></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <div className="search-bar" style={{ flex: 1 }}>
            <Icon name="search" />
            <input placeholder="Search inventory by SKU or product..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>SKU</th><th>Product</th><th>Size</th><th style={{ textAlign: 'center' }}>NSA Qty</th><th style={{ textAlign: 'center' }}>Vendor</th><th>Status</th></tr></thead>
                <tbody>
                  {filteredInv.slice(0, 50).map(item => (
                    <tr key={item.sku}>
                      <td><span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e40af' }}>{item.sku}</span></td>
                      <td style={{ fontSize: 12 }}>{item.product.name}<br /><span style={{ color: '#94a3b8' }}>{item.product.color}</span></td>
                      <td><span style={{ fontWeight: 700 }}>{item.size}</span></td>
                      <td style={{ textAlign: 'center', fontWeight: 800, fontSize: 16, color: item.nsa > 10 ? '#166534' : item.nsa > 0 ? '#d97706' : '#dc2626' }}>{item.nsa}</td>
                      <td style={{ textAlign: 'center', fontSize: 12, color: '#2563eb' }}>{item.ext > 0 ? `${item.extLabel}: ${item.ext.toLocaleString()}` : '—'}</td>
                      <td>
                        {item.nsa === 0 ? <span className="badge badge-red">Out of Stock</span> :
                         item.nsa <= 5 ? <span className="badge badge-amber">Low Stock</span> :
                         <span className="badge badge-green">In Stock</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredInv.length === 0 && <div className="empty">No inventory items found</div>}
          </div>
        </div>
      </>
    );
  };

  // ─── SIDEBAR NAV ────────────────────────────────────────────
  const navItems = [
    { section: 'Overview' },
    { id: 'dashboard', label: 'Dashboard', icon: 'home' },
    { section: 'People' },
    { id: 'customers', label: 'Customers', icon: 'users' },
    { id: 'vendors', label: 'Vendors', icon: 'building' },
    { section: 'Catalog' },
    { id: 'products', label: 'Products', icon: 'package' },
    { id: 'inventory', label: 'Inventory', icon: 'warehouse' },
    { section: 'Coming in Phase 2' },
    { id: 'estimates', label: 'Estimates', icon: 'dollar', disabled: true },
    { id: 'orders', label: 'Sales Orders', icon: 'box', disabled: true },
    { id: 'production', label: 'Production', icon: 'grid', disabled: true },
  ];

  const titles = { dashboard: 'Dashboard', customers: 'Customers', vendors: 'Vendors', products: 'Products', inventory: 'Inventory' };

  return (
    <div className="app">
      <Toast message={toast?.msg} type={toast?.type} />

      <div className="sidebar">
        <div className="sidebar-logo">
          NSA
          <span>Operations Portal</span>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item, i) => {
            if (item.section) return <div key={i} className="sidebar-section">{item.section}</div>;
            return (
              <button key={item.id} className={`sidebar-link ${page === item.id ? 'active' : ''}`}
                disabled={item.disabled}
                style={item.disabled ? { opacity: 0.3, cursor: 'not-allowed' } : {}}
                onClick={() => { if (!item.disabled) { setPage(item.id); setSearch(''); } }}>
                <Icon name={item.icon} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-user">
          <div style={{ fontWeight: 600, color: '#e2e8f0' }}>Steve Peterson</div>
          <div>Admin</div>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <h1>{titles[page] || 'Dashboard'}</h1>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Phase 1 — Foundation</div>
        </div>
        <div className="content">
          {page === 'dashboard' && renderDashboard()}
          {page === 'customers' && renderCustomers()}
          {page === 'vendors' && renderVendors()}
          {page === 'products' && renderProducts()}
          {page === 'inventory' && renderInventory()}
        </div>
      </div>

      <CustomerModal
        isOpen={custModal.open}
        onClose={() => setCustModal({ open: false, customer: null })}
        onSave={saveCustomer}
        customer={custModal.customer}
        parents={parentCustomers}
      />

      <CsvImportModal
        isOpen={csvModal.open}
        onClose={() => setCsvModal({ open: false, type: '', fields: [] })}
        onImport={csvModal.type === 'Customers' ? importCustomers : importProducts}
        type={csvModal.type}
        fields={csvModal.fields}
      />

      <ProductDetailModal
        isOpen={!!productDetail}
        onClose={() => setProductDetail(null)}
        product={productDetail}
        vendor={productDetail ? vendors.find(v => v.id === productDetail.vendor_id) : null}
      />
    </div>
  );
}
