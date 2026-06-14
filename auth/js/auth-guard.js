/**
 * Auth guard for the roadmap. Runs before the existing roadmap script:
 *
 *   1. Calls the bridge to verify a valid session AND sync per-user progress.
 *   2. On unauthenticated → redirect to /auth/login.html.
 *   3. On any other failure → leave a visible banner and a console error.
 *   4. On success → install the logout button in the header (next to the album
 *      button) and wire the existing reset button to the per-user reset path.
 *
 * The existing roadmap script reads `localStorage.chess_completed` synchronously
 * at DOMContentLoaded. We block the splash/map by hiding the body until the
 * bridge resolves, so the roadmap renders the freshly-synced state.
 */
(function (global) {
  'use strict';

  function hideBody() {
    try {
      const style = document.createElement('style');
      style.id = '__chess_guard_block';
      style.textContent = 'html, body { visibility: hidden !important; }';
      document.documentElement.appendChild(style);
    } catch (_e) {}
  }

  function showBody() {
    try {
      const s = document.getElementById('__chess_guard_block');
      if (s && s.parentNode) s.parentNode.removeChild(s);
    } catch (_e) {}
  }

  function showFatal(message) {
    showBody();
    try {
      const ov = document.createElement('div');
      ov.setAttribute(
        'style',
        'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;' +
          'justify-content:center;background:#060e1a;color:#F4D03F;' +
          'font-family:Nunito,sans-serif;font-size:1.1rem;text-align:center;padding:24px;direction:rtl',
      );
      ov.textContent = message;
      document.body.appendChild(ov);
    } catch (_e) {}
  }

  /**
   * Inject the greeting + logout button into the header. The DOM order is:
   *   albumBtn → greeting → logoutBtn
   * Because the page is RTL, this renders visually as:
   *   [logout] [greeting] [album]
   * which puts the greeting between the two buttons exactly as requested.
   */
  function injectHeaderControls(user) {
    try {
      const albumBtn = document.getElementById('albumBtn');
      if (!albumBtn || !albumBtn.parentNode) return;

      let anchor = albumBtn;

      // Greeting pill — שלום <username>
      if (!document.getElementById('userGreeting') && user && user.username) {
        const greet = document.createElement('span');
        greet.id = 'userGreeting';
        greet.setAttribute(
          'style',
          [
            "font-family:'Fredoka One',cursive",
            'font-size:1.05rem',
            'color:#F4D03F',
            'text-shadow:0 0 10px rgba(244,208,63,.4)',
            'padding:6px 14px',
            'margin-inline-start:8px',
            'border-radius:50px',
            'background:rgba(244,208,63,.08)',
            'border:1.5px solid rgba(244,208,63,.35)',
            'min-height:44px',
            'display:inline-flex',
            'align-items:center',
            'white-space:nowrap',
          ].join(';'),
        );
        greet.textContent = 'שלום ' + user.username + ' 👋';
        anchor.parentNode.insertBefore(greet, anchor.nextSibling);
        anchor = greet;
      }

      // Admin shortcut — visible only for admins, placed between greeting and logout.
      if (user && user.isAdmin && !document.getElementById('adminBtn')) {
        const adminBtn = document.createElement('a');
        adminBtn.id = 'adminBtn';
        adminBtn.className = 'album-btn';
        adminBtn.href = '/admin/';
        adminBtn.style.marginInlineStart = '8px';
        adminBtn.style.textDecoration = 'none';
        adminBtn.textContent = '👑 ניהול';
        anchor.parentNode.insertBefore(adminBtn, anchor.nextSibling);
        anchor = adminBtn;
      }

      // Logout button — placed after the greeting (or after the album btn if greeting was skipped)
      if (!document.getElementById('logoutBtn')) {
        const btn = document.createElement('button');
        btn.id = 'logoutBtn';
        btn.className = 'album-btn';
        btn.style.marginInlineStart = '8px';
        btn.textContent = '👋 צא';
        btn.addEventListener('click', function () {
          if (global.ChessProgressBridge) {
            global.ChessProgressBridge.logoutAndRedirect();
          } else {
            global.location.href = '/auth/login.html';
          }
        });
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      }
    } catch (_e) {}
  }

  /**
   * Replace the legacy reset behavior (which nuked global localStorage) with
   * a per-user server reset. We re-bind the existing button click handler.
   */
  function rewireResetButton() {
    try {
      const oldBtn = document.getElementById('resetBtn');
      if (!oldBtn) return;
      // Clone to drop all previously attached listeners from index.html.
      const btn = oldBtn.cloneNode(true);
      oldBtn.parentNode.replaceChild(btn, oldBtn);

      let confirmStage = false;
      let timer = null;
      btn.textContent = 'איפוס';
      btn.addEventListener('click', async function () {
        if (!confirmStage) {
          confirmStage = true;
          btn.textContent = 'לחץ שוב לאישור';
          timer = setTimeout(function () {
            confirmStage = false;
            btn.textContent = 'איפוס';
          }, 2500);
          return;
        }
        clearTimeout(timer);
        confirmStage = false;
        btn.textContent = 'מאפס…';
        try {
          await global.ChessProgressBridge.resetCurrentUser();
          // Easiest way to get the roadmap to repaint with the empty state:
          // reload the page. Lightweight enough for an explicit reset action.
          global.location.reload();
        } catch (e) {
          btn.textContent = 'איפוס נכשל';
          try { console.error('reset failed', e); } catch (_e) {}
          setTimeout(function () { btn.textContent = 'איפוס'; }, 2500);
        }
      });
    } catch (_e) {}
  }

  /**
   * Re-run the legacy roadmap render after the bridge hydrates localStorage.
   *
   * The legacy index.html ships an inline script that registers an `init()`
   * handler on DOMContentLoaded. That handler reads `chess_completed` from
   * localStorage to decide which stations are unlocked, then paints the map.
   * Because our sync is async, that initial paint can happen BEFORE the
   * server data is available — so we re-invoke the relevant render functions
   * once the bridge completes. They're declared at script scope, so they're
   * available as window properties.
   */
  function reRenderRoadmap() {
    try {
      if (typeof global.loadState === 'function') global.loadState();
      if (typeof global.checkReturn === 'function') global.checkReturn();
      if (typeof global.buildMap === 'function') global.buildMap();
      if (typeof global.updateCount === 'function') global.updateCount();
    } catch (_e) {}
  }

  function whenDomReady(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      // Use a microtask gap so the legacy DOMContentLoaded handler runs first.
      setTimeout(fn, 0);
    } else {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(fn, 0); });
    }
  }

  async function boot() {
    hideBody();
    try {
      const user = await global.ChessProgressBridge.sync();
      showBody();
      whenDomReady(function () {
        reRenderRoadmap();
        injectHeaderControls(user);
        rewireResetButton();
      });
    } catch (err) {
      if (err && (err.status === 401 || err.code === 'unauthenticated')) {
        global.location.replace('/auth/login.html');
        return;
      }
      if (err && err.code === 'setup_required') {
        global.location.replace('/auth/setup.html');
        return;
      }
      try { console.error('auth-guard: sync failed', err); } catch (_e) {}
      showFatal('אירעה שגיאה בטעינת הפרופיל. נסו לרענן או לחזור למסך הכניסה.');
    }
  }

  // Kick off as early as possible (before the legacy DOMContentLoaded handler).
  boot();
}(window));
