/**
 * GraphQL client for ShootnScoreIt.com API
 * 
 * This module provides an alternative to HTML scraping by using the SSI GraphQL API
 * to fetch live scores data in a structured format.
 */

import fetch from 'node-fetch';
import { Stage, Competitor, Hits } from './types';
import { config } from './config';
import { GraphQLError } from './errors';

// ============================================================================
// GraphQL Types
// ============================================================================

/**
 * GraphQL competitor node from IpscCompetitorNode
 */
export interface GraphQLCompetitor {
  id: string;
  first_name: string;
  last_name: string;
  number: string;
  handgun_div?: string;           // Division code (e.g., "hg18")
  handgun_pf?: string;            // Power factor indicator ("-" = Minor, "+" = Major)
  get_handgun_div_display?: string; // Division display name (e.g., "Production Optics")
  get_handgun_pf_display?: string;  // Power factor display (e.g., "Minor", "Major")
  category?: string;              // Category code (e.g., "S" = Senior, "L" = Lady)
}

/**
 * GraphQL scorecard node from IpscScoreCardNode
 */
export interface GraphQLScorecard {
  id: string;
  time: number;
  points: number;
  hitfactor: number;
  ascore: number;  // A hits (Alpha)
  bscore: number;  // B hits (may map to NS - No Shoot)
  cscore: number;  // C hits (Charlie)
  dscore: number;  // D hits (Delta)
  hscore: number;  // H hits (may map to M - Misses)
  updated?: string; // ISO 8601 timestamp of last update
  competitor: GraphQLCompetitor;
}

/**
 * GraphQL stage node
 */
export interface GraphQLStage {
  id: string;
  number: number;
  name: string;
  scorecards: GraphQLScorecard[];
}

/**
 * GraphQL event node
 */
export interface GraphQLEvent {
  id: string;
  name: string;
  uses_stages: boolean;
  stages: GraphQLStage[];
}

/**
 * GraphQL query response structure
 */
export interface GraphQLResponse {
  data?: {
    event: GraphQLEvent | null;
  };
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}

// ============================================================================
// GraphQL Query
// ============================================================================

/**
 * GraphQL query for fetching live scores (full fetch)
 * Uses inline fragments to access IpscScoreCardNode and IpscCompetitorNode fields
 */
const LIVE_SCORES_QUERY = `
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
          updated
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
`;

/**
 * GraphQL query for fetching incremental updates
 * Uses updated_after parameter to only fetch scorecards modified since last fetch
 */
const LIVE_SCORES_INCREMENTAL_QUERY = `
query GetLiveScoresIncremental($contentType: Int!, $eventId: String!, $updatedAfter: String!) {
  event(content_type: $contentType, id: $eventId) {
    id
    name
    stages {
      id
      number
      name
      ... on IpscStageNode {
        scorecards(updated_after: $updatedAfter) {
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
            updated
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
}
`;

// ============================================================================
// Division Mapping
// ============================================================================

/**
 * Division codes as used in the GraphQL API (handgun_div field)
 * These match the URL division codes used in the application.
 * 
 * Based on actual API data from Oden Cup 2025:
 * - hg1: Open
 * - hg2: Standard
 * - hg3: Production
 * - hg5: Revolver
 * - hg12: Classic
 * - hg18: Production Optics
 */
export const DIVISION_CODES = ['hg1', 'hg2', 'hg3', 'hg5', 'hg12', 'hg18'] as const;

/**
 * Division code to display name mapping
 * Note: The API provides get_handgun_div_display which gives the actual display name,
 * so this is primarily for reference/fallback.
 */
export const DIVISION_DISPLAY_MAP: Record<string, string> = {
  'hg1': 'Open',
  'hg2': 'Standard',
  'hg3': 'Production',
  'hg5': 'Revolver',
  'hg12': 'Classic',
  'hg18': 'Production Optics',
};

// Legacy exports for backward compatibility
export const DIVISION_CODE_MAP = DIVISION_DISPLAY_MAP;
export const DIVISION_NAME_MAP: Record<string, string> = {
  'Open': 'hg1',
  'Standard': 'hg2',
  'Production': 'hg3',
  'Revolver': 'hg5',
  'Classic': 'hg12',
  'Production Optics': 'hg18',
};

// ============================================================================
// Power Factor Detection
// ============================================================================

/**
 * Determines power factor from the GraphQL API response
 * 
 * The API provides:
 * - handgun_pf: "-" for Minor, "+" for Major
 * - get_handgun_pf_display: "Minor" or "Major"
 * 
 * @param handgunPf - The handgun_pf value from GraphQL ("+", "-", or undefined)
 * @param handgunPfDisplay - The get_handgun_pf_display value from GraphQL
 * @returns 'Major' or 'Minor'
 */
export function determinePowerFactor(
  handgunPf?: string,
  handgunPfDisplay?: string
): 'Major' | 'Minor' {
  // First check the display value if available
  if (handgunPfDisplay) {
    if (handgunPfDisplay.toLowerCase() === 'major') return 'Major';
    if (handgunPfDisplay.toLowerCase() === 'minor') return 'Minor';
  }
  
  // Fall back to the code value
  if (handgunPf === '+') return 'Major';
  
  // Default to Minor
  return 'Minor';
}

/**
 * @deprecated Use determinePowerFactor instead
 * Kept for backward compatibility with tests
 */
export function inferPowerFactor(division: string): 'Major' | 'Minor' {
  if (division.endsWith('+')) return 'Major';
  return 'Minor';
}

// ============================================================================
// Data Transformation
// ============================================================================

/**
 * Transforms a GraphQL scorecard to a Competitor object
 * 
 * @param scorecard - GraphQL scorecard data
 * @returns Competitor object matching the application's type
 */
export function transformScorecard(scorecard: GraphQLScorecard): Competitor {
  const competitor = scorecard.competitor;
  const fullName = `${competitor.first_name} ${competitor.last_name}`.trim();
  
  // Get division from the display name (preferred) or fall back to code mapping
  const divisionCode = competitor.handgun_div || '';
  const displayDivision = competitor.get_handgun_div_display 
    || DIVISION_DISPLAY_MAP[divisionCode] 
    || divisionCode 
    || 'Unknown';
  
  // Get power factor from the API response
  const powerFactor = determinePowerFactor(
    competitor.handgun_pf,
    competitor.get_handgun_pf_display
  );
  
  // Map GraphQL hit scores to Hits interface
  // Note: bscore -> NS (No Shoot), hscore -> M (Misses)
  // This mapping may need verification with actual data
  const hits: Hits = {
    A: scorecard.ascore || 0,
    C: scorecard.cscore || 0,
    D: scorecard.dscore || 0,
    M: scorecard.hscore || 0,  // H score = Misses
    NS: scorecard.bscore || 0, // B score = No Shoots
  };
  
  return {
    name: fullName,
    division: displayDivision,
    powerFactor,
    category: competitor.category,
    hitFactor: scorecard.hitfactor || 0,
    time: scorecard.time || 0,
    points: scorecard.points || 0,
    hits,
    competitorKey: competitor.number ? String(competitor.number) : `${fullName}|${displayDivision}`,
  };
}

/**
 * Transforms GraphQL stages to the application's Stage[] format
 * 
 * @param stages - Array of GraphQL stage nodes
 * @param divisionFilter - Optional division code to filter by (e.g., 'hg18')
 * @returns Array of Stage objects
 */
export function transformStages(
  stages: GraphQLStage[],
  divisionFilter?: string
): Stage[] {
  // Check if we need to filter by division
  const shouldFilter = divisionFilter && divisionFilter !== 'all';
  
  return stages.map((stage) => {
    let scorecards = stage.scorecards;
    
    // Filter by division at the scorecard level (before transformation)
    // This is more efficient than transforming and then filtering
    if (shouldFilter) {
      scorecards = scorecards.filter((sc) => {
        return sc.competitor.handgun_div === divisionFilter;
      });
    }
    
    const competitors = scorecards.map(transformScorecard);
    
    // Use stage name if provided, fallback to "Stage N"
    const stageName = stage.name && stage.name.trim() !== '' 
      ? stage.name 
      : `Stage ${stage.number}`;
    
    return {
      stage: stage.number,
      stageName,
      competitors,
      procedures: 0, // Not available in GraphQL API
    };
  });
}

// ============================================================================
// GraphQL Client
// ============================================================================

/**
 * Executes a GraphQL query against the SSI API
 * 
 * @param query - GraphQL query string
 * @param variables - Query variables
 * @returns GraphQL response
 * @throws GraphQLError if the request fails
 */
async function executeQuery<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const url = config.graphqlApiUrl;
  const timeout = config.graphqlTimeout;
  
  // Create timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('GraphQL request timeout'));
    }, timeout);
  });
  
  try {
    const fetchPromise = fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });
    
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    
    if (!response.ok) {
      throw new GraphQLError(
        `GraphQL HTTP error: ${response.status} ${response.statusText}`,
        response.status
      );
    }
    
    const json = await response.json() as GraphQLResponse;
    
    // Check for GraphQL errors
    if (json.errors && json.errors.length > 0) {
      const errorMessages = json.errors.map((e) => e.message).join('; ');
      throw new GraphQLError(`GraphQL errors: ${errorMessages}`, 400);
    }
    
    if (!json.data) {
      throw new GraphQLError('GraphQL response missing data', 500);
    }
    
    return json.data as T;
  } catch (error) {
    if (error instanceof GraphQLError) {
      throw error;
    }
    if (error instanceof Error && error.message === 'GraphQL request timeout') {
      throw new GraphQLError(`GraphQL request timeout after ${timeout}ms`, 504, error);
    }
    throw new GraphQLError(
      `GraphQL request failed: ${error instanceof Error ? error.message : String(error)}`,
      503,
      error
    );
  }
}

/**
 * Fetches live scores from the SSI GraphQL API
 * 
 * @param contentType - Content type ID (e.g., 22 for IPSC Match)
 * @param eventId - Event/match ID
 * @param division - Optional division code to filter by (e.g., 'hg18')
 * @returns Array of Stage objects with competitors and scores
 * @throws GraphQLError if the request fails or event is not found
 * 
 * @example
 * ```typescript
 * const stages = await fetchLiveScoresFromGraphQL(22, '21833', 'hg18');
 * ```
 */
export async function fetchLiveScoresFromGraphQL(
  contentType: number,
  eventId: string,
  division?: string
): Promise<Stage[]> {
  const data = await executeQuery<{ event: GraphQLEvent | null }>(
    LIVE_SCORES_QUERY,
    {
      contentType,
      eventId,
    }
  );
  
  if (!data.event) {
    throw new GraphQLError(`Event not found: ${eventId}`, 404);
  }
  
  return transformStages(data.event.stages, division);
}

/**
 * Fetches raw event data from the SSI GraphQL API
 * Useful for exploring the API or debugging
 * 
 * @param contentType - Content type ID
 * @param eventId - Event/match ID
 * @returns Raw GraphQL event data
 */
export async function fetchEventFromGraphQL(
  contentType: number,
  eventId: string
): Promise<GraphQLEvent> {
  const data = await executeQuery<{ event: GraphQLEvent | null }>(
    LIVE_SCORES_QUERY,
    {
      contentType,
      eventId,
    }
  );
  
  if (!data.event) {
    throw new GraphQLError(`Event not found: ${eventId}`, 404);
  }
  
  return data.event;
}

// ============================================================================
// Incremental Update Cache
// ============================================================================

/**
 * Cache entry for GraphQL event data
 */
interface GraphQLCacheEntry {
  event: GraphQLEvent;
  lastUpdated: string;    // ISO 8601 timestamp of the most recent scorecard update
  fetchedAt: number;      // Unix timestamp when this was cached
  lastAccessedAt: number; // Unix timestamp when this was last accessed
}

/**
 * In-memory cache for GraphQL event data
 * Key format: `${contentType}-${eventId}`
 */
const graphqlCache: Map<string, GraphQLCacheEntry> = new Map();

/**
 * Maximum age for cache entries before a full refresh is required
 * Default: 24 hours (competitions typically last 1-2 days)
 * Configurable via config.graphqlCacheMaxAge
 */
const CACHE_MAX_AGE_MS = config.graphqlCacheMaxAge;

/**
 * Maximum time since last access before a cache entry is evicted
 * Default: 1 hour
 * Configurable via config.graphqlCacheIdleEviction
 */
const CACHE_EVICTION_AGE_MS = config.graphqlCacheIdleEviction;

/**
 * Evicts cache entries that haven't been accessed within CACHE_EVICTION_AGE_MS
 */
function evictStaleCacheEntries(): void {
  const now = Date.now();
  const evictionThreshold = now - CACHE_EVICTION_AGE_MS;
  
  for (const [key, entry] of graphqlCache.entries()) {
    if (entry.lastAccessedAt < evictionThreshold) {
      graphqlCache.delete(key);
    }
  }
}

/**
 * Finds the most recent 'updated' timestamp from all scorecards in an event
 */
function findLatestUpdateTimestamp(event: GraphQLEvent): string {
  let latest = '1970-01-01T00:00:00Z';
  
  for (const stage of event.stages) {
    for (const scorecard of stage.scorecards) {
      if (scorecard.updated && scorecard.updated > latest) {
        latest = scorecard.updated;
      }
    }
  }
  
  return latest;
}

/**
 * Merges updated scorecards into the cached event data
 */
function mergeUpdatedScorecards(
  cachedEvent: GraphQLEvent,
  updatedEvent: GraphQLEvent
): GraphQLEvent {
  // Create a map of stage ID to stage for quick lookup
  const stageMap = new Map<string, GraphQLStage>();
  for (const stage of cachedEvent.stages) {
    stageMap.set(stage.id, { ...stage, scorecards: [...stage.scorecards] });
  }
  
  // Merge updated scorecards into each stage
  for (const updatedStage of updatedEvent.stages) {
    const cachedStage = stageMap.get(updatedStage.id);
    if (!cachedStage) {
      // New stage, add it
      stageMap.set(updatedStage.id, updatedStage);
      continue;
    }
    
    // Create a map of scorecard ID to index for quick updates
    const scorecardIndexMap = new Map<string, number>();
    for (let i = 0; i < cachedStage.scorecards.length; i++) {
      scorecardIndexMap.set(cachedStage.scorecards[i].id, i);
    }
    
    // Update or add scorecards
    for (const updatedScorecard of updatedStage.scorecards) {
      const existingIndex = scorecardIndexMap.get(updatedScorecard.id);
      if (existingIndex !== undefined) {
        // Update existing scorecard
        cachedStage.scorecards[existingIndex] = updatedScorecard;
      } else {
        // New scorecard, add it
        cachedStage.scorecards.push(updatedScorecard);
      }
    }
  }
  
  return {
    ...cachedEvent,
    stages: Array.from(stageMap.values()),
  };
}

/**
 * Fetches live scores with incremental update support
 * 
 * On first call: Fetches all scorecards and caches them
 * On subsequent calls: Only fetches scorecards updated since last fetch
 * 
 * @param contentType - Content type ID (e.g., 22 for IPSC Match)
 * @param eventId - Event/match ID
 * @param division - Optional division code to filter by (e.g., 'hg18')
 * @returns Array of Stage objects with competitors and scores
 */
export async function fetchLiveScoresWithCache(
  contentType: number,
  eventId: string,
  division?: string
): Promise<Stage[]> {
  const cacheKey = `${contentType}-${eventId}`;
  const cached = graphqlCache.get(cacheKey);
  const now = Date.now();
  
  // Evict stale entries on each access (lightweight operation)
  evictStaleCacheEntries();
  
  // Check if we have a valid cache entry
  if (cached && (now - cached.fetchedAt) < CACHE_MAX_AGE_MS) {
    // Update last accessed time
    cached.lastAccessedAt = now;
    
    // Try incremental update
    try {
      const data = await executeQuery<{ event: GraphQLEvent | null }>(
        LIVE_SCORES_INCREMENTAL_QUERY,
        {
          contentType,
          eventId,
          updatedAfter: cached.lastUpdated,
        }
      );
      
      if (data.event) {
        // Check if there are any updates
        const hasUpdates = data.event.stages.some(s => s.scorecards.length > 0);
        
        if (hasUpdates) {
          // Merge updates into cached data
          const mergedEvent = mergeUpdatedScorecards(cached.event, data.event);
          const newLastUpdated = findLatestUpdateTimestamp(mergedEvent);
          
          graphqlCache.set(cacheKey, {
            event: mergedEvent,
            lastUpdated: newLastUpdated,
            fetchedAt: now,
            lastAccessedAt: now,
          });
          
          return transformStages(mergedEvent.stages, division);
        } else {
          // No updates, just update fetchedAt and return cached data
          cached.fetchedAt = now;
          return transformStages(cached.event.stages, division);
        }
      }
    } catch (error) {
      // If incremental update fails, fall through to full fetch
      console.warn('Incremental update failed, performing full fetch:', error);
    }
  }
  
  // Full fetch (first time or cache expired)
  const data = await executeQuery<{ event: GraphQLEvent | null }>(
    LIVE_SCORES_QUERY,
    {
      contentType,
      eventId,
    }
  );
  
  if (!data.event) {
    throw new GraphQLError(`Event not found: ${eventId}`, 404);
  }
  
  // Cache the result
  const lastUpdated = findLatestUpdateTimestamp(data.event);
  graphqlCache.set(cacheKey, {
    event: data.event,
    lastUpdated,
    fetchedAt: now,
    lastAccessedAt: now,
  });
  
  return transformStages(data.event.stages, division);
}

/**
 * Clears the GraphQL cache for a specific event or all events
 * 
 * @param contentType - Optional content type ID
 * @param eventId - Optional event ID (if provided with contentType, clears specific entry)
 */
export function clearGraphQLCache(contentType?: number, eventId?: string): void {
  if (contentType !== undefined && eventId !== undefined) {
    graphqlCache.delete(`${contentType}-${eventId}`);
  } else {
    graphqlCache.clear();
  }
}

/**
 * Gets cache statistics for monitoring
 */
export function getGraphQLCacheStats(): {
  size: number;
  evictionAgeMs: number;
  entries: Array<{ key: string; age: number; idleTime: number; scorecardCount: number }>;
} {
  const now = Date.now();
  const entries: Array<{ key: string; age: number; idleTime: number; scorecardCount: number }> = [];
  
  graphqlCache.forEach((entry, key) => {
    const scorecardCount = entry.event.stages.reduce(
      (sum, stage) => sum + stage.scorecards.length,
      0
    );
    entries.push({
      key,
      age: now - entry.fetchedAt,
      idleTime: now - entry.lastAccessedAt,
      scorecardCount,
    });
  });
  
  return {
    size: graphqlCache.size,
    evictionAgeMs: CACHE_EVICTION_AGE_MS,
    entries,
  };
}

