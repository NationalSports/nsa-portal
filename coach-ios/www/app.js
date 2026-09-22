/* NSA Team Portal — native app-shell logic.
 *
 * This file is deliberately dependency-free vanilla JS so the webDir can be
 * served as-is (no bundler). When running inside the native app, Capacitor
 * injects `window.Capacitor` and registers the installed native plugins on
 * `Capacitor.Plugins.*`; on the plain web (PWA / browser preview) that global
 * is absent, so every native call is feature-detected with a web fallback.
 *
 * Flow: the launched app has no `?portal=<tag>` (that only lives on the
 * emailed link), so we resolve a team tag from — in priority order — a deep
 * link, this page's own query string (PWA), or the last team the coach saved,
 * then load the hosted coach portal in embed mode inside an iframe.
 */
(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────
  // Origin that actually serves the coach portal. Matches the iframe src the
  // marketing site's /coach page uses (see nsa-website/public/coach.html).
  var PORTAL_ORIGIN = 'https://nsa-portal.netlify.app';
  var MARKETING_ORIGIN = 'https://nationalsportsapparel.com';
  // Brand catalog hub (nsa-website/public/catalog/index.html) and the endpoint
  // that emails photos to the team's rep (netlify/functions/coach-send-rep-image.js).
  var CATALOG_URL = MARKETING_ORIGIN + '/catalog/';
  var SEND_IMAGE_URL = PORTAL_ORIGIN + '/.netlify/functions/coach-send-rep-image';
  // Custom URL scheme registered in the iOS app (Info.plist). Links like
  // nsateam://open?portal=<tag> open the app directly. Universal Links on
  // nationalsportsapparel.com/coach?portal=<tag> are handled the same way.
  var APP_SCHEME = 'nsateam';
  var STORE_KEY = 'nsa_team_tag';
  // Push registration is scaffolded but OFF until the backend (APNs key +
  // device-token table + sender) is in place — see coach-ios/README.md.
  var ENABLE_PUSH = false;

  // ── Capacitor helpers (feature-detected) ──────────────────────────
  var Cap = window.Capacitor || null;
  var isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  function plugin(name) { return (Cap && Cap.Plugins && Cap.Plugins[name]) || null; }

  function prefGet(key) {
    var Preferences = plugin('Preferences');
    if (Preferences) {
      return Preferences.get({ key: key }).then(function (r) { return r && r.value; }).catch(function () { return null; });
    }
    try { return Promise.resolve(window.localStorage.getItem(key)); } catch (e) { return Promise.resolve(null); }
  }
  function prefSet(key, value) {
    var Preferences = plugin('Preferences');
    if (Preferences) { return Preferences.set({ key: key, value: value }).catch(function () {}); }
    try { window.localStorage.setItem(key, value); } catch (e) {}
    return Promise.resolve();
  }
  function hideSplash() { var SplashScreen = plugin('SplashScreen'); if (SplashScreen) { SplashScreen.hide().catch(function () {}); } }
  function setStatusBarLight() {
    var StatusBar = plugin('StatusBar');
    if (StatusBar) {
      // Light content (white glyphs) over the navy top bar.
      if (StatusBar.setStyle) StatusBar.setStyle({ style: 'LIGHT' }).catch(function () {});
    }
  }

  // ── Tag parsing ───────────────────────────────────────────────────
  // Accepts a bare code ("eagles-baseball"), a full portal link, or a deep
  // link, and returns the team tag or null.
  function extractTag(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    if (!s) return null;
    // Custom scheme: nsateam://open?portal=tag  ·  nsateam://tag
    if (s.indexOf(APP_SCHEME + '://') === 0) {
      var afterScheme = s.slice((APP_SCHEME + '://').length);
      var q = afterScheme.indexOf('?');
      if (q !== -1) {
        var fromQuery = readParam(afterScheme.slice(q));
        if (fromQuery) return clean(fromQuery);
      }
      // nsateam://<tag> or nsateam://open/<tag>
      var path = (q === -1 ? afterScheme : afterScheme.slice(0, q)).replace(/^open\/?/, '').replace(/^\/+|\/+$/g, '');
      if (path) return clean(path);
    }
    // Anything with a query string (http/https link or "?portal=tag").
    if (s.indexOf('?') !== -1 || /^https?:\/\//i.test(s)) {
      try {
        var url = /^https?:\/\//i.test(s) ? new URL(s) : new URL('https://x.invalid/' + (s[0] === '?' ? '' : '') + s);
        var fromUrl = url.searchParams.get('portal') || url.searchParams.get('p') || url.searchParams.get('tag');
        if (fromUrl) return clean(fromUrl);
      } catch (e) { /* fall through to bare handling */ }
      var bareQ = readParam(s.slice(s.indexOf('?')));
      if (bareQ) return clean(bareQ);
    }
    // Bare code: keep only tag-safe characters.
    return clean(s);
  }
  function readParam(queryString) {
    try {
      var params = new URLSearchParams(queryString);
      return params.get('portal') || params.get('p') || params.get('tag');
    } catch (e) { return null; }
  }
  function clean(tag) {
    var t = String(tag).trim().replace(/^\/+|\/+$/g, '');
    // Team tags are slug-like. Strip anything else; if nothing valid remains, reject.
    t = t.replace(/[^A-Za-z0-9._-]/g, '');
    return t || null;
  }

  // ── Views ─────────────────────────────────────────────────────────
  var elEntry = document.getElementById('entry');
  var elPortal = document.getElementById('portal');
  var elForm = document.getElementById('teamForm');
  var elInput = document.getElementById('teamInput');
  var elError = document.getElementById('teamError');
  var elRecent = document.getElementById('recentBtn');
  var elFrame = document.getElementById('portalFrame');
  var elFrameLoading = document.getElementById('frameLoading');
  var elTopTeam = document.getElementById('topbarTeam');
  var elRefresh = document.getElementById('refreshBtn');
  var elSwitch = document.getElementById('switchBtn');

  var currentTag = null;

  function portalUrl(tag) {
    return PORTAL_ORIGIN + '/?portal=' + encodeURIComponent(tag) + '&embed=1&app=ios';
  }

  function showError(msg) {
    elError.textContent = msg;
    elError.hidden = false;
    elInput.classList.add('invalid');
  }
  function clearError() { elError.hidden = true; elInput.classList.remove('invalid'); }

  function showEntry(prefillRecent) {
    currentTag = null;
    elPortal.hidden = true;
    elEntry.hidden = false;
    elInput.value = '';
    clearError();
    if (prefillRecent) {
      elRecent.hidden = false;
      elRecent.innerHTML = 'Open <strong>' + escapeHtml(prefillRecent) + '</strong> again';
      elRecent.onclick = function () { openTeam(prefillRecent); };
    } else {
      elRecent.hidden = true;
    }
    setTimeout(function () { try { elInput.focus(); } catch (e) {} }, 350);
  }

  function openTeam(tag) {
    var t = clean(tag);
    if (!t) { showError('That code doesn’t look right. Check the link your rep sent.'); return; }
    currentTag = t;
    prefSet(STORE_KEY, t);
    elEntry.hidden = true;
    elPortal.hidden = false;
    elTopTeam.textContent = t.replace(/[-_.]+/g, ' ').toUpperCase();
    elFrameLoading.classList.remove('hidden');
    elFrame.src = portalUrl(t);
    setStatusBarLight();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Events ────────────────────────────────────────────────────────
  elForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearError();
    var tag = extractTag(elInput.value);
    if (!tag) { showError('Enter your team code or paste your portal link.'); return; }
    openTeam(tag);
  });
  elInput.addEventListener('input', clearError);
  elFrame.addEventListener('load', function () { elFrameLoading.classList.add('hidden'); });
  elRefresh.addEventListener('click', function () {
    if (!currentTag) return;
    elFrameLoading.classList.remove('hidden');
    elFrame.src = portalUrl(currentTag);
  });
  elSwitch.addEventListener('click', function () {
    prefGet(STORE_KEY).then(function (saved) { showEntry(saved || currentTag); });
  });

  // ── Catalogs ───────────────────────────────────────────────────────
  var elCatalogs = document.getElementById('catalogsBtn');
  function openCatalogs() {
    var Browser = plugin('Browser');
    if (Browser && Browser.open) {
      Browser.open({ url: CATALOG_URL, presentationStyle: 'popover' }).catch(function () { window.open(CATALOG_URL, '_blank'); });
    } else {
      window.open(CATALOG_URL, '_blank');
    }
  }
  if (elCatalogs) elCatalogs.addEventListener('click', openCatalogs);

  // ── Send photos to rep ─────────────────────────────────────────────
  var elPhoto = document.getElementById('photoBtn');
  var elRepFile = document.getElementById('repFile');
  var elRepModal = document.getElementById('repModal');
  var elRepThumbs = document.getElementById('repThumbs');
  var elRepNote = document.getElementById('repNote');
  var elRepSub = document.getElementById('repSheetSub');
  var elRepStatus = document.getElementById('repStatus');
  var elRepCancel = document.getElementById('repCancel');
  var elRepMore = document.getElementById('repMore');
  var elRepSend = document.getElementById('repSend');
  var MAX_PHOTOS = 6;
  var repImages = []; // { name, content(base64), dataUrl }

  // Shrink a picked photo in-browser (like catalog-order-request.js) so the
  // payload stays small: longest side ≤ 1600px, JPEG q0.82.
  function downscaleImage(file, maxDim, quality) {
    return new Promise(function (resolve) {
      try {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          URL.revokeObjectURL(url);
          var w = img.width || 1, h = img.height || 1;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      } catch (e) { resolve(null); }
    });
  }
  function updateRepSub() {
    elRepSub.textContent = repImages.length
      ? repImages.length + ' photo' + (repImages.length > 1 ? 's' : '') + ' ready' + (repImages.length >= MAX_PHOTOS ? ' (max)' : '')
      : 'No photos selected';
    elRepSend.disabled = repImages.length === 0;
  }
  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) { return /^image\//.test(f.type); });
    files = files.slice(0, Math.max(0, MAX_PHOTOS - repImages.length));
    if (!files.length) { if (repImages.length) elRepModal.hidden = false; return; }
    var jobs = files.map(function (f) {
      return downscaleImage(f, 1600, 0.82).then(function (dataUrl) {
        if (!dataUrl) return;
        repImages.push({
          name: ((f.name || 'photo').replace(/[^\w.\- ]+/g, '').slice(0, 60) || 'photo') + (/\.(jpe?g|png|heic|webp)$/i.test(f.name || '') ? '' : '.jpg'),
          content: dataUrl.split(',')[1],
          dataUrl: dataUrl,
        });
        var im = document.createElement('img');
        im.className = 'rep-thumb'; im.src = dataUrl; im.alt = '';
        elRepThumbs.appendChild(im);
      });
    });
    Promise.all(jobs).then(function () {
      updateRepSub();
      elRepStatus.hidden = true; elRepStatus.textContent = '';
      elRepModal.hidden = false;
    });
  }
  function resetRepSheet() {
    repImages = []; elRepThumbs.innerHTML = ''; elRepNote.value = '';
    elRepStatus.hidden = true; elRepStatus.textContent = ''; updateRepSub();
  }
  function sendRepImages() {
    if (!repImages.length || !currentTag) return;
    elRepSend.disabled = true;
    elRepStatus.hidden = false; elRepStatus.className = 'rep-status'; elRepStatus.textContent = 'Sending…';
    fetch(SEND_IMAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alpha_tag: currentTag,
        note: (elRepNote.value || '').slice(0, 1200),
        images: repImages.map(function (i) { return { name: i.name, content: i.content }; }),
      }),
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'send failed');
        elRepStatus.className = 'rep-status ok'; elRepStatus.textContent = 'Sent to your rep ✓';
        setTimeout(function () { elRepModal.hidden = true; resetRepSheet(); }, 1200);
      })
      .catch(function () {
        elRepStatus.className = 'rep-status err';
        elRepStatus.textContent = 'Couldn’t send — check your connection and try again.';
        elRepSend.disabled = false;
      });
  }
  function pickPhotos() { if (elRepFile) { elRepFile.value = ''; elRepFile.click(); } }
  if (elPhoto) elPhoto.addEventListener('click', pickPhotos);
  if (elRepMore) elRepMore.addEventListener('click', pickPhotos);
  if (elRepFile) elRepFile.addEventListener('change', function (e) { addFiles(e.target.files); });
  if (elRepCancel) elRepCancel.addEventListener('click', function () { elRepModal.hidden = true; resetRepSheet(); });
  if (elRepSend) elRepSend.addEventListener('click', sendRepImages);

  // ── Deep links ────────────────────────────────────────────────────
  function handleUrl(url) {
    var tag = extractTag(url);
    if (tag) { openTeam(tag); return true; }
    return false;
  }
  function wireDeepLinks() {
    var App = plugin('App');
    if (!App) return;
    // Warm launches: app already open, link tapped.
    App.addListener('appUrlOpen', function (data) { if (data && data.url) handleUrl(data.url); });
    // Cold launches: app opened by a link.
    if (App.getLaunchUrl) {
      App.getLaunchUrl().then(function (res) { if (res && res.url) handleUrl(res.url); }).catch(function () {});
    }
  }

  // ── Push notifications ─────────────────────────────────────────────
  // Fully wired end to end, but gated OFF (ENABLE_PUSH=false) until an APNs key
  // is configured on the portal — so a first launch doesn't ask for permission
  // before there's any notification to deliver. Flip ENABLE_PUSH to true once
  // the backend is live (see coach-ios/PUSH_NOTIFICATIONS.md).
  function postPushToken(deviceToken) {
    if (!deviceToken || !currentTag) return;
    try {
      fetch(PORTAL_ORIGIN + '/.netlify/functions/coach-register-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alpha_tag: currentTag, token: deviceToken, platform: 'ios' }),
      }).catch(function () {});
    } catch (e) {}
  }
  function registerPush() {
    if (!ENABLE_PUSH) return;
    var Push = plugin('PushNotifications');
    if (!Push) return;
    Push.addListener('registration', function (token) { postPushToken(token && token.value); });
    Push.addListener('registrationError', function () { /* non-fatal */ });
    // Tapping a push (e.g. "your order shipped") can carry a portal tag to open.
    Push.addListener('pushNotificationActionPerformed', function (action) {
      var data = action && action.notification && action.notification.data;
      if (data && (data.portal || data.alpha_tag)) openTeam(data.portal || data.alpha_tag);
    });
    Push.requestPermissions().then(function (perm) {
      if (perm && perm.receive === 'granted') { Push.register(); }
    }).catch(function () {});
  }

  // ── Boot ──────────────────────────────────────────────────────────
  function boot() {
    wireDeepLinks();

    // 1) A tag on THIS page's URL wins (PWA opened via /coach?portal=tag, or
    //    a cold-start deep link that Capacitor put on the location).
    var here = null;
    try { here = readParam(window.location.search); } catch (e) {}
    if (here) { openTeam(here); hideSplash(); registerPush(); return; }

    // 2) Otherwise fall back to the last team the coach used.
    prefGet(STORE_KEY).then(function (saved) {
      if (saved) { openTeam(saved); registerPush(); }
      else { showEntry(null); }
      hideSplash();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
