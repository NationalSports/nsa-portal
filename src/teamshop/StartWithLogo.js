import React, { useState } from 'react';
import CoachGate from './CoachGate';
import TeamPicker from './TeamPicker';
import LogoPicker from './LogoPicker';
import useCoachSession from './useCoachSession';
import {
  NAVY, RED, RED_SOFT, BORDER, TEXT_MUTED, TEXT_FAINT, GREEN,
  FONT_DISPLAY, displayType,
} from './theme';

// "Start With Your Logo" — the approved Claude Design mockup
// ("Start With Your Logo.dc.html") translated to React. This is the
// destination for every "Start with your logo" CTA (Home hero/footer/popup,
// header/footer CTA) — every path into TeamShopApp's 'order' route is one of
// those CTAs, so this component IS the entry chrome for that route, until the
// coach has picked (or skipped past) a logo and lands in the regular
// catalog/logos/cart nav (rendered by TeamShopApp itself, unchanged).
//
// Mapping decisions (mockup -> existing sub-views):
//   - The mockup's 3-dot stepper (Upload/Details/Done) has no built-in concept
//     of auth — it assumes the visitor is already "in". This app needs two
//     more real prerequisite stages first (coach sign-in, team selection), so
//     the stepper here tracks those instead: Sign in -> Team -> Logo. The
//     mockup's own "Details" step (name the logo + pick a preferred
//     decoration method) has no home in the current flow — decoration method
//     is already chosen per-garment later, in PlacementPicker — so it is
//     intentionally NOT built here (would be a second, disconnected method
//     picker). The mockup's Step 1 (upload/pick-saved) content maps onto the
//     real LogoPicker; its Step 3 ("Done") maps onto DoneScreen below, reusing
//     the same copy/art/CTAs.
//   - CoachGate and TeamPicker are rendered exactly as TeamShopApp already
//     renders them elsewhere — no forked sign-in or team-fetch logic. Only the
//     surrounding hero/stepper/card/live-preview chrome is new.
//   - Anonymous visitors (not signed in yet): the mockup's upload dropzone
//     hero is shown, per the design, but it is inert — LogoHeroTeaser never
//     accepts a real file. Any interaction with it reveals CoachGate's real
//     sign-in form in the same slot. Uploads only ever happen once signed in,
//     through the real LogoPicker.
//   - "Go to account" (mockup Step 3) has no destination yet —
//     TODO(teamshop-nav): inert, matching the convention used for the other
//     not-yet-built nav destinations in TeamShopApp/Home.
//
// props:
//   customer        — the selected order customer/team (or null before TeamPicker resolves)
//   onCustomerSelect — TeamPicker's onSelect (TeamShopApp's setOrderCustomer)
//   onLogoChosen     — called with the picked logo once the coach continues
//                      past the Done screen ("Start shopping") — TeamShopApp
//                      wires this to its existing startPlacementWithLogo, and
//                      flips out of this entry chrome into the regular nav.

const STEP_LABELS = ['Sign in', 'Team', 'Logo'];

function StepDot({ label, num, step }) {
  const done = step > num;
  const current = step === num;
  const hasBar = num < STEP_LABELS.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 'none' }}>
        <div
          style={{
            width: 40, height: 40, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, transition: 'all 200ms ease',
            background: done ? GREEN : (current ? NAVY : BORDER),
            color: done || current ? '#fff' : TEXT_FAINT,
          }}
        >
          {done ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M5 12l5 5L20 6" /></svg>
          ) : num}
        </div>
        <span style={{ ...displayType(12, { letterSpacing: '0.06em' }), color: current || done ? NAVY : TEXT_FAINT }}>{label}</span>
      </div>
      {hasBar && <span aria-hidden="true" style={{ height: 2, flex: 1, margin: '0 6px 26px', background: done ? GREEN : '#E4E8F0' }} />}
    </div>
  );
}

function Stepper({ step }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: 'clamp(28px,3.5vw,40px)', maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
      {STEP_LABELS.map((label, i) => <StepDot key={label} label={label} num={i + 1} step={step} />)}
    </div>
  );
}

// Anonymous-visitor teaser for the mockup's Step-1 upload hero. Purely a
// visual echo of the design — no file input, no saved-logo fetch (there's no
// coach/customer yet to fetch for). Any click reveals the real sign-in form.
function LogoHeroTeaser({ onInteract }) {
  return (
    <div>
      <h2 style={displayType(24, { color: NAVY, margin: '0 0 6px', letterSpacing: '0.01em' })}>Add your logo</h2>
      <p style={{ fontSize: 14, color: TEXT_MUTED, margin: '0 0 22px', lineHeight: 1.55 }}>
        Vector art (.ai, .eps, .svg, .pdf) gives the crispest decoration. High-res PNG works too.*
      </p>
      <button
        type="button"
        onClick={onInteract}
        style={{
          width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, padding: '36px 20px',
          borderRadius: 14, cursor: 'pointer', transition: 'all 160ms ease', background: '#FBFCFE',
          border: `2px dashed #C3CAD8`, fontFamily: 'inherit',
        }}
      >
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={RED} strokeWidth="1.6">
          <path d="M12 16V4m0 0L7 9m5-5l5 5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
        <span style={{ fontWeight: 600, fontSize: 16, color: NAVY }}>Sign in to add your logo</span>
        <span style={{ fontSize: 13, color: TEXT_MUTED }}>Coaches sign in first — your logos stay saved to your account</span>
      </button>
      <p style={{ fontSize: 13, fontWeight: 600, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '26px 0 0' }}>
        Sign in to see your saved team logos
      </p>
    </div>
  );
}

function DoneScreen({ logo, onShopping, onAccount }) {
  return (
    <div style={{ textAlign: 'center', padding: '12px 0' }}>
      <div style={{ width: 64, height: 64, borderRadius: 999, background: '#EAF3EE', border: '1px solid #D4E7DC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.2"><path d="M5 12l5 5L20 6" /></svg>
      </div>
      <h2 style={displayType(26, { color: NAVY, margin: '0 0 10px', letterSpacing: '0.01em' })}>Saved to your account</h2>
      <p style={{ fontSize: 15, color: TEXT_MUTED, margin: '0 auto 26px', maxWidth: 360, lineHeight: 1.6 }}>
        <strong style={{ color: NAVY }}>{(logo && logo.name) || 'Your logo'}</strong> is on file and ready to drop on any gear. It&apos;ll prefill every future order.
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onShopping}
          className="nts-cta-red"
          style={{ background: RED, color: '#fff', fontWeight: 600, fontSize: 16, padding: '15px 28px', borderRadius: 8, textTransform: 'uppercase', letterSpacing: '0.02em', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Start shopping
        </button>
        {/* TODO(teamshop-nav): no account view yet — inert per the mockup's
            "Go to account" CTA until one exists. */}
        <span
          onClick={onAccount}
          style={{ background: 'transparent', color: TEXT_FAINT, fontWeight: 600, fontSize: 16, padding: '15px 26px', border: `1px solid ${BORDER}`, borderRadius: 8, cursor: 'default' }}
        >
          Go to account
        </span>
      </div>
    </div>
  );
}

function LivePreview({ logo }) {
  return (
    <div style={{ background: 'linear-gradient(160deg,#1c2d4f,#192853 60%,#0F1A38)', padding: 'clamp(28px,3.5vw,44px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, position: 'relative', minHeight: 340 }}>
      <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: RED_SOFT }} />
      <span style={{ ...displayType(11, { letterSpacing: '0.14em', color: 'rgba(255,255,255,0.4)' }), position: 'absolute', top: 18, left: 22 }}>Live preview</span>
      <div style={{ position: 'relative', width: 'min(240px,80%)', aspectRatio: '4/5', borderRadius: 12, background: 'linear-gradient(150deg,#22345f,#192853 60%,#0F1A38)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <span aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.25)' }}>
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M8 4l4 2 4-2 4 3-2 4-2-1v10H8V10L6 11 4 7z" /></svg>
        </span>
        {logo && (
          <div style={{ position: 'absolute', top: '28%', left: '34%', transform: 'translate(-50%,-50%)', width: 56, height: 56, borderRadius: 8, background: NAVY, border: '2px dashed rgba(255,255,255,0.55)', boxShadow: '0 2px 6px rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {logo.url ? (
              <img src={logo.url} alt={logo.name || 'Logo'} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: '#fff', fontSize: 28 }}>{((logo.name || '?').trim().charAt(0) || '?').toUpperCase()}</span>
            )}
          </div>
        )}
      </div>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', textAlign: 'center', margin: 0, maxWidth: 240, lineHeight: 1.5 }}>
        {logo ? 'Shown on a navy polo, left chest — placement is adjustable at checkout.' : 'Your logo will appear here once uploaded.'}
      </p>
    </div>
  );
}

export default function StartWithLogo({ customer, onCustomerSelect, onLogoChosen }) {
  const { loading, signedIn } = useCoachSession();
  const [forceGate, setForceGate] = useState(false);
  const [pendingLogo, setPendingLogo] = useState(null);

  if (loading) return null;

  const stage = !signedIn ? 'gate' : !customer ? 'team' : (pendingLogo ? 'done' : 'logo');
  const step = !signedIn ? 1 : !customer ? 2 : 3;

  const goShopping = () => { onLogoChosen && onLogoChosen(pendingLogo); };
  const goAccount = () => { /* TODO(teamshop-nav): no account view yet */ };

  return (
    <div style={{ maxWidth: 1040, width: '100%', margin: '0 auto', padding: 'clamp(28px,4vw,56px) 24px clamp(48px,6vw,80px)' }}>
      <div style={{ textAlign: 'center', marginBottom: 'clamp(28px,3.5vw,44px)' }}>
        <p style={displayType(13, { letterSpacing: '0.16em', color: RED, margin: '0 0 8px' })}>Start with your logo</p>
        <h1 style={displayType('clamp(2rem,4vw,2.8rem)', { color: NAVY, margin: '0 0 10px', letterSpacing: '0.01em' })}>Upload once. Reorder forever.</h1>
        <p style={{ fontSize: 'clamp(15px,1.4vw,17px)', color: TEXT_MUTED, margin: '0 auto', maxWidth: 520, lineHeight: 1.6 }}>
          Drop in your team mark and we&apos;ll keep it on file — ready to place on any gear, any time.
        </p>
      </div>

      <Stepper step={step} />

      <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: '0 6px 20px rgba(15,26,56,0.06)', overflow: 'hidden', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <div style={{ padding: 'clamp(28px,3.5vw,44px)' }}>
          {stage === 'gate' && (
            forceGate ? <CoachGate>{null}</CoachGate> : <LogoHeroTeaser onInteract={() => setForceGate(true)} />
          )}
          {stage !== 'gate' && (
            <CoachGate>
              {stage === 'team' && <TeamPicker onSelect={onCustomerSelect} />}
              {stage === 'logo' && <LogoPicker customer={customer} onSelect={setPendingLogo} />}
              {stage === 'done' && <DoneScreen logo={pendingLogo} onShopping={goShopping} onAccount={goAccount} />}
            </CoachGate>
          )}
        </div>
        <LivePreview logo={pendingLogo} />
      </div>
    </div>
  );
}
