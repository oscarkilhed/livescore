# GraphQL API Migration Guide

This document describes how to integrate the GraphQL API implementation into the target repository.

## Patch File

Apply the patch using:
```bash
git apply 0001-feat-implement-GraphQL-API-for-SSI-live-scores.patch
```

Or with more flexibility for conflicts:
```bash
git apply --3way 0001-feat-implement-GraphQL-API-for-SSI-live-scores.patch
```

## Files Overview

### New Files (should apply cleanly)
- `src/server/src/graphql.ts` - GraphQL client module (736 lines)
- `src/server/src/graphql.test.ts` - Unit tests (391 lines)
- `GRAPHQL_API_EXPLORATION.md` - API documentation

### Modified Files (may need manual review)
- `src/server/src/config.ts` - New config options
- `src/server/src/errors.ts` - New error class
- `src/server/src/index.ts` - Endpoint changes + caching
- `docker-compose.yml` - Environment variables
- `lightsail-deployment.json` - Deployment config
- `DEPLOYMENT.md` - Documentation

---

## Caching Architecture

The implementation uses a **three-layer caching strategy**:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Request Flow                              │
└─────────────────────────────────────────────────────────────────┘

  Client Request
        │
        ▼
┌───────────────────┐
│  Response Cache   │  TTL: 5 seconds (RESPONSE_CACHE_TTL_MS)
│  (in index.ts)    │  Purpose: Batch identical requests from multiple clients
└───────────────────┘
        │ cache miss
        ▼
┌───────────────────┐
│  GraphQL Cache    │  TTL: 3 days (GRAPHQL_CACHE_MAX_AGE_MS)
│  (in graphql.ts)  │  Idle eviction: 1 hour (GRAPHQL_CACHE_IDLE_EVICTION_MS)
│                   │  Purpose: Store parsed Stage[] data per competition
│                   │  Supports incremental updates via updated_after
└───────────────────┘
        │ cache miss or stale
        ▼
┌───────────────────┐
│  GraphQL API      │  shootnscoreit.com/graphql/
│  (external)       │
└───────────────────┘
```

### Layer 1: Response Cache (index.ts)

```typescript
// Short-lived cache for the final JSON response
// Prevents redundant processing when multiple clients poll simultaneously
const responseCache = new Map<string, { stages: Stage[]; timestamp: number }>();
const RESPONSE_CACHE_TTL_MS = config.responseCacheTtl; // Default: 5 seconds

function getCachedResponse(key: string): Stage[] | null {
  const entry = responseCache.get(key);
  if (entry && Date.now() - entry.timestamp < RESPONSE_CACHE_TTL_MS) {
    return entry.stages;
  }
  return null;
}
```

### Layer 2: GraphQL Cache (graphql.ts)

```typescript
interface GraphQLCacheEntry {
  eventData: GraphQLEvent;
  lastUpdatedAt: string;      // ISO timestamp for incremental updates
  lastAccessedAt: number;     // For idle eviction
  scorecardCount: number;
}

const graphqlCache = new Map<string, GraphQLCacheEntry>();

// Configuration
const CACHE_MAX_AGE_MS = config.graphqlCacheMaxAge;           // Default: 3 days
const CACHE_EVICTION_AGE_MS = config.graphqlCacheIdleEviction; // Default: 1 hour
```

**Key features:**
- Stores the full event data (stages + scorecards)
- Uses incremental updates (`updated_after` GraphQL argument) to fetch only changed scorecards
- Evicts entries not accessed within 1 hour
- Full refresh after 3 days

### Layer 3: Legacy HTML Cache (cache.ts)

When `USE_GRAPHQL_API=false`, falls back to HTML scraping with the existing cache.

---

## Configuration

### New Environment Variables

Add these to `src/server/src/config.ts`:

```typescript
export interface ServerConfig {
  // ... existing fields ...
  
  // GraphQL API configuration
  useGraphqlApi: boolean;           // Feature flag
  graphqlApiUrl: string;            // API endpoint
  graphqlTimeout: number;           // Request timeout (ms)
  graphqlCacheMaxAge: number;       // Cache TTL (ms)
  graphqlCacheIdleEviction: number; // Idle eviction time (ms)
  responseCacheTtl: number;         // Response cache TTL (ms)
}

// In getConfig():
useGraphqlApi: process.env.USE_GRAPHQL_API === 'true' || process.env.USE_GRAPHQL_API === '1',
graphqlApiUrl: process.env.GRAPHQL_API_URL || 'https://shootnscoreit.com/graphql/',
graphqlTimeout: parseInt(process.env.GRAPHQL_TIMEOUT || '15000', 10),
graphqlCacheMaxAge: parseInt(process.env.GRAPHQL_CACHE_MAX_AGE_MS || String(3 * 24 * 60 * 60 * 1000), 10),
graphqlCacheIdleEviction: parseInt(process.env.GRAPHQL_CACHE_IDLE_EVICTION_MS || String(60 * 60 * 1000), 10),
responseCacheTtl: parseInt(process.env.RESPONSE_CACHE_TTL_MS || '5000', 10),
```

### Environment Variable Summary

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_GRAPHQL_API` | `false` | Enable GraphQL API (set to `true` for production) |
| `GRAPHQL_API_URL` | `https://shootnscoreit.com/graphql/` | GraphQL endpoint |
| `GRAPHQL_TIMEOUT` | `15000` | Request timeout in ms |
| `GRAPHQL_CACHE_MAX_AGE_MS` | `259200000` (3 days) | Max cache lifetime |
| `GRAPHQL_CACHE_IDLE_EVICTION_MS` | `3600000` (1 hour) | Evict inactive entries |
| `RESPONSE_CACHE_TTL_MS` | `5000` (5 seconds) | Response cache TTL |

---

## Deployment Configuration

### Docker Compose

Add to the server service environment:

```yaml
environment:
  - USE_GRAPHQL_API=${USE_GRAPHQL_API:-true}
  - GRAPHQL_TIMEOUT=${GRAPHQL_TIMEOUT:-15000}
  - GRAPHQL_CACHE_MAX_AGE_MS=${GRAPHQL_CACHE_MAX_AGE_MS:-259200000}
  - GRAPHQL_CACHE_IDLE_EVICTION_MS=${GRAPHQL_CACHE_IDLE_EVICTION_MS:-3600000}
  - RESPONSE_CACHE_TTL_MS=${RESPONSE_CACHE_TTL_MS:-5000}
```

### Lightsail / Container Deployment

Add to container environment:

```json
{
  "USE_GRAPHQL_API": "true",
  "GRAPHQL_TIMEOUT": "15000",
  "GRAPHQL_CACHE_MAX_AGE_MS": "259200000",
  "GRAPHQL_CACHE_IDLE_EVICTION_MS": "3600000",
  "RESPONSE_CACHE_TTL_MS": "5000"
}
```

---

## New Endpoints

### Cache Management

```
DELETE /api/cache/:matchType/:matchId
```
Clears the GraphQL cache for a specific competition.

```
DELETE /api/cache
```
Clears all GraphQL cache entries.

### Health Check Updates

The `/health` endpoint now includes GraphQL cache statistics when `useGraphqlApi` is enabled:

```json
{
  "status": "healthy",
  "graphqlCacheStats": {
    "entryCount": 5,
    "totalScorecards": 1250,
    "oldestEntry": "2025-12-25T10:00:00.000Z",
    "newestEntry": "2025-12-26T14:30:00.000Z"
  }
}
```

---

## Error Handling

New error class in `src/server/src/errors.ts`:

```typescript
export class GraphQLError extends Error {
  constructor(
    message: string,
    public readonly errors?: Array<{ message: string; locations?: unknown; path?: unknown }>
  ) {
    super(message);
    this.name = 'GraphQLError';
  }
}
```

---

## Testing

Run the GraphQL tests:

```bash
cd src/server
npm test -- --testPathPattern=graphql
```

The test suite includes 22 tests covering:
- Power factor determination
- Division mapping
- Scorecard transformation
- Stage transformation with filtering
- Cache management (clearing, eviction)

---

## Rollback

To disable the GraphQL API and revert to HTML scraping:

```bash
USE_GRAPHQL_API=false
```

No code changes required — the feature flag controls the behavior at runtime.

---

## Potential Conflicts

When applying the patch, watch for conflicts in:

1. **`src/server/src/index.ts`** - Main server file may have diverged significantly
   - Key additions: response cache, conditional GraphQL/HTML fetch, cache clearing endpoints
   
2. **`src/server/src/config.ts`** - Config structure may differ
   - Key additions: 6 new GraphQL-related config fields
   
3. **Deployment files** - May have different structure
   - `docker-compose.yml`
   - `lightsail-deployment.json` (or equivalent)

If conflicts occur, use this document to manually integrate the caching logic and configuration.

