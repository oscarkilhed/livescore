/**
 * Anonymous, fire-and-forget behavior analytics.
 * ==============================================
 *
 * Sends small UI-interaction events to the server's `/events` endpoint, which
 * turns them into OpenTelemetry counters. These interactions (tab switches,
 * division/category selection, stage exclusion, comparison) never otherwise
 * reach the server — they only live in the URL — so they're reported explicitly.
 *
 * Only anonymous, low-cardinality values are ever sent (no competitor names or
 * other PII). Delivery is best-effort: failures are swallowed so analytics can
 * never affect the UX. `keepalive` lets events survive a navigation/tab close.
 */

// Mirrors the API base resolution used for the `/parse` and `/hot-matches` calls.
const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '/api';

let visitorId = '';

/** Set once at startup so events carry the same anonymous id as `/parse`. */
export function setAnalyticsVisitorId(id: string): void {
  visitorId = id;
}

export type AnalyticsEvent =
  | 'view_changed'
  | 'division_selected'
  | 'category_selected'
  | 'stages_excluded'
  | 'comparison_changed';

export interface AnalyticsProps {
  view?: string;
  division?: string;
  category?: string;
  count?: number;
  size?: number;
}

/** Report a behavior event. Never throws; never blocks. */
export function track(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (visitorId) headers['x-visitor-id'] = visitorId;
    void fetch(`${API_BASE}/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event, props }),
      keepalive: true,
    }).catch(() => {
      /* analytics is best-effort */
    });
  } catch {
    /* analytics must never affect the UX */
  }
}
