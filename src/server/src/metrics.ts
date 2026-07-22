/**
 * OpenTelemetry metric instruments and typed recording helpers.
 * =============================================================
 *
 * Instruments are created off the global meter. When telemetry is disabled the
 * global provider is a no-op, so these instruments and every `record*` call are
 * cheap no-ops — callers don't need to guard on whether monitoring is enabled.
 *
 * Metric names use OTel dotted convention; when exported to Grafana Cloud's
 * Prometheus via OTLP they become e.g. `http_server_request_duration_seconds`
 * (dots -> underscores, `s` unit -> `_seconds` suffix on histograms).
 */
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('livescore-server');

// --- Instruments -----------------------------------------------------------

const httpDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of inbound HTTP requests',
  unit: 's',
});

const cacheAccess = meter.createCounter('cache.access', {
  description: 'Cache lookups by layer and hit/miss result',
});

const ssiDuration = meter.createHistogram('ssi.query.duration', {
  description: 'Duration of upstream ShootnScoreIt GraphQL queries',
  unit: 's',
});

const ssiErrors = meter.createCounter('ssi.query.errors', {
  description: 'Count of failed upstream ShootnScoreIt GraphQL queries',
});

const coalesced = meter.createCounter('ssi.fetch.coalesced', {
  description: 'Requests served by an already-in-flight upstream fetch (single-flight)',
});

const clientEvent = meter.createCounter('client.event', {
  description: 'Anonymous client behavior events (tab/division/category/exclude/compare)',
});

const clientEventRejected = meter.createCounter('client.event.rejected', {
  description: 'Client events dropped because they failed server-side validation',
});

const excludedStageCount = meter.createHistogram('client.excluded_stage.count', {
  description: 'Number of stages excluded when a user applies a stage exclusion',
});

const comparisonSize = meter.createHistogram('client.comparison.size', {
  description: 'Number of competitors in a comparison when one is active',
});

// --- Types -----------------------------------------------------------------

export type CacheName = 'response' | 'graphql';
export type CacheResult = 'hit' | 'miss';
export type SsiKind = 'full' | 'incremental';
export type SsiOutcome = 'success' | 'error';

/** Normalized, low-cardinality attributes attached to a client behavior event. */
export interface ClientEventAttributes {
  view?: string;
  division?: string;
  category?: string;
}

// --- Recording helpers -----------------------------------------------------

/** Record an inbound HTTP request's latency, labeled by method/route/status. */
export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  seconds: number,
): void {
  httpDuration.record(seconds, { method, route, status_code: statusCode });
}

/** Record a cache lookup outcome for a given layer. */
export function recordCacheAccess(cache: CacheName, result: CacheResult): void {
  cacheAccess.add(1, { cache, result });
}

/** Record an upstream SSI query's latency and outcome. Bumps the error counter on failure. */
export function recordSsiQuery(kind: SsiKind, outcome: SsiOutcome, seconds: number): void {
  ssiDuration.record(seconds, { kind, outcome });
  if (outcome === 'error') {
    ssiErrors.add(1, { kind });
  }
}

/** Record that a request was coalesced onto an in-flight upstream fetch. */
export function recordCoalesced(): void {
  coalesced.add(1);
}

/**
 * Record a validated client behavior event. `event` and the attributes are
 * expected to already be normalized to fixed enums by the caller, keeping label
 * cardinality bounded.
 */
export function recordClientEvent(event: string, attrs: ClientEventAttributes = {}): void {
  const labels: Record<string, string> = { event };
  if (attrs.view) labels.view = attrs.view;
  if (attrs.division) labels.division = attrs.division;
  if (attrs.category) labels.category = attrs.category;
  clientEvent.add(1, labels);
}

/** Record that a client event was rejected by validation. */
export function recordClientEventRejected(): void {
  clientEventRejected.add(1);
}

/** Record how many stages a user excluded (only when > 0). */
export function recordExcludedStageCount(count: number): void {
  excludedStageCount.record(count);
}

/** Record the size of an active comparison (>= 2 competitors). */
export function recordComparisonSize(size: number): void {
  comparisonSize.record(size);
}

// --- Observable gauges -----------------------------------------------------

/**
 * Data sources for the observable gauges. Injected from `index.ts` to avoid an
 * `index <-> metrics` import cycle (index owns the response cache; graphql and
 * hotMatches own theirs).
 */
export interface GaugeSources {
  responseCacheSize: () => number;
  graphqlCacheSize: () => number;
  hotMatchesActive: () => number;
  /** Distinct active-visitor counts keyed by sliding-window label (e.g. `5m`). */
  activeUserCounts: () => Record<string, number>;
}

let gaugesRegistered = false;

/**
 * Register the observable gauges (cache sizes, active hot matches, process
 * memory/uptime). Idempotent. Reads on each collection interval, so values are
 * always current without any polling of our own.
 */
export function initMetricGauges(sources: GaugeSources): void {
  if (gaugesRegistered) return;
  gaugesRegistered = true;

  const cacheEntries = meter.createObservableGauge('cache.entries', {
    description: 'Current number of entries in each cache layer',
  });
  cacheEntries.addCallback((observer) => {
    observer.observe(sources.responseCacheSize(), { cache: 'response' });
    observer.observe(sources.graphqlCacheSize(), { cache: 'graphql' });
  });

  const hotMatches = meter.createObservableGauge('hot_matches.active', {
    description: 'Number of matches currently tracked as active/hot',
  });
  hotMatches.addCallback((observer) => {
    observer.observe(sources.hotMatchesActive());
  });

  const activeUsers = meter.createObservableGauge('active_users', {
    description: 'Distinct active visitors within a sliding window (label: window)',
  });
  activeUsers.addCallback((observer) => {
    const counts = sources.activeUserCounts();
    for (const [window, count] of Object.entries(counts)) {
      observer.observe(count, { window });
    }
  });

  const heapUsed = meter.createObservableGauge('process.heap_used', {
    description: 'Node.js heap used',
    unit: 'By',
  });
  heapUsed.addCallback((observer) => observer.observe(process.memoryUsage().heapUsed));

  const rss = meter.createObservableGauge('process.rss', {
    description: 'Resident set size',
    unit: 'By',
  });
  rss.addCallback((observer) => observer.observe(process.memoryUsage().rss));

  const uptime = meter.createObservableGauge('process.uptime', {
    description: 'Process uptime',
    unit: 's',
  });
  uptime.addCallback((observer) => observer.observe(process.uptime()));
}
