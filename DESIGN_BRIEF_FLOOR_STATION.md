# Design Brief: Floor Station → Connect design system

## What this is
Floor Station (`src/floorstation/FloorStation.js`) is a **kiosk** — a tablet zip-tied
next to the embroidery machine / heat press, driven by a barcode scanner. It works,
but it uses an ad-hoc dark palette that drifted from the rest of the NSA Connect
staff portal. Re-skin it so a staff member moving between the desktop portal and the
floor tablet feels one continuous product.

**This is a visual/CSS pass only — do not change data flow, scan logic, RPC calls,
state, or copy.**

## Keep the kiosk ergonomics (these are features, not drift)
- The oversized scan input and the 28px full-width stage button.
- The giant job title + one-glance stage indicator.
- The WRONG-STATION alert and the station picker.
- High contrast, big touch targets. Do NOT shrink this to desk density.

## The fix is palette discipline, not layout
Floor Station is already dark — and Connect's own sidebar is the *same* navy family.
Re-anchor every color to the real Connect tokens so it reads as "Connect, floor edition."

**Connect dark-navy tokens (from the portal's `src/portal.css` sidebar):**
- Page background `#0f172a`
- Raised panels / cards `#1e293b`
- Borders / dividers `#334155`
- Muted text `#94a3b8` → brighter `#e2e8f0`
- **Accent blue `#3b82f6`, brand blue `#60a5fa`** (replace the current `#38bdf8`)

**Status colors — map to Connect's badge semantics so a color means the same thing
on the tablet as on the desktop** (same hues, dark-surface variants):
- success / "received": green off `#166534` / `#22c55e`
- warning / "on order": amber off `#d97706`
- danger / "needed" / not-ready: red off `#dc2626`

**Type:** keep the huge scale, but align the small-label treatment to Connect's
convention — 11–12px, weight 700, uppercase, 0.5–1px letter-spacing.

**The "Not ready to run" message** (art-not-approved / garments-not-in-hand) should
read as a first-class `badge-red`-family banner on the dark surface, not a raw error.

## Connect reference tokens (full set, for consistency)
- Font: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- Radii: cards 10px, buttons/inputs 6px, badges 4px
- Primary blue `#2563eb` (hover `#1d4ed8`), focus ring `#3b82f6`
- Text: primary `#0f172a`, body `#334155`, muted `#64748b`, faint `#94a3b8`

## Deliverable
- Mockups for the scan screen in both states: **job ready** (stage button live) and
  **not ready** (the friendly banner).
- Every color must trace to a Connect token above — nothing invented.
- Behavior, data, and copy stay identical.
