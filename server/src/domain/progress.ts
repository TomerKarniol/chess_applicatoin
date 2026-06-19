/**
 * The per-user progress snapshot. Shape mirrors the legacy `chess_*` localStorage
 * keys so the existing static frontend can keep working without modification.
 *
 *  - `completed` ↔ `localStorage.chess_completed`
 *  - `cards`     ↔ `localStorage.chess_cards`
 *  - `modules`   ↔ `localStorage.chess_<moduleId>` (e.g. `chess_rook`)
 *  - `currentModule` is informational; used to remember where a user was.
 */
export interface ProgressSnapshot {
  completed: string[];
  cards: string[];
  modules: Record<string, unknown>;
  currentModule: string | null;
}

export function emptyProgress(): ProgressSnapshot {
  return { completed: [], cards: [], modules: {}, currentModule: null };
}

/**
 * Every module id, in roadmap order. Mirrors the `MODULES` array in
 * `מסך הפתיחה/index.html`; keep the two in sync. The roadmap unlocks a station
 * when the previous station's id is present in `completed`, so a snapshot whose
 * `completed` holds every id renders the whole map unlocked.
 */
export const ALL_MODULE_IDS = [
  'rook',
  'bishop',
  'queen',
  'pawn',
  'knight',
  'king',
  'officers-game',
  'check',
  'defense',
  'checkmate',
  'tofeset',
] as const;

/**
 * A snapshot that marks every module complete. Used for accounts that are always
 * treated as having finished every lesson so they can review any module from any
 * device without carrying (or being able to lose) per-device progress.
 */
export function fullyCompletedProgress(): ProgressSnapshot {
  return { completed: [...ALL_MODULE_IDS], cards: [], modules: {}, currentModule: null };
}

/**
 * Usernames that ALWAYS see every module unlocked, on any device/browser,
 * regardless of what is stored for them. Enforced at read time so the guarantee
 * survives resets, fresh browsers, un-synced devices, and a clobbered/empty
 * stored row. `baruch_admin` is the seeded showcase account (see SeedService).
 */
export const ALWAYS_UNLOCKED_USERNAMES: ReadonlySet<string> = new Set(['baruch_admin']);

/** True iff this account should always be shown every module as unlocked. */
export function shouldUnlockAllModules(user: { username: string; isAdmin: boolean }): boolean {
  return user.isAdmin || ALWAYS_UNLOCKED_USERNAMES.has(user.username);
}

/**
 * Defensive normalizer — keeps the on-disk JSON well-formed even if a future
 * frontend version drifts. Unknown fields are dropped on purpose.
 */
export function normalizeProgress(input: unknown): ProgressSnapshot {
  const obj = (input && typeof input === 'object' ? (input as Record<string, unknown>) : {}) ?? {};
  const completed = Array.isArray(obj.completed)
    ? obj.completed.filter((v): v is string => typeof v === 'string')
    : [];
  const cards = Array.isArray(obj.cards)
    ? obj.cards.filter((v): v is string => typeof v === 'string')
    : [];
  const modules =
    obj.modules && typeof obj.modules === 'object' && !Array.isArray(obj.modules)
      ? (obj.modules as Record<string, unknown>)
      : {};
  const currentModule = typeof obj.currentModule === 'string' ? obj.currentModule : null;
  return { completed, cards, modules, currentModule };
}
