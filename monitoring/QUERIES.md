# Grafana Cloud queries & alerts — livescore-server

Reference PromQL for building dashboards and alert rules against the metrics this
service exports over OTLP. After the OTLP → Prometheus conversion, OTel dotted
names become underscored, histogram units add a suffix (`s` → `_seconds`) with
`_bucket`/`_count`/`_sum` series, and counters gain `_total`. All series carry
`service_name="livescore-server"`.

Filter every query by environment as needed with
`deployment_environment_name="production"`.

## RED — request rate, errors, duration

```promql
# Request rate by route
sum by (route) (rate(http_server_request_duration_seconds_count[5m]))

# Error ratio (5xx) overall
sum(rate(http_server_request_duration_seconds_count{status_code=~"5.."}[5m]))
  /
sum(rate(http_server_request_duration_seconds_count[5m]))

# p95 latency by route
histogram_quantile(
  0.95,
  sum by (le, route) (rate(http_server_request_duration_seconds_bucket[5m]))
)
```

## Cache effectiveness

```promql
# Hit ratio per cache layer
sum by (cache) (rate(cache_access_total{result="hit"}[5m]))
  /
sum by (cache) (rate(cache_access_total[5m]))

# Requests coalesced onto an in-flight upstream fetch (single-flight protection)
sum(rate(ssi_fetch_coalesced_total[5m]))

# Current cache sizes
cache_entries
```

## Upstream SSI health

```promql
# SSI p95 latency by query kind (full vs incremental)
histogram_quantile(
  0.95,
  sum by (le, kind) (rate(ssi_query_duration_seconds_bucket[5m]))
)

# SSI error rate by kind
sum by (kind) (rate(ssi_query_errors_total[5m]))
```

## Runtime & activity

```promql
process_heap_used_bytes
process_rss_bytes
process_uptime_seconds
hot_matches_active

# Distinct active visitors per sliding window (5m ≈ concurrent, 24h ≈ DAU).
# Counted in-memory server-side; `window` is the only label. With a single
# instance max == sum; if ever scaled out, neither aggregation is exact for a
# distinct count (each instance holds its own set) — prefer a single instance.
max by (window) (active_users)
max(active_users{window="24h"})   # daily active users
max(active_users{window="5m"})    # roughly-concurrent users
```

## Product / behavior analytics

```promql
# Most-used result tab (share of view changes)
sum by (view) (rate(client_event_total{event="view_changed"}[1h]))

# Most-selected division
topk(5, sum by (division) (rate(client_event_total{event="division_selected"}[6h])))

# Most-selected category
topk(5, sum by (category) (rate(client_event_total{event="category_selected"}[6h])))

# How often people exclude stages / start comparisons
sum(rate(client_event_total{event="stages_excluded"}[1h]))
sum(rate(client_event_total{event="comparison_changed"}[1h]))

# Typical comparison size (p50)
histogram_quantile(0.5, sum by (le) (rate(client_comparison_size_bucket[6h])))
```

## Suggested alerts

```promql
# SSI error rate high (>10% of SSI queries failing over 10m)
sum(rate(ssi_query_errors_total[10m]))
  /
sum(rate(ssi_query_duration_seconds_count[10m]))
  > 0.1

# Request p95 latency high (> 2s over 10m)
histogram_quantile(
  0.95,
  sum by (le) (rate(http_server_request_duration_seconds_bucket[10m]))
) > 2

# Response-cache hit ratio collapsed (< 30% over 15m) — indicates cache churn
sum(rate(cache_access_total{cache="response",result="hit"}[15m]))
  /
sum(rate(cache_access_total{cache="response"}[15m]))
  < 0.3
```

> Tip: the OTLP → Prometheus name mapping can vary slightly by Grafana Cloud
> configuration (e.g. a unit namespace). If a series doesn't resolve, confirm the
> exact name in **Explore** — search for `service_name="livescore-server"`.
