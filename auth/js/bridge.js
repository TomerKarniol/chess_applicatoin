/**
 * Progress bridge — syncs the existing `chess_*` localStorage keys to/from
 * the server's per-user `user_progress` row at the roadmap boundary.
 *
 * Why a bridge: the 54 legacy stage files all read/write `chess_*` directly.
 * We don't want to refactor them yet. The roadmap (מסך הפתיחה/index.html) is
 * the only navigation entry and exit point, so doing the sync there gives
 * us per-user isolation without touching any stage file.
 *
 * Lifecycle on every roadmap load:
 *   1. Stamp check: if `localStorage.chess_owner_id` matches the logged-in
 *      user, the chess_* keys belong to them (a stage just wrote them).
 *      Upload to the server.
 *   2. Wipe chess_*, then fetch the canonical snapshot and write it back.
 *      Stamp `chess_owner_id` with the current user id.
 *   3. Resolve — existing roadmap code reads chess_completed as usual.
 */
(function (global) {
  'use strict';

  const STAMP_KEY = 'chess_owner_id';

  /**
   * The full list of `chess_*` keys that constitute a user's progress.
   * Keep in sync with the MODULES array in מסך הפתיחה/index.html.
   */
  const PROGRESS_KEYS = [
    'chess_completed',
    'chess_just_completed',
    'chess_cards',
    'chess_rook',
    'chess_bishop',
    'chess_queen',
    'chess_pawn',
    'chess_knight',
    'chess_king',
    'chess_check',
    'chess_defense',
    'chess_checkmate',
    'chess_officers',
    'chess_tofeset',
  ];

  /**
   * Anything starting with `chess_` that isn't a known global setting.
   * Used when wiping leftovers from another user.
   */
  function looksLikeProgressKey(key) {
    if (!key || key.indexOf('chess_') !== 0) return false;
    if (key === 'chess_muted') return false;       // global sound setting
    if (key === 'chess_splash_seen') return false; // session ui flag
    if (key === STAMP_KEY) return false;
    return true;
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_e) { /* quota — non-fatal */ }
  }

  function readStringList(key) {
    const v = readJson(key, []);
    return Array.isArray(v) ? v.filter(function (s) { return typeof s === 'string'; }) : [];
  }

  function snapshotFromLocalStorage() {
    const modules = {};
    const moduleIds = ['rook', 'bishop', 'queen', 'pawn', 'knight', 'king', 'check', 'defense', 'checkmate', 'officers', 'tofeset'];
    for (let i = 0; i < moduleIds.length; i++) {
      const id = moduleIds[i];
      const m = readJson('chess_' + id, null);
      if (m && typeof m === 'object') modules[id] = m;
    }
    return {
      completed: readStringList('chess_completed'),
      cards: readStringList('chess_cards'),
      modules: modules,
      currentModule: null,
    };
  }

  function applySnapshotToLocalStorage(snap) {
    // Wipe progress keys first so a partial snapshot can't leave stale data behind.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (looksLikeProgressKey(k)) {
        localStorage.removeItem(k);
        i--; // length shifted
      }
    }
    writeJson('chess_completed', Array.isArray(snap.completed) ? snap.completed : []);
    writeJson('chess_cards', Array.isArray(snap.cards) ? snap.cards : []);
    if (snap.modules && typeof snap.modules === 'object') {
      const entries = Object.keys(snap.modules);
      for (let i = 0; i < entries.length; i++) {
        const id = entries[i];
        const v = snap.modules[id];
        if (v && typeof v === 'object') writeJson('chess_' + id, v);
      }
    }
  }

  /**
   * Run the bridge. Returns a Promise that resolves with the logged-in user
   * (`{ id, username, isAdmin, ... }`) when the local view matches the server.
   *
   * Throws with `code: 'unauthenticated'` if not logged in.
   * Throws with `code: 'setup_required'` if the user still has `mustChangePassword`
   * set — auth-guard catches this and redirects to /auth/setup.html.
   */
  async function sync() {
    if (!global.ChessApi) throw new Error('ChessApi is not loaded');
    const me = await global.ChessApi.get('/auth/me');
    const user = me.data.user;
    if (!user || typeof user.id !== 'number') {
      throw new Error('Unexpected /me response');
    }
    if (me.data.mustChangePassword) {
      const err = new Error('First-time setup required.');
      err.code = 'setup_required';
      throw err;
    }

    const stamp = localStorage.getItem(STAMP_KEY);
    if (stamp && String(user.id) === stamp) {
      // The local chess_* state belongs to this user — persist it before re-hydrating.
      try {
        const snap = snapshotFromLocalStorage();
        await global.ChessApi.put('/progress', snap);
      } catch (e) {
        // Persist is best-effort; we still rehydrate from the server below.
        try { console.warn('bridge: upload failed, will re-hydrate from server', e); } catch (_e) {}
      }
    }

    const server = await global.ChessApi.get('/progress');
    applySnapshotToLocalStorage(server.data || {});
    localStorage.setItem(STAMP_KEY, String(user.id));
    return user;
  }

  /**
   * Logout helper for the roadmap button: clears the session on the server,
   * wipes local progress so the next user starts clean, redirects to login.
   */
  async function logoutAndRedirect() {
    try { await global.ChessApi.post('/auth/logout'); } catch (_e) {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (looksLikeProgressKey(k)) {
          localStorage.removeItem(k);
          i--;
        }
      }
      localStorage.removeItem(STAMP_KEY);
    } catch (_e) {}
    global.location.href = '/auth/login.html';
  }

  /**
   * Reset the current user's progress (server side) and re-hydrate locally.
   */
  async function resetCurrentUser() {
    if (!global.ChessApi) throw new Error('ChessApi is not loaded');
    await global.ChessApi.post('/progress/reset');
    applySnapshotToLocalStorage({ completed: [], cards: [], modules: {}, currentModule: null });
  }

  global.ChessProgressBridge = {
    sync: sync,
    logoutAndRedirect: logoutAndRedirect,
    resetCurrentUser: resetCurrentUser,
    PROGRESS_KEYS: PROGRESS_KEYS,
  };
}(window));
