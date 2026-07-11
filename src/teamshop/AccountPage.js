import React, { useEffect, useRef, useState } from 'react';
import CoachGate from './CoachGate';
import TeamPicker from './TeamPicker';
import LogoPicker from './LogoPicker';
import { statusChipLabel } from '../lib/teamshopOrderStatus';
import useCoachSession from './useCoachSession';
import {
  NAVY, NAVY_DARK, RED, RED_SOFT, BORDER, TEXT_MUTED, TEXT_FAINT, displayType,
} from './theme';

// "Account" — the approved Claude Design mockup ("Account.dc.html", the LAST
// page of the approved design set) translated to React.
//
// Mapping decisions (mockup -> real data vs. honest placeholders):
//   - Signed-out: a light hero ("Your account" + sign-in copy) wraps
//     CoachGate — same idea as StartWithLogo's entry chrome, but simpler:
//     CoachGate's own sign-in form does the real work, unchanged.
//   - Coach identity + sign out: CoachGate ALREADY renders "Signed in as
//     {email}" plus a working sign-out button once signed in (see
//     CoachGate.js) — reused as-is here, not rebuilt.
//   - Team(s): TeamPicker is rendered directly (real fetch to
//     teamshop-context.js, same 'nts_customer' localStorage key it already
//     owns) — not forked. Its onSelect is wired to the SAME customer state
//     TeamShopApp's order flow uses (passed in as `customer`/
//     `onCustomerSelect`), so switching teams here and in the order flow
//     stay in sync. TeamPicker only renders an actual switcher when the
//     coach has more than one team (its existing behavior); the current
//     team's name is shown here regardless.
//   - Saved logos: LogoPicker rendered directly (real fetch to
//     teamshop-art.js 'list'/'upload') — no forked fetch logic. `onSelect`
//     is a no-op (Account isn't mid-placement); LogoPicker's own upload
//     dropzone still gives this a "manage", not just browse, presentation.
//     The hero's "Saved logos" count reuses LogoPicker's real list via the
//     small onLogosChange callback added to LogoPicker.js (still one fetch,
//     just reported upward — see that file).
//   - Recent orders / Reorder (Stage 8): netlify/functions/teamshop-orders.js
//     'list' now backs both sections for real — fetched on mount once a coach
//     session + customer are both known. Each row shows date, item count +
//     first item name, total, a friendly STATUS chip (see statusChipLabel
//     below), and a 'Track' link to the existing tokenless
//     /shop/order/<status_token> tracker (OrderTrack.js — unchanged). Per the
//     v2 mockup (Account.dc.html links each reorder row to
//     "Product.dc.html?p={{ o.slug }}"): 'Reorder' calls the onReorder prop
//     with the order's first item's product_id; TeamShopApp owns turning that
//     into a ProductPage preview (fetches the product row, sets
//     previewProduct + route 'catalog') — this component never fetches
//     products or touches routing itself.
//   - Saved roster: the mockup's "Saved roster" size-run card is fictional
//     design-tool state (a local `nts_roster` key that exists only in the
//     .dc.html mockup's own script, nowhere in this codebase) — it is NOT
//     the portal's real, unrelated RosterOrders.js roster system, which
//     belongs to a different part of the app and is out of scope for this
//     storefront chunk. Rendered as an honest "coming soon" shell.
//     TODO(account-roster).
//
// props:
//   section          — optional 'logos' | 'orders', scrolls that section
//                       into view on mount (TeamShopApp.js's goAccount(),
//                       wired from the footer's "My logos"/"Reorder" links).
//   customer         — the shared order-flow customer (or null)
//   onCustomerSelect — TeamShopApp's setOrderCustomer, shared with the rest
//                      of the app so switching teams here matches everywhere.
//   onReorder        — optional (productId) => void. TeamShopApp opens that
//                       product's ProductPage in the catalog route. Omitted
//                       in contexts where reordering has nowhere to go.

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// order.status (webstore_orders) + order.production.stage (teamshop-orders.js,
// derived from so_jobs/webstore_shipments) -> one friendly chip. Production
// stage — once the order has converted to a Sales Order — takes priority over
// the raw 'paid'/'batched' status, same as the tokenless tracker's story.
// Shared with CoachPortal's Team Shop orders card — src/lib/teamshopOrderStatus.js.

function StatusChip({ order }) {
  const label = statusChipLabel(order);
  const tone = {
    'Cancelled': ['#FCE9EA', '#962C32'], 'Refunded': ['#F1F5F9', '#475569'],
    'Awaiting payment': ['#FEF3C7', '#92400E'], 'PO review': ['#FEF3C7', '#92400E'],
    'Shipped': ['#DCFCE7', '#166534'], 'Decorated': ['#FAE8FF', '#86198F'],
    'In production': ['#FEF3C7', '#92400E'], 'Queued': ['#EEF2FF', '#3730A3'],
    'Received': ['#EEF2FF', '#3730A3'], 'Processing': ['#F1F5F9', '#475569'],
  }[label] || ['#F1F5F9', '#475569'];
  return <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 800, padding: '4px 10px', borderRadius: 20, background: tone[0], color: tone[1], whiteSpace: 'nowrap' }}>{label}</span>;
}

// Recent orders — netlify/functions/teamshop-orders.js 'list', coach-JWT
// authed (useCoachSession's accessToken, same bearer pattern as LogoPicker).
// onOrdersChange reports the list upward, same as LogoPicker's
// onLogosChange, so the hero's "Orders placed" stat can show a real count.
function OrdersSection({ customer, onReorder, onOrdersChange }) {
  const { accessToken } = useCoachSession();
  const [state, setState] = useState('loading'); // loading|ready|error
  const [orders, setOrders] = useState([]);
  const customerId = customer && customer.id;

  useEffect(() => {
    if (!accessToken || !customerId) return undefined;
    let alive = true;
    setState('loading');
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/teamshop-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ action: 'list', customer_id: customerId }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Request failed');
        if (!alive) return;
        const rows = Array.isArray(json.orders) ? json.orders : [];
        setOrders(rows);
        if (onOrdersChange) onOrdersChange(rows);
        setState('ready');
      } catch (e) {
        if (alive) setState('error');
      }
    })();
    return () => { alive = false; };
  }, [accessToken, customerId, onOrdersChange]);

  if (!customerId) return <ComingSoon text="Pick a team above to see its order history." />;
  if (state === 'loading') return <p style={{ fontSize: 14, color: TEXT_MUTED, textAlign: 'center', padding: 24 }}>Loading your orders…</p>;
  if (state === 'error') return <p style={{ fontSize: 14, color: '#962C32', textAlign: 'center', padding: 24 }}>Couldn't load your orders — try again in a moment.</p>;
  if (!orders.length) return <ComingSoon text="No orders yet — orders you place will show up here." />;

  return (
    <div>
      {orders.map((o) => {
        const first = o.items && o.items[0];
        const extra = o.items ? o.items.length - 1 : 0;
        const itemLabel = first ? `${first.name || first.sku || 'Item'}${extra > 0 ? ` + ${extra} more` : ''}` : 'Order';
        return (
          <div key={o.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '14px 0', borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{itemLabel}</div>
              <div style={{ fontSize: 12.5, color: TEXT_MUTED, marginTop: 3 }}>
                {o.created_at ? new Date(o.created_at).toLocaleDateString() : ''} · {o.items ? o.items.length : 0} item{o.items && o.items.length === 1 ? '' : 's'} · {money(o.total)}
              </div>
            </div>
            <StatusChip order={o} />
            {o.status_token && (
              <a href={`/shop/order/${o.status_token}`} style={{ fontSize: 12.5, fontWeight: 700, color: RED, textDecoration: 'none' }}>Track</a>
            )}
            {onReorder && first && first.product_id && (
              <button
                onClick={() => onReorder(first.product_id)}
                style={{ fontSize: 12.5, fontWeight: 700, color: NAVY, background: 'none', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Reorder
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectionShell({ eyebrow, title, children }) {
  return (
    <div>
      <p style={displayType(13, { letterSpacing: '0.14em', color: RED, margin: '0 0 4px' })}>{eyebrow}</p>
      <h2 style={displayType('clamp(1.4rem,2.4vw,1.8rem)', { color: NAVY, margin: '0 0 18px' })}>{title}</h2>
      {children}
    </div>
  );
}

function ComingSoon({ text }) {
  return (
    <div style={{ border: `2px dashed ${BORDER}`, borderRadius: 14, padding: '28px 24px', textAlign: 'center', color: TEXT_FAINT, background: '#FBFCFE' }}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{text}</p>
    </div>
  );
}

function StatTile({ value, label, note }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '14px 22px', textAlign: 'center', minWidth: 110 }}>
      <div style={displayType(28, { fontWeight: 700 })}>{value}</div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>{label}</div>
      {note && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>{note}</div>}
    </div>
  );
}

function AccountSignedIn({ section, customer, onCustomerSelect, onReorder }) {
  const [logos, setLogos] = useState(null); // null = not loaded yet
  const [orders, setOrders] = useState(null); // null = not loaded yet
  const logosRef = useRef(null);
  const ordersRef = useRef(null);

  useEffect(() => {
    const ref = section === 'logos' ? logosRef : section === 'orders' ? ordersRef : null;
    if (ref && ref.current) ref.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [section]);

  return (
    <div>
      <section style={{ background: `linear-gradient(120deg, ${NAVY_DARK}, ${NAVY} 60%, #1c2d4f)`, color: '#fff', padding: 'clamp(28px,4vw,48px) 24px', borderRadius: 16, marginBottom: 'clamp(28px,4vw,44px)', position: 'relative', overflow: 'hidden' }}>
        <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: RED_SOFT }} />
        <p style={displayType(13, { letterSpacing: '0.16em', color: RED_SOFT, margin: '0 0 8px' })}>Signed in</p>
        <h1 style={displayType('clamp(1.6rem,3.2vw,2.2rem)', { margin: '0 0 6px' })}>
          {customer ? (customer.name || customer.id) : 'Your team'}
        </h1>
        <p style={{ margin: '0 0 18px', fontSize: 14, color: 'rgba(255,255,255,0.72)' }}>Team Shop account</p>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <StatTile value={logos === null ? '—' : logos.length} label="Saved logos" />
          <StatTile value={orders === null ? '—' : orders.length} label="Orders placed" />
          <StatTile value="—" label="Roster on file" note="Coming soon" />
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 'clamp(24px,3vw,40px)' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <SectionShell eyebrow="Team" title="Your team">
            {customer ? (
              <p style={{ fontSize: 14, color: TEXT_MUTED, margin: '0 0 14px' }}>
                Currently ordering for <strong style={{ color: NAVY }}>{customer.name || customer.id}</strong>.
              </p>
            ) : (
              <p style={{ fontSize: 14, color: TEXT_MUTED, margin: '0 0 14px' }}>Loading your team…</p>
            )}
            {/* Real TeamPicker fetch, not forked — it only renders an actual
                switcher when this coach has more than one team; otherwise it
                renders nothing extra (already auto-selected above). */}
            <TeamPicker onSelect={onCustomerSelect} />
          </SectionShell>
        </div>

        <div ref={logosRef} style={{ gridColumn: '1 / -1' }}>
          <SectionShell eyebrow="On file" title="Saved logos">
            {customer ? (
              <LogoPicker customer={customer} onSelect={() => {}} onLogosChange={setLogos} />
            ) : (
              <p style={{ fontSize: 14, color: TEXT_MUTED }}>Pick a team above to see its saved logos.</p>
            )}
          </SectionShell>
        </div>

        <div ref={ordersRef} style={{ gridColumn: '1 / -1' }}>
          <SectionShell eyebrow="History" title="Recent orders">
            {customer ? (
              <OrdersSection customer={customer} onReorder={onReorder} onOrdersChange={setOrders} />
            ) : (
              <p style={{ fontSize: 14, color: TEXT_MUTED }}>Pick a team above to see its order history.</p>
            )}
          </SectionShell>
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <SectionShell eyebrow="Saved roster" title="Your size run">
            <ComingSoon text="Saved size rosters aren't part of Team Shop yet — TODO(account-roster): no roster feature exists in this storefront chunk to back this section." />
          </SectionShell>
        </div>
      </div>
    </div>
  );
}

export default function AccountPage({ section, customer, onCustomerSelect, onReorder }) {
  return (
    <div style={{ maxWidth: 1200, width: '100%', margin: '0 auto', padding: 'clamp(28px,4vw,56px) 24px clamp(48px,6vw,80px)' }}>
      <div style={{ textAlign: 'center', marginBottom: 'clamp(24px,3vw,36px)' }}>
        <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 8px' })}>Your account</p>
        <h1 style={displayType('clamp(1.8rem,3.6vw,2.4rem)', { color: NAVY, margin: '0 0 8px' })}>Coach sign-in &amp; saved gear</h1>
        <p style={{ fontSize: 14, color: TEXT_MUTED, margin: '0 auto', maxWidth: 480, lineHeight: 1.6 }}>
          Sign in to see your saved logos, your team, and your order history.
        </p>
      </div>
      <CoachGate>
        <AccountSignedIn section={section} customer={customer} onCustomerSelect={onCustomerSelect} onReorder={onReorder} />
      </CoachGate>
    </div>
  );
}
