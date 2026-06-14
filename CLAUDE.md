# CLAUDE.md — אני מפלצת שחמט! (Chess Monster)

A Hebrew, RTL, kids' chess-learning web app: a static HTML/CSS/JS frontend of staged
lessons, backed by a production-grade Express + SQLite API for authentication and
per-user progress sync.

## ⚠️ Quality bar: backend now, frontend later

**The current frontend is intentionally low-standard, temporary scaffolding.** It exists
only to get the app working end-to-end for testing. Do **not** over-invest in it, hold it
to architectural standards, or refactor it proactively — the entire frontend will be
rewritten in a dedicated pass *after* the app works.

**Right now, focus all engineering quality on the backend (`server/`):** best practices,
clean DDD layering, tests, validation, security. When asked to "make it work," prefer the
smallest frontend change that does the job; save the polish for the planned rewrite.

## Repository layout

- **Lesson modules** — Hebrew-named folders at the repo root, each with a `קבצים/`
  ("files") subfolder of staged HTML: `<topic>-intro.html`, `-stage1.html`, …,
  `-final-exam.html`.
  - `רגלי` pawn · `צריח` rook · `פרש` knight · `רץ חדש` bishop · `מלכה` queen ·
    `מלך` king · `שח למלך` check · `מט` checkmate · `התגוננות משח` check defense ·
    `משחק הקצינים` officers game · `משחקי שחמט` master games (tofeset)
  - `מסך הפתיחה/index.html` — home / module hub; the page users land on after login.
- `auth/` — `login.html`, `setup.html`, `forgot.html`, and `auth/js/api.js`
  (the `window.ChessApi` same-origin REST client; framework-free by design).
- `admin/index.html` — operator admin UI.
- `server/` — the backend (below). This is where the real engineering lives.

## Backend (`server/`)

TypeScript + Express, ESM (`"type":"module"`, so TS imports use `.js` specifiers).
Node ≥ 20. Layered Domain-Driven Design — keep the layering intact:

- `src/domain/` — entities / value types: `user.ts`, `session.ts`, `progress.ts`,
  `reset-code.ts`.
- `src/application/services/` — use cases: `auth.service.ts`, `progress.service.ts`,
  `password-reset.service.ts`, `setup.service.ts`, `admin.service.ts`,
  `env-admin.service.ts`, `email.service.ts`, `password.service.ts`, `seed.service.ts`.
- `src/infrastructure/` — `repositories/` (better-sqlite3) and `db/`
  (`connection.ts`, `migrator.ts`, `migrations/*.sql`).
- `src/presentation/http/` — `app.ts` (composition root), `server.ts` (bootstrap),
  `routes/`, `middleware/`, `validators/` (zod schemas).
- `src/shared/` — `errors.ts` (error envelope), `logger.ts`, `time.ts`.

Stack: Express 4 · better-sqlite3 · argon2 · zod · helmet · express-rate-limit ·
pino / pino-http · nodemailer.

## How the frontend talks to the backend

- The server serves the **repo root** as static files (`STATIC_ROOT` defaults to `..`)
  and the JSON API under `/api/v1`.
- `auth/js/api.js` → `window.ChessApi.{get,post,put,del}`: always sends cookies; uses the
  double-submit CSRF pattern (reads the `chess_csrf` cookie, echoes it as the
  `X-CSRF-Token` header on state-changing requests).
- **Auth**: server-side sessions (HTTP-only session cookie). A separate **env-based
  operator admin** is *not* stored in the DB — its credentials come from `.env` and its
  sessions live in memory (cleared on restart). Password reset uses emailed codes plus a
  short-lived, single-purpose reset session.
- **Progress**: mirrored in `localStorage` (`chess_completed`, `chess_<moduleId>`,
  `chess_officers`, `chess_just_completed`) and synced to `GET/PUT /api/v1/progress`
  (`POST /api/v1/progress/reset` to clear). Progress routes require both auth **and**
  completed first-time setup.
- `/` redirects: no session → `/auth/login.html`; `mustChangePassword` →
  `/auth/setup.html`; otherwise → `/מסך הפתיחה/index.html`.

## Build, run & test (run from `server/`)

```bash
npm run dev            # tsx watch on src/presentation/http/server.ts
npm run build          # tsc + copy migration .sql into dist/
npm start              # run compiled dist/
npm run migrate        # apply DB migrations
npm run seed           # seed data
npm test               # vitest run (unit + integration under tests/)
npm run test:watch
npm run test:coverage
npm run lint           # eslint .   (lint:fix to autofix)
npm run format         # prettier --write .
```

Config via `server/.env` (template: `server/.env.example`). Notable vars: `COOKIE_SECRET`
(**required**, ≥16 chars), `PORT`, `DB_PATH`, `STATIC_ROOT`, `ADMIN_USERNAME` /
`ADMIN_PASSWORD`, `SMTP_*`, and the rate-limit knobs.

## Conventions & guardrails

- **Backend changes**: validate input at the boundary with zod validators; keep the flow
  routes → services → repositories; surface errors through `shared/errors.ts`; add a new
  `migrations/NNN_*.sql` file for any schema change (never edit an applied migration).
- Always run `npm test` and `npm run lint` in `server/` after backend changes, and verify
  `npm run build` succeeds before committing.
- **Frontend**: keep it framework-free and minimal; it's RTL Hebrew. Don't add build
  tooling or dependencies — it's slated for a full rewrite.
- Never commit `server/.env` or `server/data/chess.db` (both gitignored).
