# NSA Team Portal — iOS app (Capacitor)

This folder turns the existing **coach / team portal** into a native iOS app you
can ship on the App Store (and TestFlight), **without rewriting any of the
portal**. It's a [Capacitor](https://capacitorjs.com/) wrapper: a thin native
shell around a `WKWebView` that loads the same coach portal already running at
`nsa-portal.netlify.app`.

It is **fully isolated from the web app** — its own `package.json`, its own
dependencies. Nothing here touches the CRA build or the Netlify deploy.

---

## Why this approach

The coach portal is a React surface inside the main portal app, reached at
`/?portal=<team-tag>&embed=1` and already embedded (cross-origin) on the
marketing site at `nationalsportsapparel.com/coach`. That means it can be
embedded in a native shell exactly the same way — so the app reuses **100%** of
the portal code and every future portal update ships to the app instantly with
no rebuild.

The native shell adds the things a web page can't:

- A branded **team-code entry screen** (the launched app has no `?portal=<tag>`
  in its URL, so the coach enters/【deep-links】 their team once and it's remembered).
- **Deep links / Universal Links** so an emailed portal link opens the app.
- Home-screen icon, splash, native status bar, safe-area handling.
- A scaffold for **push notifications** (order-status alerts) — see below.

If you'd rather not go through the App Store at all, coaches can already
**"Add to Home Screen"** from their `/coach?portal=<tag>` link — that's live now
via the PWA manifest added to the marketing site (`nsa-website`). The App Store
app and the PWA can coexist.

---

## What's here

```
coach-ios/
├─ capacitor.config.json   # app id, name, allowed hosts, splash/push config
├─ package.json            # Capacitor deps + helper scripts (isolated)
├─ www/                    # the webDir — the native shell (served locally)
│  ├─ index.html           #   team-code entry + portal iframe host
│  ├─ app.js               #   entry/deep-link/persistence/push logic
│  ├─ styles.css           #   NSA-branded, safe-area-aware
│  └─ img/                 #   logo used on the entry screen
├─ assets/                 # source icon/splash for `capacitor-assets` (SEE BELOW)
└─ README.md
```

The `ios/` native project is **not** committed — it's generated on a Mac in step 2.

---

## Prerequisites (must be done on a Mac)

- **macOS + Xcode 15+** (App Store or developer.apple.com).
- **Node 22** (`.nvmrc` at the repo root already pins 22).
- **CocoaPods**: `sudo gem install cocoapods` (or `brew install cocoapods`).
- An **Apple Developer account** ($99/yr) for device installs, push, and the
  App Store. A free account works for simulator-only testing.

Xcode, CocoaPods, and code signing are macOS-only — that final stretch can't be
done from Linux/CI, which is why the `ios/` folder is generated locally.

---

## First build (≈15 minutes)

```bash
cd coach-ios
npm install                 # installs Capacitor (small; isolated from the web app)
npx cap add ios             # generates the native ios/ Xcode project
npm run assets              # (optional) generate app icon + splash — see "Icons"
npx cap sync ios            # copy www/ + install pods
npx cap open ios            # opens Xcode
```

In Xcode: select the **App** target → **Signing & Capabilities** → pick your
Team; the bundle id is `com.nationalsportsapparel.teamportal`. Press ▶ to run on
a simulator or a plugged-in iPhone.

After editing anything in `www/` or `capacitor.config.json`, re-run
`npx cap copy ios` (or `npx cap sync ios` if you changed native deps).

---

## Icons & splash

`npm run assets` uses [`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets)
to generate every icon/splash size from two source files:

- `assets/icon.png` — **1024×1024**, no transparency, no rounded corners.
- `assets/splash.png` — **2732×2732** (and optionally `assets/splash-dark.png`).

⚠️ `assets/logo-source.png` is only the current NSA logo (1899×949) as a
**placeholder**. Drop in a proper square 1024×1024 `assets/icon.png` and a
2732×2732 `assets/splash.png` (navy `#192853` background, centered mark) before
generating store-quality art.

---

## Deep links — open the app from a portal link

Two mechanisms are wired in `www/app.js`; enable whichever you want in Xcode.

**A. Universal Links (recommended)** — `https://nationalsportsapparel.com/coach?portal=<tag>`
opens the app.
1. The association file is already in the marketing repo:
   `nsa-website/public/.well-known/apple-app-site-association`. **Replace `TEAMID`**
   there with your Apple Developer Team ID (found in the developer portal), then
   deploy the site.
2. In Xcode → Signing & Capabilities → **+ Capability → Associated Domains** →
   add `applinks:nationalsportsapparel.com`.
3. Standardize the links reps email on the marketing domain
   (`nationalsportsapparel.com/coach?portal=<tag>`) so the association matches.

**B. Custom URL scheme (simplest fallback)** — `nsateam://open?portal=<tag>`.
In Xcode → target → **Info → URL Types**, add a URL scheme `nsateam`. No domain
verification needed. `app.js` already parses both forms.

---

## Push notifications (scaffolded, OFF by default)

The plumbing is in place but disabled until there's a backend to send pushes.
`www/app.js` has `ENABLE_PUSH = false` and a `registerPush()` that requests
permission, registers, and logs the device token.

To turn it on:
1. Apple Developer → **Keys** → create an **APNs Auth Key** (.p8).
2. Xcode → Signing & Capabilities → **+ Capability → Push Notifications** (and
   **Background Modes → Remote notifications** if you want silent pushes).
3. Store device tokens: POST `{ token, portalTag }` from the `registration`
   listener to a new endpoint (a Supabase edge function fits — the portal
   already uses Supabase) into a `coach_push_tokens` table.
4. Send on order-status changes from your backend via APNs using the .p8 key.
5. Set `ENABLE_PUSH = true` and re-`cap copy ios`.

This is the biggest "detail to figure out" — it needs product decisions
(what triggers a push, opt-in copy) and a small backend, so it's intentionally
left as a clean stub.

---

## App Store review — read before submitting

Apps that are just a website in a webview get rejected under
**Guideline 4.2 (minimum functionality)**. This shell is built to clear that bar,
but lean into it:

- Keep the **native team-code entry screen** (it's real native UI, not the web
  page) and, ideally, **ship push notifications** — that's the native capability
  reviewers look for.
- Fill in **App Privacy** answers (the portal handles orders/payments → declare
  accordingly) and provide a **demo team code** in App Review notes so the
  reviewer can actually get past the entry screen.
- Payments in the portal are **Stripe for physical goods/services**, which is
  allowed outside In-App Purchase — but call this out in review notes so it isn't
  mistaken for digital-content IAP.

If review pushes back, the fastest lever is adding more native surface
(push, native order-status widgets) rather than fighting the guideline.

---

## Changing what the app loads

`www/app.js` → `PORTAL_ORIGIN` (default `https://nsa-portal.netlify.app`).
Point it at a deploy preview or `connect.nationalsportsapparel.com` to test.
Hosts the webview is allowed to navigate to live in `capacitor.config.json`
under `server.allowNavigation`.

## Android (bonus)

The same project can target Android with `npx cap add android` — the `www/`
shell is platform-neutral. Not set up here, but nothing blocks it.
