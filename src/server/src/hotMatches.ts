/**
 * Hot Matches tracking
 * ====================
 *
 * In-memory, best-effort popularity tracker. Every successful `/parse` request
 * records a hit for its match, keyed by a per-browser visitor id. `getHotMatches`
 * returns the matches with the most *unique visitors* inside a sliding time
 * window, so a landing page can surface the matches people are currently viewing.
 *
 * Notes:
 * - Counting is by unique visitor (best-effort), not raw request volume, so one
 *   person switching divisions or refetching does not inflate the number. The
 *   visitor id is resolved upstream (client-supplied anonymous id, else hashed
 *   IP); this module just dedups on whatever id it is handed.
 * - Storage is in-memory only. A restart clears it; it re-warms as soon as
 *   people load matches again. Events are short-lived so this is acceptable.
 * - Each visitor's last-seen timestamp slides the window forward, so a viewer
 *   who keeps the match open stays counted; one who leaves ages out after ~60 min.
 * - Pruning is lazy (done inside `getHotMatches`), so no background timer is
 *   needed and memory stays bounded by unique visitors per active match.
 */

/** Default sliding window for "recent" hits. */
export const DEFAULT_WINDOW_MS = 60 * 60_000; // 60 minutes
/** Default number of matches returned. */
export const DEFAULT_LIMIT = 12;

interface MatchActivity {
  matchType: string;
  matchId: string;
  eventName: string;
  /** visitorId → last-seen timestamp (ms). Size is the unique-visitor count. */
  visitors: Map<string, number>;
  /** Hit counts per division code, used to pick a concrete default division. */
  divisionHits: Map<string, number>;
}

export interface HotMatch {
  matchType: string;
  matchId: string;
  eventName: string;
  count: number;
  /** Most-fetched concrete division, or 'all' if none stand out. */
  topDivision: string;
}

const activity: Map<string, MatchActivity> = new Map();

function keyFor(matchType: string, matchId: string): string {
  return `${matchType}-${matchId}`;
}

/**
 * Record a hit for a match. Called after a successful parse response.
 *
 * `visitorId` identifies the browser/person (client-supplied anonymous id, else
 * hashed IP, resolved by the caller). Repeat views by the same id only refresh
 * their last-seen timestamp, so they don't inflate the count.
 */
export function recordHit(
  matchType: string,
  matchId: string,
  division: string,
  eventName: string,
  visitorId: string,
  now: number = Date.now(),
): void {
  const key = keyFor(matchType, matchId);
  let entry = activity.get(key);
  if (!entry) {
    entry = {
      matchType,
      matchId,
      eventName,
      visitors: new Map(),
      divisionHits: new Map(),
    };
    activity.set(key, entry);
  }
  entry.visitors.set(visitorId, now);
  if (eventName) entry.eventName = eventName;
  entry.divisionHits.set(division, (entry.divisionHits.get(division) ?? 0) + 1);
}

/** Drop visitors last seen before the cutoff; returns the surviving unique count. */
function pruneVisitors(entry: MatchActivity, cutoff: number): number {
  for (const [id, lastSeen] of entry.visitors) {
    if (lastSeen < cutoff) entry.visitors.delete(id);
  }
  return entry.visitors.size;
}

/** Pick the most-hit concrete division ('all' only if it's the sole option). */
function pickTopDivision(divisionHits: Map<string, number>): string {
  let best: string | null = null;
  let bestCount = 0;
  for (const [div, count] of divisionHits.entries()) {
    if (div === 'all') continue;
    if (count > bestCount) {
      best = div;
      bestCount = count;
    }
  }
  return best ?? 'all';
}

/**
 * Return the hottest matches within the window, sorted by unique-visitor count
 * desc. Prunes stale visitors and drops matches that have gone cold.
 */
export function getHotMatches(
  limit: number = DEFAULT_LIMIT,
  windowMs: number = DEFAULT_WINDOW_MS,
  now: number = Date.now(),
): HotMatch[] {
  const cutoff = now - windowMs;
  const result: HotMatch[] = [];

  for (const [key, entry] of activity.entries()) {
    const count = pruneVisitors(entry, cutoff);
    if (count === 0) {
      activity.delete(key);
      continue;
    }
    result.push({
      matchType: entry.matchType,
      matchId: entry.matchId,
      eventName: entry.eventName,
      count,
      topDivision: pickTopDivision(entry.divisionHits),
    });
  }

  result.sort((a, b) => b.count - a.count);
  return result.slice(0, Math.max(0, limit));
}

/** Test helper: clear all tracked activity. */
export function _resetHotMatches(): void {
  activity.clear();
}
