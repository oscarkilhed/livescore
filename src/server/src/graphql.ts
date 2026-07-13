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
  ascore: number;      // A hits (Alpha)
  cscore: number;      // C hits (Charlie)
  dscore: number;      // D hits (Delta)
  miss: number;        // Misses (M) - the actual miss count
  penalty: number;     // No-shoot penalties (NS)
  procedural: number;  // Procedure penalties
  updated?: string;    // ISO 8601 timestamp of last update
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

/**
 * Result from fetching live scores, includes event metadata
 */
export interface LiveScoresResult {
  eventName: string;
  stages: Stage[];
}

/**
 * Raw, division-agnostic event data returned by {@link fetchEventWithCache}:
 * the event name plus every division's untransformed GraphQL stages. Callers
 * apply {@link transformStages} with a division filter to produce a
 * {@link LiveScoresResult}.
 */
export interface CachedEvent {
  eventName: string;
  stages: GraphQLStage[];
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
          cscore
          dscore
          miss
          penalty
          procedural
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
            cscore
            dscore
            miss
            penalty
            procedural
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

/**
 * Default SSI JWT auth mutation (username/password -> token + refresh token).
 * If SSI uses different field names, this can be adapted quickly.
 */
const AUTH_TOKEN_MUTATION_CAMEL = `
mutation TokenAuth($username: String!, $password: String!) {
  tokenAuth(username: $username, password: $password) {
    token
    refreshToken
  }
}
`;

const AUTH_TOKEN_MUTATION_SNAKE = `
mutation TokenAuth($email: String!, $password: String!) {
  token_auth(email: $email, password: $password) {
    token {
      token
    }
    refresh_token {
      token
    }
  }
}
`;

/**
 * Default SSI JWT refresh mutation (refresh token -> new token).
 */
const AUTH_REFRESH_MUTATION_CAMEL = `
mutation RefreshToken($refreshToken: String!) {
  refreshToken(refreshToken: $refreshToken) {
    token
    refreshToken
  }
}
`;

const AUTH_REFRESH_MUTATION_SNAKE = `
mutation RefreshToken($refreshToken: String!, $revokeRefreshToken: Boolean!) {
  refresh_token(refresh_token: $refreshToken, revoke_refresh_token: $revokeRefreshToken) {
    token {
      token
    }
    refresh_token {
      token
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
  // The API provides dedicated fields for each score type:
  // - ascore, cscore, dscore: Hit zone counts (Alpha, Charlie, Delta)
  // - miss: Miss count (M)
  // - penalty: No-shoot penalties (NS)
  // - procedural: Procedure penalties (returned separately, not in hits)
  const hits: Hits = {
    A: Number(scorecard.ascore) || 0,
    C: Number(scorecard.cscore) || 0,
    D: Number(scorecard.dscore) || 0,
    M: Number(scorecard.miss) || 0,     // Direct miss count from API
    NS: Number(scorecard.penalty) || 0, // No-shoot penalties from API
  };
  
  // Procedure count is available directly from the API
  const procedural = Number(scorecard.procedural) || 0;
  
  return {
    name: fullName,
    division: displayDivision,
    powerFactor,
    category: competitor.category,
    hitFactor: Number(scorecard.hitfactor) || 0,
    time: Number(scorecard.time) || 0,
    points: Number(scorecard.points) || 0,
    hits,
    procedures: procedural,  // Procedure count directly from API
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
      procedures: 0, // Stage-level procedures (individual competitor procedures are in competitor.procedures)
    };
  });
}

// ============================================================================
// GraphQL Client
// ============================================================================

interface JwtAuthState {
  accessToken?: string;
  refreshToken?: string;
  expiresAtMs?: number;
}

const jwtAuthState: JwtAuthState = {};

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

  type GenericGraphQLResponse = {
    data?: Record<string, unknown>;
    errors?: Array<{ message: string }>;
  };

  const AUTH_RETRY_MESSAGE = 'User must be authenticated';

  function decodeJwtExpiryMs(token: string): number | undefined {
    try {
      const parts = token.split('.');
      if (parts.length < 2) {
        return undefined;
      }
      const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
      const decoded = Buffer.from(padded, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded) as { exp?: number };
      if (!parsed.exp) {
        return undefined;
      }
      return parsed.exp * 1000;
    } catch {
      return undefined;
    }
  }

  function cacheAccessToken(token?: string, refreshToken?: string): void {
    if (!token) {
      return;
    }
    jwtAuthState.accessToken = token;
    if (refreshToken) {
      jwtAuthState.refreshToken = refreshToken;
    }
    jwtAuthState.expiresAtMs = decodeJwtExpiryMs(token);
  }

  async function executeRawGraphQL(
    queryString: string,
    queryVariables: Record<string, unknown>,
    authHeaderToken?: string,
    authScheme: 'Bearer' | 'JWT' = 'Bearer'
  ): Promise<GenericGraphQLResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-api-key': config.graphqlApiKey,
    };

    if (authHeaderToken) {
      headers.Authorization = `${authScheme} ${authHeaderToken}`;
    }

    if (config.graphqlSessionCookie) {
      headers.Cookie = config.graphqlSessionCookie;
    }

    const fetchPromise = fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: queryString,
        variables: queryVariables,
      }),
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);
    if (!response.ok) {
      throw new GraphQLError(
        `GraphQL HTTP error: ${response.status} ${response.statusText}`,
        response.status
      );
    }

    return response.json() as Promise<GenericGraphQLResponse>;
  }

  function extractAuthPayload(
    json: GenericGraphQLResponse,
    mutationField: 'tokenAuth' | 'token_auth' | 'refreshToken' | 'refresh_token'
  ): { token?: string; refreshToken?: string } | null {
    const data = json.data as Record<string, unknown> | undefined;
    if (!data) {
      return null;
    }
    const value = data[mutationField] as Record<string, unknown> | undefined;
    if (!value) {
      return null;
    }
    const rawToken =
      typeof value.token === 'string'
        ? value.token
        : (value.token as Record<string, unknown> | undefined)?.token;
    const rawRefreshTokenCamel =
      typeof value.refreshToken === 'string'
        ? value.refreshToken
        : (value.refreshToken as Record<string, unknown> | undefined)?.token;
    const rawRefreshTokenSnake =
      typeof value.refresh_token === 'string'
        ? value.refresh_token
        : (value.refresh_token as Record<string, unknown> | undefined)?.token;

    return {
      token: typeof rawToken === 'string' ? rawToken : undefined,
      refreshToken:
        (typeof rawRefreshTokenCamel === 'string' ? rawRefreshTokenCamel : undefined)
        || (typeof rawRefreshTokenSnake === 'string' ? rawRefreshTokenSnake : undefined),
    };
  }

  async function loginWithJwtMutation(): Promise<string | undefined> {
    if (!config.graphqlAuthUsername || !config.graphqlAuthPassword) {
      return undefined;
    }

    const snakeVariables = {
      email: config.graphqlAuthUsername,
      password: config.graphqlAuthPassword,
    };

    const snakeJson = await executeRawGraphQL(AUTH_TOKEN_MUTATION_SNAKE, snakeVariables);
    if (!snakeJson.errors?.length) {
      const payload = extractAuthPayload(snakeJson, 'token_auth');
      cacheAccessToken(payload?.token, payload?.refreshToken);
      return jwtAuthState.accessToken;
    }

    const snakeOnlyFailure = snakeJson.errors.some((e) => e.message.includes("Cannot query field 'token_auth'"));
    if (!snakeOnlyFailure) {
      const messages = snakeJson.errors.map((e) => e.message).join('; ');
      throw new GraphQLError(`GraphQL auth failed: ${messages}`, 401);
    }

    const camelVariables = {
      username: config.graphqlAuthUsername,
      password: config.graphqlAuthPassword,
    };
    const camelJson = await executeRawGraphQL(AUTH_TOKEN_MUTATION_CAMEL, camelVariables);
    if (camelJson.errors?.length) {
      const messages = camelJson.errors.map((e) => e.message).join('; ');
      throw new GraphQLError(`GraphQL auth failed: ${messages}`, 401);
    }

    const payload = extractAuthPayload(camelJson, 'tokenAuth');
    cacheAccessToken(payload?.token, payload?.refreshToken);
    return jwtAuthState.accessToken;
  }

  async function refreshJwtMutation(): Promise<string | undefined> {
    if (!jwtAuthState.refreshToken) {
      return undefined;
    }

    const variables = { refreshToken: jwtAuthState.refreshToken, revokeRefreshToken: false };

    const snakeJson = await executeRawGraphQL(AUTH_REFRESH_MUTATION_SNAKE, variables);
    if (!snakeJson.errors?.length) {
      const payload = extractAuthPayload(snakeJson, 'refresh_token');
      cacheAccessToken(payload?.token, payload?.refreshToken);
      return jwtAuthState.accessToken;
    }

    const snakeOnlyFailure = snakeJson.errors.some((e) => e.message.includes("Cannot query field 'refresh_token'"));
    if (!snakeOnlyFailure) {
      return undefined;
    }

    const camelJson = await executeRawGraphQL(AUTH_REFRESH_MUTATION_CAMEL, variables);
    if (camelJson.errors?.length) {
      return undefined;
    }

    const payload = extractAuthPayload(camelJson, 'refreshToken');
    cacheAccessToken(payload?.token, payload?.refreshToken);
    return jwtAuthState.accessToken;
  }

  async function resolveBearerToken(forceRefresh = false): Promise<string | undefined> {
    if (config.graphqlAuthToken) {
      return config.graphqlAuthToken;
    }

    const hasLoginCreds = Boolean(config.graphqlAuthUsername && config.graphqlAuthPassword);
    if (!hasLoginCreds) {
      return undefined;
    }

    const now = Date.now();
    const refreshSkewMs = 30 * 1000;
    const shouldRefresh =
      forceRefresh
      || !jwtAuthState.accessToken
      || (jwtAuthState.expiresAtMs !== undefined && now >= (jwtAuthState.expiresAtMs - refreshSkewMs));

    if (!shouldRefresh) {
      return jwtAuthState.accessToken;
    }

    const refreshed = await refreshJwtMutation();
    if (refreshed) {
      return refreshed;
    }

    return loginWithJwtMutation();
  }

  async function runMainQuery(authToken?: string, authScheme: 'Bearer' | 'JWT' = 'Bearer'): Promise<T> {
    const json = await executeRawGraphQL(query, variables, authToken, authScheme);

    if (json.errors && json.errors.length > 0) {
      const errorMessages = json.errors.map((e) => e.message).join('; ');
      throw new GraphQLError(`GraphQL errors: ${errorMessages}`, 400);
    }

    if (!json.data) {
      throw new GraphQLError('GraphQL response missing data', 500);
    }

    return json.data as unknown as T;
  }

  try {
    const token = await resolveBearerToken();
    const primaryAuthScheme: 'Bearer' | 'JWT' = config.graphqlAuthToken ? 'Bearer' : 'JWT';

    try {
      return await runMainQuery(token, primaryAuthScheme);
    } catch (error) {
      if (!(error instanceof GraphQLError) || !error.message.includes(AUTH_RETRY_MESSAGE)) {
        throw error;
      }

      // Some SSI setups expect JWT prefix even for externally provided tokens.
      if (config.graphqlAuthToken && primaryAuthScheme === 'Bearer') {
        return await runMainQuery(token, 'JWT');
      }

      // Token may have expired or been revoked; refresh/login and retry once.
      const refreshedToken = await resolveBearerToken(true);
      return await runMainQuery(refreshedToken, 'JWT');
    }
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
 * Fetches an event's raw stages with incremental update support.
 *
 * On first call: Fetches all scorecards and caches them.
 * On subsequent calls: Only fetches scorecards updated since last fetch.
 *
 * Deliberately division-agnostic: the SSI fetch always retrieves every division's
 * scorecards, so callers filter the returned stages per-division via
 * {@link transformStages}. This keeps the fetch (and any burst cache in front of
 * it) keyed by event alone rather than per division.
 *
 * @param contentType - Content type ID (e.g., 22 for IPSC Match)
 * @param eventId - Event/match ID
 * @returns Event name and the raw (untransformed, unfiltered) GraphQL stages
 */
export async function fetchEventWithCache(
  contentType: number,
  eventId: string
): Promise<CachedEvent> {
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
          
          return {
            eventName: mergedEvent.name,
            stages: mergedEvent.stages,
          };
        } else {
          // No updates, just update fetchedAt and return cached data
          cached.fetchedAt = now;
          return {
            eventName: cached.event.name,
            stages: cached.event.stages,
          };
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
  
  return {
    eventName: data.event.name,
    stages: data.event.stages,
  };
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

