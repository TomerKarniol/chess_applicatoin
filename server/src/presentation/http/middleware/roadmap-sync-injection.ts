import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RequestHandler } from 'express';
import { childLogger } from '../../../shared/logger.js';

const log = childLogger({ component: 'roadmap-sync-injection' });

/**
 * The roadmap (home/module hub) folder and file, relative to the static root.
 * This is the only page that must run the per-user progress sync.
 */
const ROADMAP_DIR = 'מסך הפתיחה';
const ROADMAP_FILE = 'index.html';

/**
 * Decoded request paths that resolve to the roadmap document. Matched manually
 * (rather than via an Express route literal) because the folder name is Hebrew
 * with a space, which path-to-regexp / URL decoding handle inconsistently.
 */
const ROADMAP_PATHS: ReadonlySet<string> = new Set([
  `/${ROADMAP_DIR}/${ROADMAP_FILE}`,
  `/${ROADMAP_DIR}/`,
  `/${ROADMAP_DIR}`,
]);

/** True iff the (possibly URL-encoded) request path targets the roadmap. */
function isRoadmapPath(rawPath: string): boolean {
  if (ROADMAP_PATHS.has(rawPath)) return true;
  try {
    return ROADMAP_PATHS.has(decodeURIComponent(rawPath));
  } catch {
    return false;
  }
}

/**
 * The three same-origin scripts that hydrate the `chess_*` localStorage keys
 * from the server before the roadmap paints. Order matters: the API client
 * first, then the progress bridge, then the guard that drives them.
 */
const SYNC_SCRIPTS = [
  '/auth/js/api.js',
  '/auth/js/bridge.js',
  '/auth/js/auth-guard.js',
] as const;

const MARKER = SYNC_SCRIPTS[2]; // auth-guard.js — its presence means already wired.

function buildInjection(): string {
  const tags = SYNC_SCRIPTS.map((src) => `<script src="${src}"></script>`).join('\n');
  return (
    '\n<!-- Per-user progress sync (injected by the server so it cannot be dropped\n' +
    '     by a frontend rewrite). Verifies the session and hydrates chess_* from\n' +
    '     the server before the roadmap paints; without it the map is driven\n' +
    '     purely by this device\'s localStorage and differs per browser/device. -->\n' +
    tags +
    '\n'
  );
}

/**
 * Serve the roadmap document with the progress-sync scripts injected right
 * before `</head>`. Doing this on the server guarantees every device runs the
 * sync regardless of what the (throwaway, frequently-rewritten) frontend HTML
 * happens to contain — which is how the scripts silently went missing and made
 * `baruch_admin` appear locked on fresh/private sessions.
 *
 * Idempotent: if the HTML already references the guard script, it is served
 * unchanged. On any read/parse failure the request falls through to the normal
 * static handler, so the page still loads (just without injection).
 */
export function roadmapSyncInjectionMiddleware(staticRoot: string): RequestHandler {
  const roadmapPath = join(staticRoot, ROADMAP_DIR, ROADMAP_FILE);
  const injection = buildInjection();

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!isRoadmapPath(req.path)) return next();

    readFile(roadmapPath, 'utf8')
      .then((html) => {
        let out = html;
        if (!html.includes(MARKER)) {
          const closeHead = /<\/head>/i;
          if (closeHead.test(html)) {
            out = html.replace(closeHead, `${injection}</head>`);
          } else {
            // No <head> to anchor to — prepend so the scripts still load first.
            out = injection + html;
          }
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        // Never let the document be cached without revalidation: the frontend
        // has no cache-busting, so a stale roadmap would skip the sync again.
        res.setHeader('Cache-Control', 'no-cache');
        res.status(200).send(out);
      })
      .catch((err: unknown) => {
        log.warn({ err, roadmapPath }, 'failed to read roadmap for sync injection; falling through');
        next();
      });
  };
}
