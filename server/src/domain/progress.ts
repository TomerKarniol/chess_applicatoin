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
