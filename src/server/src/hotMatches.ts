/**
 * Hot Matches tracking
 * ====================
 *
 * In-memory, best-effort popularity tracker. Every successful `/parse` request
 * records a hit for its match. `getHotMatches` returns the matches with the most
 * hits inside a sliding time window, so a landing page can surface the matches
 * people are currently looking at.
 *
 * Notes:
 * - Storage is in-memory only. A restart clears it; it re-warms as soon as
 *   people load matches again. Events are short-lived so this is acceptable.
 * - Counting is by raw request volume (not unique people), matching the agreed
 *   metric. There is no client-side polling, so a hit roughly means "a match was
 *   opened/refetched", and the default window is generous (~60 min).
 * - Pruning is lazy (done inside `getHotMatches`), so no background timer is
 *   needed and memory stays bounded by however many matches are active.
 */

/** Default sliding window for "recent" hits. */
export const DEFAULT_WINDOW_MS = 60 * 60_000; // 60 minutes
/** Default number of matches returned. */
export const DEFAULT_LIMIT = 12;

interface MatchActivity {
  matchType: string;
  matchId: string;
  eventName: string;
  /** Timestamps (ms) of recent hits, oldest first. */
  hits: number[];
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
 */
export function recordHit(
  matchType: string,
  matchId: string,
  division: string,
  eventName: string,
  now: number = Date.now(),
): void {
  const key = keyFor(matchType, matchId);
  let entry = activity.get(key);
  if (!entry) {
    entry = {
      matchType,
      matchId,
      eventName,
      hits: [],
      divisionHits: new Map(),
    };
    activity.set(key, entry);
  }
  entry.hits.push(now);
  if (eventName) entry.eventName = eventName;
  entry.divisionHits.set(division, (entry.divisionHits.get(division) ?? 0) + 1);
}

/** Drop hit timestamps older than the window; returns the kept count. */
function pruneHits(entry: MatchActivity, cutoff: number): number {
  // hits is oldest-first, so find the first index still within the window.
  let i = 0;
  while (i < entry.hits.length && entry.hits[i] < cutoff) i++;
  if (i > 0) entry.hits = entry.hits.slice(i);
  return entry.hits.length;
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
 * Return the hottest matches within the window, sorted by recent hit count desc.
 * Prunes stale timestamps and drops matches that have gone cold.
 */
export function getHotMatches(
  limit: number = DEFAULT_LIMIT,
  windowMs: number = DEFAULT_WINDOW_MS,
  now: number = Date.now(),
): HotMatch[] {
  const cutoff = now - windowMs;
  const result: HotMatch[] = [];

  for (const [key, entry] of activity.entries()) {
    const count = pruneHits(entry, cutoff);
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
