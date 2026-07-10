import React, { useEffect, useRef, useState } from 'react';
import CoachGate from './CoachGate';
import TeamPicker from './TeamPicker';
import LogoPicker from './LogoPicker';
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
//   - Recent orders / Reorder: there is NO order-history endpoint for
//     coaches yet (see TeamShopApp.js's Stage comments) — rendered as an
//     honest "coming soon" shell per the mockup's layout.
//     TODO(account-orders): wire to a real list-my-orders API once one
//     exists. A coach who already has an order confirmation email can still
//     track it at its token-based /shop/order/<status_token> link — that's
//     a different (already-shipped) webstore feature, not this one.
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

function AccountSignedIn({ section, customer, onCustomerSelect }) {
  const [logos, setLogos] = useState(null); // null = not loaded yet
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
          <StatTile value="—" label="Orders placed" note="Coming soon" />
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
            <ComingSoon text="Order history isn't wired up here yet — TODO(account-orders): there's no list-my-orders API for coaches yet. Already have an order? Use the tracking link from your confirmation email." />
          </SectionShell>
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <SectionShell eyebrow="Reorder" title="Reorder a past order">
            <ComingSoon text="Reorder needs order history first — TODO(account-orders): this will let you re-add a past order's lines to your cart in one click once that API exists." />
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

export default function AccountPage({ section, customer, onCustomerSelect }) {
  return (
    <div style={{ maxWidth: 1200, width: '100%', margin: '0 auto', padding: 'clamp(28px,4vw,56px) 24px clamp(48px,6vw,80px)' }}>
      <div style={{ textAlign: 'center', marginBottom: 'clamp(24px,3vw,36px)' }}>
        <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 8px' })}>Your account</p>
        <h1 style={displayType('clamp(1.8rem,3.6vw,2.4rem)', { color: NAVY, margin: '0 0 8px' })}>Coach sign-in &amp; saved gear</h1>
        <p style={{ fontSize: 14, color: TEXT_MUTED, margin: '0 auto', maxWidth: 480, lineHeight: 1.6 }}>
          Sign in to see your saved logos and your team — order history is coming soon.
        </p>
      </div>
      <CoachGate>
        <AccountSignedIn section={section} customer={customer} onCustomerSelect={onCustomerSelect} />
      </CoachGate>
    </div>
  );
}
