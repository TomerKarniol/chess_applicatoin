# syntax=docker/dockerfile:1
#
# אני מפלצת שחמט! — single-image build.
#
# The Express server in server/ serves BOTH the JSON API and the static Hebrew
# lesson files, which live at the repo root (STATIC_ROOT defaults to ".." — i.e.
# the parent of server/). So the build context MUST be the repo root, and the
# image must contain the whole repo, not just server/.
#
#   Build:  docker build -t chess-app .
#   Run:    docker run -p 3000:3000 \
#             -e COOKIE_SECRET=please-use-a-32+-char-random-secret \
#             -e ADMIN_PASSWORD=change-me \
#             -v chess-data:/data \
#             chess-app
#
# Persistence: SQLite lives at DB_PATH (set to /data/chess.db below). Mount a
# volume at /data or all users + progress are lost when the container is removed.

# ── Stage 1: build the TypeScript backend ────────────────────────────────────
FROM node:20-bookworm-slim AS builder

# better-sqlite3 is a native module; it needs a toolchain to compile at install.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server

# Install with dev deps so tsc is available, leveraging layer caching on lockfile.
COPY server/package.json server/package-lock.json* ./
RUN npm ci

# Compile (tsc + copy migration .sql into dist/), then drop dev deps while
# keeping the already-compiled better-sqlite3 native binary in node_modules.
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ── Stage 2: lean runtime ────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/chess.db \
    STATIC_ROOT=..

WORKDIR /app

# Static frontend: lesson folders, auth/, admin/, מסך הפתיחה/, etc.
# (.dockerignore keeps node_modules / dist / .env / data out of this copy.)
COPY . /app

# Overlay the compiled backend + production node_modules (with the native binary).
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/node_modules ./server/node_modules

# Writable location for the SQLite file; mount a volume here in production.
RUN mkdir -p /data
VOLUME ["/data"]

WORKDIR /app/server
EXPOSE 3000

# Migrations + seed run automatically on boot (see server.ts).
CMD ["node", "dist/presentation/http/server.js"]
