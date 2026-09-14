import React, { useMemo, useState } from 'react';
import { suggestSoFixes, rematchOptions, isBulkSafe } from './lib/fulfillmentReconcile';
import { matchupGuidance } from './lib/soPlayerReport';

// The panel a rep lands on when a Silver Screen file or player report is blocked.
//
// It answers three questions in order: what is blocking it, which row is actually
// off, and what would fix it. The fixes are buttons — they edit the sales order
// the rep already has open, so the change appears in the grid as unsaved and is
// theirs to review or discard. Nothing here writes to the database.
//
// Shared by OrderEditor.js and OrderEditorClassic.js exactly as MultiItemAddModal
// is: one component, rendered identically from both, so the two editors can never
// drift on what "reconcile" means.

const Chip = ({ n, label, bad }) => (
  <div style={{ flex: 1, minWidth: 110, background: bad ? '#fef2f2' : '#f8fafc', border: `1px solid ${bad ? '#fecaca' : '#e2e8f0'}`, borderRadius: 10, padding: '8px 12px' }}>
    <div style={{ fontSize: 20, fontWeight: 900, color: bad ? '#b91c1c' : '#0b1220' }}>{n}</div>
    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: .3, marginTop: 2 }}>{label}</div>
  </div>
);

const H = ({ children, right }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 8px' }}>
    <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: .3 }}>{children}</div>
    {right}
  </div>
);

export default function FulfillmentReconcileModal({ data, onClose, onApply, onPin, onUnpin, onSaveRecheck, onForce, dirty, saving }) {
  const [applied, setApplied] = useState([]);
  // Any change makes the figures below historical: they were computed when the
  // report ran and nothing here recomputes them.
  const [touched, setTouched] = useState(false);
  const soItems = data?.soItems || [];
  const matchup = data?.matchup;
  const fixes = useMemo(() => suggestSoFixes({ matchup, soItems }), [matchup, soItems]);
  // Which pair of counts actually disagrees, in the order a rep would fix them. Not
  // everything that blocks a file is fixable by changing a quantity on the sales
  // order — a job already submitted to Silver Screen for fewer units is the obvious
  // case, and without this the panel just goes quiet on it.
  const steps = useMemo(
    () => matchupGuidance({ matchup, verifyDetail: data?.verifyDetail || [], jobUnits: data?.jobUnits ?? null, jobId: data?.jobId || '' }),
    [matchup, data],
  );
  if (!data) return null;

  const bulk = fixes.filter(isBulkSafe);
  // Identity, not row number — two rows can share an index after an edit.
  const key = (f) => `${f.key}|${f.size}|${f.delta}`;
  const markApplied = (list) => setApplied((prev) => [...prev, ...list.map(key)]);
  const apply = (list) => { if (!list.length) return; onApply(list); markApplied(list); setTouched(true); };
  const pin = (k, sku) => { onPin(k, sku); setTouched(true); };
  const unpin = (sku) => { onUnpin(sku); setTouched(true); };
  const Stale = () => (touched ? (
    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 10 }}>
      These figures are from when the report ran and do not include the changes you just made. Close this and download the file again to re-check.
    </div>
  ) : null);

  const verify = data.verifyDetail || [];
  const jobUnits = data.jobUnits;
  const off = matchup && matchup.reportUnits !== matchup.soUnits;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 940 }}>
        <div className="modal-header" style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 2, borderRadius: '12px 12px 0 0' }}>
          <div>
            <h2>{data.label || 'Fulfillment file'} blocked — reconcile</h2>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{[data.storeName, data.so?.id].filter(Boolean).join(' · ')}</div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '2px 0 4px' }}>
          <Chip n={matchup?.customerUnits ?? 0} label="Customer units" bad={off} />
          {!!matchup?.extraUnits && <Chip n={matchup.extraUnits} label="Unassigned extras" bad />}
          <Chip n={matchup?.soUnits ?? 0} label="Sales order units" bad={off} />
          {jobUnits != null && <Chip n={jobUnits} label="Silver Screen job" bad={jobUnits !== matchup?.reportUnits} />}
        </div>

        <H>What's blocking it ({(data.issues || []).length})</H>
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, lineHeight: 1.7 }}>
          <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{(data.issues || []).map((i, n) => <li key={n}>{i}</li>)}</ul>
        </div>

        {!!steps.length && <>
          <H>How to match them up</H>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, lineHeight: 1.6 }}>
            <ol style={{ margin: '4px 0', paddingLeft: 18 }}>{steps.map((t, n) => <li key={n} style={{ margin: '6px 0' }}>{t}</li>)}</ol>
            {!!data.jobUrl && <div style={{ marginTop: 8 }}>
              <a href={data.jobUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
                Open job {data.jobId ? `#${data.jobId}` : ''} on the Silver Screen portal ↗
              </a>
            </div>}
          </div>
        </>}

        <H right={bulk.length > 1 && (
          <button className="btn btn-sm" style={{ background: '#2563eb', color: '#fff', fontWeight: 700 }}
            onClick={() => apply(bulk.filter((f) => !applied.includes(key(f))))}>
            Apply all {bulk.filter((f) => !applied.includes(key(f))).length} additions
          </button>
        )}>Suggested fixes ({fixes.length})</H>
        {!fixes.length && <div style={{ fontSize: 12.5, color: '#64748b' }}>
          Every item and size on the sales order already matches what customers ordered, so there is no quantity here left to change.
          {steps.length ? ' What is still blocking the file is above, under "How to match them up" — it is not something this order\u2019s item grid can fix.' : ''}
        </div>}
        {fixes.map((f, n) => {
          const done = applied.includes(key(f));
          const actionable = f.itemIndex != null;
          return (
            <div key={n} style={{ border: '1px solid #e2e8f0', borderLeft: `3px solid ${done ? '#16a34a' : f.kind === 'add' ? '#2563eb' : '#b45309'}`, borderRadius: 8, padding: '8px 12px', marginBottom: 8, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{f.label || f.row?.name}</div>
                <div style={{ fontSize: 12, color: f.kind === 'add' ? '#1d4ed8' : '#92400e', marginTop: 2 }}>{f.note}</div>
                {!!f.row?.who?.length && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{f.row.who.slice(0, 4).join(', ')}{f.row.who.length > 4 ? ` +${f.row.who.length - 4} more` : ''}</div>}
              </div>
              {actionable && (done
                ? <span style={{ fontSize: 12, fontWeight: 800, color: '#16a34a', whiteSpace: 'nowrap' }}>✓ Applied</span>
                : <button className="btn btn-sm" style={{ whiteSpace: 'nowrap', fontWeight: 700 }} onClick={() => apply([f])}>
                    {f.kind === 'add' ? `Add ${f.delta} × ${f.size}` : `Remove ${Math.abs(f.delta)} × ${f.size}`}
                  </button>)}
            </div>
          );
        })}

        <Stale />
        <H>Unit match-up{matchup?.diffRows?.length ? ` — ${matchup.diffRows.length} row${matchup.diffRows.length === 1 ? '' : 's'} differ` : ' — every row agrees'}</H>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['Item', 'Size', 'Customer', 'Sales order', 'Diff', 'Where'].map((h, i) => (
              <th key={h} style={{ textAlign: i > 0 && i < 5 ? 'center' : 'left', borderBottom: '1px solid #cbd5e1', padding: '6px 8px', color: '#64748b', fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
            ))}</tr></thead>
            <tbody>{(matchup?.rows || []).map((r) => (
              <tr key={r.key} style={{ background: r.delta ? '#fffbeb' : undefined }}>
                <td style={{ padding: '7px 8px', borderBottom: '1px solid #f1f5f9' }}>
                  <b>{r.name}</b>{r.sku && <div style={{ fontSize: 11, color: '#94a3b8' }}>{r.sku}{r.color ? ` · ${r.color}` : ''}</div>}
                </td>
                <td style={{ padding: '7px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>{r.size}</td>
                <td style={{ padding: '7px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'center', fontWeight: 800 }}>
                  {r.customerUnits}{!!r.extraUnits && <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>+{r.extraUnits} unassigned</div>}
                </td>
                <td style={{ padding: '7px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'center', fontWeight: 800 }}>{r.soUnits}</td>
                <td style={{ padding: '7px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'center', fontWeight: 800, color: r.delta ? '#b91c1c' : '#cbd5e1' }}>{r.delta ? `${r.delta > 0 ? '+' : ''}${r.delta}` : '—'}</td>
                <td style={{ padding: '7px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 11, color: '#94a3b8' }}>
                  {r.who.slice(0, 4).join(', ')}{r.who.length > 4 ? ` +${r.who.length - 4} more` : ''}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>

        {!!verify.length && <>
          <H>Needs your confirmation ({verify.length})</H>
          {verify.map((v, n) => {
            const sourceSku = v.wasSku || v.sku || '';
            const opts = rematchOptions(soItems, sourceSku);
            const current = opts.find((o) => o.pinned);
            return (
              <div key={n} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
                <div style={{ fontSize: 12.5 }}>
                  <b>{v.order}</b>{v.player ? ` · ${v.player}` : ''} — {v.name}{v.size ? ` · ${v.size}` : ''}
                </div>
                <div style={{ fontSize: 11.5, color: v.unmatched ? '#b91c1c' : '#b45309', fontWeight: 700, marginTop: 2 }}>
                  {v.unmatched ? '⚠ not on the sales order' : [v.wasSku && `↺ was SKU ${v.wasSku}`, v.wasSize && `↺ was size ${v.wasSize}`].filter(Boolean).join(' · ') || 'best-match swap'}
                </div>
                {!!sourceSku && <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Match {sourceSku} to:</span>
                  <select value={current ? current.key : ''} style={{ fontSize: 12, maxWidth: 380 }}
                    onChange={(e) => (e.target.value === '' ? unpin(sourceSku) : pin(e.target.value, sourceSku))}>
                    <option value="">Whatever the system picks (auto)</option>
                    {opts.map((o) => <option key={o.key} value={o.key}>{o.label}{o.sizes ? ` — ${o.sizes}` : ''}</option>)}
                  </select>
                  {current && <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>✓ confirmed by you</span>}
                </div>}
              </div>
            );
          })}
        </>}

        </div>
        <div className="modal-footer" style={{ position: 'sticky', bottom: 0, background: '#fff', zIndex: 2, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid #e2e8f0', borderRadius: '0 0 12px 12px' }}>
          <div style={{ fontSize: 11.5, color: '#64748b', maxWidth: 520 }}>
            {/* Only an explicit false means "structurally unbuildable". An absent flag
                is not evidence of that, and saying so would be a scary claim made on
                no information. */}
            {data.canOverride === false
              ? <>These are required by Silver Screen's import template, so the file cannot be built until they are filled in — their importer would reject it.</>
              : dirty
                ? <>This order has <b>unsaved</b> changes. Saving writes them and runs the file again{data.canOverride ? <> — or take it as it stands with <b>Download anyway</b></> : ''}.</>
                : <>Fixed something elsewhere — the deco PO, or the job on their portal? Re-check{data.canOverride ? <>, or take the file as it stands with <b>Download anyway</b></> : ''}.</>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* The escape hatch. The checks above are advice, not a veto — a rep who
                knows the situation can send the file. Offered only when the workbook
                would actually be usable; a row their importer rejects is not a
                judgement call, so there is nothing to overrule. */}
            {data.canOverride && !!onForce && <>
              {data.format === 'product' && <button className="btn btn-sm" disabled={saving} onClick={() => onForce('product')}
                title="Download the Silver Screen workbook as it stands, with the issues above unresolved"
                style={{ fontWeight: 700 }}>Download anyway</button>}
              <button className="btn btn-sm" disabled={saving} onClick={() => onForce('csv')}
                title="Export the flat one-row-per-line CSV as it stands, with the issues above unresolved"
                style={{ fontWeight: 700 }}>Export CSV anyway</button>
              <span style={{ width: 1, alignSelf: 'stretch', background: '#e2e8f0', margin: '0 2px' }} />
            </>}
            <button className="btn btn-sm" onClick={onClose} disabled={saving} style={{ fontWeight: 700 }}>Close</button>
            {/* Re-checking just re-runs the report, so it is always available. Gating it
                on unsaved changes stranded reps who had fixed the real problem outside
                this panel and only wanted to find out whether the file passes now. */}
            <button className="btn btn-sm" onClick={onSaveRecheck} disabled={saving}
              style={{ fontWeight: 800, background: saving ? '#cbd5e1' : '#2563eb', color: '#fff', border: 'none' }}>
              {saving ? 'Working…' : dirty ? 'Save & re-check file' : 'Re-check file'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
