/**
 * Tiny same-origin REST client for the chess app.
 *
 * – Always sends cookies (`credentials: 'include'`).
 * – Reads the CSRF cookie set by the server and echoes it in the `X-CSRF-Token`
 *   header on every state-changing request (double-submit pattern).
 * – Returns parsed JSON on 2xx, throws on non-2xx with the server's error envelope.
 *
 * This file is intentionally framework-free so it works for the temporary
 * login/auth-guard glue today and is easy to throw away during the frontend
 * rewrite tomorrow.
 */
(function (global) {
  'use strict';

  const API_BASE = '/api/v1';
  const CSRF_COOKIE = 'chess_csrf';

  function readCookie(name) {
    const all = (document.cookie || '').split('; ');
    for (let i = 0; i < all.length; i++) {
      const eq = all[i].indexOf('=');
      if (eq === -1) continue;
      const k = all[i].slice(0, eq);
      if (k === name) return decodeURIComponent(all[i].slice(eq + 1));
    }
    return null;
  }

  async function ensureCsrf() {
    let token = readCookie(CSRF_COOKIE);
    if (token) return token;
    // The cookie is missing — hit the dedicated endpoint to provoke a Set-Cookie.
    const res = await fetch(API_BASE + '/csrf-token', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to acquire CSRF token (' + res.status + ')');
    const body = await res.json().catch(function () { return {}; });
    token = body.token || readCookie(CSRF_COOKIE);
    if (!token) throw new Error('CSRF token still missing after handshake');
    return token;
  }

  async function request(method, path, body) {
    const headers = { Accept: 'application/json' };
    let payload;
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const upper = method.toUpperCase();
    if (upper !== 'GET' && upper !== 'HEAD' && upper !== 'OPTIONS') {
      headers['X-CSRF-Token'] = await ensureCsrf();
    }
    const res = await fetch(API_BASE + path, {
      method: upper,
      credentials: 'include',
      headers: headers,
      body: payload,
    });
    if (res.status === 204) {
      return { status: 204, ok: true, data: null };
    }
    let data = null;
    try {
      data = await res.json();
    } catch (_e) {
      data = null;
    }
    if (!res.ok) {
      const code = (data && data.error && data.error.code) || 'http_error';
      const message = (data && data.error && data.error.message) || ('HTTP ' + res.status);
      const err = new Error(message);
      err.status = res.status;
      err.code = code;
      err.body = data;
      throw err;
    }
    return { status: res.status, ok: true, data: data };
  }

  global.ChessApi = {
    get: function (path) { return request('GET', path); },
    post: function (path, body) { return request('POST', path, body); },
    put: function (path, body) { return request('PUT', path, body); },
    del: function (path) { return request('DELETE', path); },
    ensureCsrf: ensureCsrf,
    readCookie: readCookie,
  };
}(window));
