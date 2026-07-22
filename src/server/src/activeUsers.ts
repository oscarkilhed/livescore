/**
 * Active users tracking
 * =====================
 *
 * In-memory, best-effort global unique-visitor tracker. Every request that
 * carries a resolved visitor id (parse views, client events) records activity
 * here, keyed by a per-browser visitor id. `getActiveUserCounts` returns how
 * many distinct visitors were seen inside each of a few sliding windows, so a
 * dashboard can show near-concurrent, recent, and daily active users.
 *
 * Relationship to hotMatches: `hotMatches` counts unique visitors *per match*;
 * this module counts unique visitors *across the whole app* (the union), which
 * is what "how many active users do we have" actually asks. They are fed from
 * the same resolved visitor id but kept separate so neither has to reconstruct
 * the other's aggregation.
 *
 * Notes:
 * - Counting is by unique visitor (best-effort), not raw request volume. The
 *   visitor id is resolved upstream (client-supplied anonymous id, else hashed
 *   IP); this module just dedups on whatever id it is handed.
 * - Storage is in-memory only. A restart clears it; it re-warms as people load
 *   matches again. IP-fallback ids also reset on restart (per-boot salt), so
 *   they are slightly undercounted across deploys — client-UUID ids are stable.
 * - Each visitor's last-seen timestamp slides the windows forward, so an active
 *   viewer stays counted and an idle one ages out of the shorter windows first.
 * - Pruning is lazy (done inside `getActiveUserCounts`), so no background timer
 *   is needed. Memory is bounded by the number of distinct visitors within the
 *   widest window (24h ≈ daily active users).
 */

/** Sliding windows exposed as the `window` gauge label. Widest must be last. */
export const ACTIVE_USER_WINDOWS: ReadonlyArray<{ label: string; ms: number }> = [
  { label: '5m', ms: 5 * 60_000 },
  { label: '1h', ms: 60 * 60_000 },
  { label: '24h', ms: 24 * 60 * 60_000 },
];

/** Widest window; entries older than this are pruned and can never be counted. */
const MAX_WINDOW_MS = ACTIVE_USER_WINDOWS[ACTIVE_USER_WINDOWS.length - 1].ms;

/** visitorId → last-seen timestamp (ms). */
const visitors: Map<string, number> = new Map();

/**
 * Record activity for a visitor. Called on any request that resolves a visitor
 * id (parse views and client events). Repeat activity by the same id only
 * refreshes their last-seen timestamp, so it doesn't inflate the count.
 */
export function recordActiveUser(visitorId: string, now: number = Date.now()): void {
  visitors.set(visitorId, now);
}

/**
 * Distinct-visitor counts per sliding window, keyed by the window label. Prunes
 * visitors last seen before the widest window as a side effect (same lazy
 * strategy as hotMatches), so it's safe to call from a metrics gauge callback.
 */
export function getActiveUserCounts(now: number = Date.now()): Record<string, number> {
  const maxCutoff = now - MAX_WINDOW_MS;
  const counts: Record<string, number> = {};
  for (const { label } of ACTIVE_USER_WINDOWS) counts[label] = 0;

  for (const [id, lastSeen] of visitors) {
    if (lastSeen < maxCutoff) {
      visitors.delete(id);
      continue;
    }
    for (const { label, ms } of ACTIVE_USER_WINDOWS) {
      if (lastSeen >= now - ms) counts[label]++;
    }
  }
  return counts;
}

/** Test helper: clear all tracked activity. */
export function _resetActiveUsers(): void {
  visitors.clear();
}
