# SSI GraphQL API Exploration

## Summary

The ShootnScoreIt (SSI) GraphQL API at `https://shootnscoreit.com/graphql/` can be used to fetch live scores instead of scraping HTML. This document summarizes the findings and provides an implementation plan.

## Current Implementation

The application currently:
- Fetches HTML from: `https://shootnscoreit.com/event/{eventId}/{matchId}/live-scores/?divShown={division}`
- Parses HTML tables using Cheerio to extract:
  - Stage number (from table index)
  - Competitor name, division, power factor
  - Hit factor, time, points
  - Hits breakdown (A, C, D, M, NS)

## GraphQL API Findings

### Endpoint
- **URL**: `https://shootnscoreit.com/graphql/`
- **Method**: POST
- **Content-Type**: `application/json`

### Key Queries

#### 1. Query Event
```graphql
query GetEvent($contentType: Int!, $eventId: String!) {
  event(content_type: $contentType, id: $eventId) {
    id
    name
    uses_stages
    stages {
      id
      number
      name
      scorecards {
        # Scorecard data
      }
    }
  }
}
```

**Parameters:**
- `content_type`: Integer representing the event type (e.g., `22` for IPSC Match)
- `id`: String event/match ID (e.g., `"21833"`)

#### 2. Scorecard Data Structure

Scorecards are accessed via inline fragments since `ScoreCardInterface` is an interface:

```graphql
scorecards {
  id
  ... on IpscScoreCardNode {
    time          # Decimal (4,2 format, max 9999.99)
    points        # Int (calculated: score - deductions)
    hitfactor     # Decimal (7 decimals stored, fewer shown)
    ascore        # Int - A hits
    bscore        # Int - B hits (may map to NS in some contexts)
    cscore        # Int - C hits
    dscore        # Int - D hits
    hscore        # Int - H hits (may map to M misses)
  }
  competitor {
    id
    first_name
    last_name
    number
    ... on IpscCompetitorNode {
      tournament_division  # Division code (5 char)
      category            # Category (comma-separated string)
    }
  }
}
```

### Data Mapping

#### Hits Mapping
The GraphQL API uses different field names than the HTML parser:

| HTML Parser | GraphQL Field | Description |
|------------|---------------|-------------|
| A | `ascore` | Alpha hits |
| C | `cscore` | Charlie hits |
| D | `dscore` | Delta hits |
| M | `hscore` | Misses (H hits) |
| NS | `bscore` | No-shoot hits (B hits) |

#### Division Information
Division information is available through `IpscCompetitorNode` inline fragment:
- `handgun_div`: Division code (e.g., "hg18", "hg1")
- `get_handgun_div_display`: Human-readable division name (e.g., "Production Optics", "Open")

Division code mapping (from actual API data):
| Code | Division |
|------|----------|
| hg1 | Open |
| hg2 | Standard |
| hg3 | Production |
| hg5 | Revolver |
| hg12 | Classic |
| hg18 | Production Optics |

#### Power Factor
Power factor is directly available through:
- `handgun_pf`: Power factor indicator ("-" = Minor, "+" = Major)
- `get_handgun_pf_display`: Human-readable power factor ("Minor", "Major")

### Example Working Query

```graphql
query GetLiveScores($contentType: Int!, $eventId: String!) {
  event(content_type: $contentType, id: $eventId) {
    id
    name
    uses_stages
    stages {
      id
      number
      name
      scorecards {
        id
        ... on IpscScoreCardNode {
          time
          points
          hitfactor
          ascore
          bscore
          cscore
          dscore
          hscore
        }
        competitor {
          id
          first_name
          last_name
          number
          ... on IpscCompetitorNode {
            handgun_div
            handgun_pf
            get_handgun_div_display
            get_handgun_pf_display
            category
          }
        }
      }
    }
  }
}
```

**Variables:**
```json
{
  "contentType": 22,
  "eventId": "21833"
}
```

## Implementation Plan

### Phase 1: Create GraphQL Client Module

1. **Create `src/server/src/graphql.ts`**
   - GraphQL query function
   - Type definitions for GraphQL responses
   - Error handling
   - Query caching (reuse existing cache mechanism)

2. **Key Functions:**
   ```typescript
   async function fetchLiveScoresFromGraphQL(
     eventId: string,
     matchId: string,
     division?: string
   ): Promise<Stage[]>
   ```

### Phase 2: Data Transformation

1. **Create transformation function** to convert GraphQL response to `Stage[]` format:
   - Map GraphQL scorecard data to `Competitor` interface
   - Handle hits mapping (ascore → A, bscore → NS, etc.)
   - Filter by division if specified
   - Infer power factor (may need to check division codes or use default)

2. **Division Filtering:**
   - If `division` parameter is provided, filter scorecards where `competitor.tournament_division` matches
   - Handle division code mapping (e.g., `hg18` → actual division code)

### Phase 3: Integration

1. **Update `src/server/src/index.ts`:**
   - Add new endpoint or modify existing endpoint to support GraphQL
   - Add feature flag to switch between HTML scraping and GraphQL
   - Maintain backward compatibility

2. **Update `src/server/src/cache.ts`:**
   - Extend caching to support GraphQL responses
   - Use same cache key format: `${eventId}-${matchId}-${division}`

### Phase 4: Testing

1. **Unit Tests:**
   - Test GraphQL query construction
   - Test data transformation
   - Test division filtering

2. **Integration Tests:**
   - Compare GraphQL results with HTML scraping results
   - Verify data consistency
   - Test error handling

3. **E2E Tests:**
   - Test full flow with GraphQL API
   - Verify UI displays correctly

### Phase 5: Configuration

1. **Add configuration options:**
   - `USE_GRAPHQL_API`: Feature flag (default: false for backward compatibility)
   - `GRAPHQL_API_URL`: GraphQL endpoint URL
   - `GRAPHQL_TIMEOUT`: Request timeout

2. **Environment Variables:**
   ```env
   USE_GRAPHQL_API=true
   GRAPHQL_API_URL=https://shootnscoreit.com/graphql/
   GRAPHQL_TIMEOUT=15000
   ```

## Open Questions / Issues

1. **Division Code Mapping:** ✅ RESOLVED
   - Division codes are available via `handgun_div` field
   - Display names available via `get_handgun_div_display`
   - Mapping verified: hg1=Open, hg2=Standard, hg3=Production, hg5=Revolver, hg12=Classic, hg18=Production Optics

2. **Power Factor:** ✅ RESOLVED
   - Directly available via `handgun_pf` ("+"/"-") and `get_handgun_pf_display` ("Major"/"Minor")

3. **Hit Mapping Verification:** ⏳ PENDING
   - Verify that `bscore` maps to NS and `hscore` maps to M
   - Need to compare with actual HTML scraping results

4. **Content Type:**
   - Currently hardcoded to `22` (IPSC Match)
   - May need to support other event types in the future

5. **Performance:**
   - GraphQL fetches all scorecards for all divisions
   - Filtering is done in application code
   - Tested with 305 scorecards - performance is acceptable
   - Consider pagination if events grow very large

6. **Error Handling:**
   - GraphQL API timeout can occur (default 15s may not be enough)
   - Recommend increasing timeout to 60s for large events
   - Fallback to HTML scraping is available when `USE_GRAPHQL_API=false`

## Benefits of Using GraphQL

1. **Structured Data**: No HTML parsing needed
2. **Type Safety**: Can use TypeScript types for GraphQL responses
3. **Efficiency**: Fetch only needed fields
4. **Maintainability**: Less brittle than HTML parsing
5. **Future-proof**: API is more stable than HTML structure

## Risks / Considerations

1. **API Changes**: GraphQL schema may change (though more stable than HTML)
2. **Authentication**: May require API keys in the future
3. **Rate Limiting**: Need to respect API limits
4. **Division Filtering**: Less efficient than server-side filtering
5. **Backward Compatibility**: Need to maintain HTML scraping as fallback

## Next Steps

1. ✅ Explore GraphQL API structure
2. ✅ Create GraphQL client module (`src/server/src/graphql.ts`)
3. ✅ Implement data transformation
4. ✅ Add feature flag and integration
5. ⏳ Test and verify data consistency with real API
6. ⏳ Update documentation

## Test Results

Successfully queried event ID `21833` (Oden Cup 2025):
- Retrieved 14 stages
- Each stage has multiple scorecards (e.g., Stage 1 has 305 scorecards)
- Successfully extracted: time, points, hit factor, hits (A, C, D, M, NS)
- Division available via `handgun_div` + `get_handgun_div_display`
- Power factor available via `handgun_pf` + `get_handgun_pf_display`
- Category available via `category` field (e.g., "S" = Senior, "L" = Lady)

Example transformed competitor:
```json
{
  "name": "Gabriel Hübinette",
  "division": "Production Optics",
  "powerFactor": "Minor",
  "category": "S",
  "hitFactor": 4.0700961,
  "time": 35.38,
  "points": 144,
  "hits": {"A": 27, "C": 3, "D": 0, "M": 0, "NS": 0},
  "competitorKey": "1"
}
```

## Implementation

### Files Created/Modified

1. **`src/server/src/graphql.ts`** - GraphQL client module
   - Types for GraphQL responses
   - Query for fetching live scores
   - Data transformation functions
   - Division and power factor detection

2. **`src/server/src/graphql.test.ts`** - Unit tests for GraphQL module
   - Tests for transformation functions
   - Tests for division filtering
   - Tests for power factor detection

3. **`src/server/src/config.ts`** - Added configuration options
   - `useGraphqlApi`: Feature flag (default: false)
   - `graphqlApiUrl`: GraphQL endpoint URL
   - `graphqlTimeout`: Request timeout

4. **`src/server/src/errors.ts`** - Added GraphQLError class

5. **`src/server/src/index.ts`** - Integrated GraphQL API
   - Uses GraphQL when `USE_GRAPHQL_API=true`
   - Falls back to HTML scraping otherwise

### Usage

Enable GraphQL API via environment variable:
```bash
USE_GRAPHQL_API=true GRAPHQL_TIMEOUT=60000 npm start
```

### Incremental Updates

The implementation uses the `updated_after` parameter on `scorecards` to enable efficient polling:

1. **First request**: Fetches all scorecards and caches them with the max `updated` timestamp
2. **Subsequent requests**: Uses `scorecards(updated_after: "<timestamp>")` to only fetch changes
3. **Merges** updated scorecards into cached data

This dramatically improves performance for live score updates:
- Initial fetch: ~30-60 seconds for large events (305 scorecards)
- Incremental update with no changes: ~0.5 seconds
- Incremental update with changes: Only fetches modified scorecards

Cache invalidation:
- Cache entries expire after 10 minutes, triggering a full refresh
- Use `clearGraphQLCache()` to manually clear cache
