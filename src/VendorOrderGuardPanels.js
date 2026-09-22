// Shared review panels for the three vendor order modals (S&S, Momentec, SanMar).
//
// Kept in one file on purpose: these two panels are the only thing standing between a
// malformed batch queue and a real order, and three hand-synced copies is exactly how
// this codebase has drifted before (FABLE_SYSTEM_AUDIT_2026-07-03.md). The modals differ
// in palette elsewhere, but a warning that stops money moving should look identical
// wherever a rep meets it.
import React from 'react';

/**
 * Amber gate shown when two or more portal lines collapse onto one vendor item number.
 *
 * Merging is often correct — two sales orders in a batch wanting the same style/color/size
 * is the whole point of batching. What went wrong on NSA 4632 is that the rep reviewed a
 * list of 27 lines and could not see that each one appeared twice, so the order doubled.
 * So: show the merged total next to its parts, and require an explicit tick.
 */
export function DuplicateMergeWarning({ duplicates, acknowledged, onAcknowledge, vendorName = 'the vendor', disabled = false }) {
  if (!duplicates || !duplicates.length) return null;
  const combinedUnits = duplicates.reduce((s, d) => s + d.quantity, 0);
  // Every duplicate coming from ONE sales order is the fingerprint of a duplicated batch
  // queue rather than a legitimate cross-order merge — call that out by name.
  const sameSoOnly = duplicates.filter(d => new Set(d.parts.map(p => p.sourceSO || '')).size === 1);
  return (
    <div style={{ padding: 12, background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#92400e' }}>
      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>
        ⚠ {duplicates.length} item number{duplicates.length === 1 ? '' : 's'} {duplicates.length === 1 ? 'appears' : 'appear'} on more than one line —
        {' '}{combinedUnits} unit{combinedUnits === 1 ? '' : 's'} will be ordered as ONE combined quantity each.
      </div>
      <div style={{ marginBottom: 8 }}>
        This is correct when two different sales orders in this batch want the same item — combining
        them is the point of batching. Check every row below against what was actually sold.
      </div>
      {!!sameSoOnly.length && (
        <div style={{ marginBottom: 8, padding: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, color: '#991b1b', fontWeight: 700 }}>
          ⛔ {sameSoOnly.length} of these {sameSoOnly.length === 1 ? 'is' : 'are'} being combined from lines on the <em>same</em> sales order.
          That usually means the batch queue holds the same line twice — the NSA 4632 fault, which
          double-ordered 53 units. Unless this order genuinely has two separate lines of that item
          (a second decoration, say), cancel, fix the batch queue, and start again.
        </div>
      )}
      <div style={{ maxHeight: 210, overflow: 'auto', background: '#fff', border: '1px solid #fde68a', borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={dth}>Item</th><th style={dth}>Vendor #</th>
            <th style={{ ...dth, textAlign: 'left' }}>Lines being combined</th>
            <th style={{ ...dth, textAlign: 'right' }}>Ordering</th>
          </tr></thead>
          <tbody>
            {duplicates.map((d, i) => (
              <tr key={d.key || i} style={{ borderTop: '1px solid #fef3c7' }}>
                <td style={dtd}>{d.parts[0]?.label || d.key}</td>
                <td style={{ ...dtd, fontFamily: 'monospace', fontSize: 11 }}>{d.key}</td>
                <td style={dtd}>
                  {d.parts.map((p, j) => (
                    <span key={j} style={{ display: 'inline-block', marginRight: 8, whiteSpace: 'nowrap' }}>
                      {p.quantity}{p.sourceSO ? <span style={{ color: '#a16207' }}> ({p.sourceSO})</span> : null}{j < d.parts.length - 1 ? ' +' : ''}
                    </span>
                  ))}
                </td>
                <td style={{ ...dtd, textAlign: 'right', fontWeight: 800 }}>{d.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer' }}>
        <input type="checkbox" checked={!!acknowledged} disabled={disabled} onChange={e => onAcknowledge(e.target.checked)} />
        <span>I checked the combined quantities above — these are the quantities {vendorName} should ship.</span>
      </label>
    </div>
  );
}

/**
 * Red panel shown AFTER the vendor accepts an order that it did not fill completely.
 *
 * The S&S payload sets rejectLineErrors:false, so S&S places what it can and drops the rest
 * without failing the request. The portal then stamps every queued line as ordered. NSA 4632's
 * AT203 Team Power Red (6 units) sat on SO-2277 as "waiting" for ten days on an order that
 * never contained it. A dropped line is not an error the rep can be left to notice.
 */
export function UnacceptedLinesPanel({ reconcile, vendorName = 'the vendor', poNumber = '' }) {
  if (!reconcile) return null;
  const { verified, checkedAgainst, lineErrors = [], missing = [], short = [] } = reconcile;
  if (verified) return null;

  // Nothing observed wrong, but nothing checkable either: say exactly that. Claiming lines
  // were dropped when the vendor simply told us nothing would be its own kind of wrong.
  if (checkedAgainst === 'errors-only' && !lineErrors.length) {
    return (
      <div style={{ padding: 10, background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#475569' }}>
        <strong>ℹ {vendorName} returned no line detail</strong>, so the portal could not confirm every line was
        accepted. Open the order on the vendor's site and check the line list against the sales order
        before treating {poNumber || 'this PO'} as fully ordered.
      </div>
    );
  }

  return (
    <div style={{ padding: 12, background: '#fef2f2', border: '2px solid #dc2626', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#991b1b' }}>
      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>
        ⚠ {vendorName} did NOT accept every line on this order.
      </div>
      <div style={{ marginBottom: 8 }}>
        The rest of the order was placed. The portal has marked these lines as ordered anyway —
        <strong> they are not on the order and still need to be bought.</strong> Order them separately, then
        fix the PO line on the sales order so nobody waits on stock that isn't coming.
      </div>
      {!!missing.length && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontWeight: 700 }}>Not on the order ({missing.length}):</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {missing.map((m, i) => <li key={i}>{m.label} — {m.sent} unit{m.sent === 1 ? '' : 's'}{m.sourceSO ? ` · ${m.sourceSO}` : ''} <code style={{ fontSize: 11 }}>{m.key}</code></li>)}
          </ul>
        </div>
      )}
      {!!short.length && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontWeight: 700 }}>Accepted at a lower quantity ({short.length}):</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {short.map((s, i) => <li key={i}>{s.label} — sent {s.sent}, accepted {s.accepted}{s.sourceSO ? ` · ${s.sourceSO}` : ''}</li>)}
          </ul>
        </div>
      )}
      {!!lineErrors.length && (
        <div>
          <div style={{ fontWeight: 700 }}>{vendorName} reported:</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontFamily: 'monospace', fontSize: 11 }}>
            {lineErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}


/**
 * Freight line for the review screen: where the order stands against the vendor's
 * free-shipping threshold, and — when the vendor's API can tell us — the actual freight.
 *
 * `gap` comes from freeShipGap (null hides the panel). `quote` is optional and vendor-
 * specific: { state: 'loading' | 'ok' | 'error', amount?: number, note?: string }.
 * Momentec quotes before the order (POST /v2/ShippingCost); S&S returns the charge on the
 * order response, so it is shown after submit; SanMar's PO service returns no freight at
 * all, so that modal only ever shows the threshold line.
 */
export function FreeShipNotice({ vendorName = 'the vendor', gap, quote }) {
  if (!gap) return null;
  const money = (n) => '$' + (Number(n) || 0).toFixed(2);
  const quoteLine = !quote ? null
    : quote.state === 'loading' ? <span style={{ color: '#6b7280' }}>Getting {vendorName}'s freight quote…</span>
    : quote.state === 'error' ? <span style={{ color: '#991b1b' }}>Freight quote failed{quote.note ? ` — ${quote.note}` : ''}. The charge will still show on the bill.</span>
    : quote.state === 'ok' ? <span><strong>{vendorName} freight: {money(quote.amount)}</strong>{quote.note ? ` — ${quote.note}` : ''}</span>
    : null;
  if (!gap.under) {
    return (
      <div data-testid="free-ship-notice" style={{ padding: '8px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#166534' }}>
        ✓ {money(gap.total)} in goods — over {vendorName}'s {money(gap.threshold)} free-shipping threshold.
        {quoteLine && <div style={{ marginTop: 4 }}>{quoteLine}</div>}
      </div>
    );
  }
  return (
    <div data-testid="free-ship-notice" style={{ padding: 10, background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#92400e' }}>
      <div style={{ fontWeight: 800 }}>
        ⚠ {money(gap.total)} in goods is {money(gap.gap)} under {vendorName}'s {money(gap.threshold)} free-shipping threshold — freight will be charged.
      </div>
      <div style={{ marginTop: 4 }}>
        {quoteLine || <span>Add more to this batch to reach free shipping, or accept the freight charge.</span>}
      </div>
    </div>
  );
}

const dth = { padding: '5px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', background: '#fffbeb' };
const dtd = { padding: '5px 8px', fontSize: 12, color: '#78350f' };
