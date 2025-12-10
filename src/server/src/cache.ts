import fetch, { Response } from 'node-fetch';
import { config, buildSsiApiUrl } from './config';
import { FetchError } from './errors';
import parseLivescore from './parser';
import { Stage } from './types';

/**
 * Maximum number of cached entries before eviction
 */
const MAX_CACHE_SIZE = 100;

/**
 * In-memory cache for parsed stages from the SSI API.
 * Key format: `${eventId}-${matchId}-${division}`
 * Value: { stages: Stage[], timestamp: number }
 */
const cache: Record<string, { stages: Stage[]; timestamp: number }> = {};

/**
 * Evicts the oldest cache entry if cache size exceeds MAX_CACHE_SIZE
 */
function evictOldestEntry(): void {
  const entries = Object.entries(cache);
  if (entries.length >= MAX_CACHE_SIZE) {
    // Find and remove the oldest entry (lowest timestamp)
    const oldest = entries.reduce((oldest, current) => 
      cache[current[0]].timestamp < cache[oldest[0]].timestamp ? current : oldest
    );
    delete cache[oldest[0]];
  }
}

/**
 * Fetches a URL with a timeout
 * 
 * Note: node-fetch v2 doesn't natively support AbortController, so we use Promise.race
 * to implement timeout functionality.
 * 
 * @param url - The URL to fetch
 * @param timeoutMs - Timeout in milliseconds (default: 120000)
 * @returns Promise resolving to the Response from node-fetch
 * @throws FetchError if request times out or fails
 */
async function fetchWithTimeout(url: string, timeoutMs: number = 120000): Promise<Response> {
  const startTime = Date.now();
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      const elapsed = Date.now() - startTime;
      console.error(`[SSI API Timeout] Request to ${url} timed out after ${elapsed}ms (timeout: ${timeoutMs}ms)`);
      reject(new Error('Request timeout'));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(url),
      timeoutPromise
    ]);
    const elapsed = Date.now() - startTime;
    console.log(`[SSI API] Successfully fetched ${url} in ${elapsed}ms`);
    return response;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    if (error instanceof Error && error.message === 'Request timeout') {
      console.error(`[SSI API Timeout] Request to ${url} failed after ${elapsed}ms (timeout: ${timeoutMs}ms)`);
      throw new FetchError(`SSI API request timed out after ${timeoutMs}ms. The external API is responding slowly.`, 504, error);
    }
    console.error(`[SSI API Error] Request to ${url} failed after ${elapsed}ms: ${error instanceof Error ? error.message : String(error)}`);
    throw new FetchError(`Network error: ${error instanceof Error ? error.message : String(error)}`, 503, error);
  }
}

/**
 * Export cache for testing purposes (to allow clearing cache in tests)
 */
export const __cache = cache;

/**
 * Fetches and parses stages from the SSI API with caching support.
 * 
 * Cached responses are valid for the duration specified by `config.cacheTtl`.
 * If a cached response exists and is still valid, it is returned immediately.
 * Otherwise, a fresh request is made to the SSI API, parsed, and cached.
 * 
 * @param eventId - The event/type ID from ShootnScoreIt.com
 * @param matchId - The match ID from ShootnScoreIt.com
 * @param division - The division code (e.g., 'hg18' for Production Optics)
 * @returns Promise resolving to parsed stages from the SSI API
 * @throws Error if the HTTP request fails (non-2xx status) or parsing fails
 * 
 * @example
 * ```typescript
 * const stages = await getCachedStages('22', '21833', 'hg18');
 * ```
 */
export async function getCachedStages(eventId: string, matchId: string, division: string): Promise<Stage[]> {
  const cacheKey = `${eventId}-${matchId}-${division}`;
  const cachedData = cache[cacheKey];
  
  if (cachedData && Date.now() - cachedData.timestamp < config.cacheTtl) {
    // Using cached parsed stages
    const cacheAge = Date.now() - cachedData.timestamp;
    console.log(`[Cache] Using cached parsed stages for ${cacheKey} (age: ${Math.round(cacheAge / 1000)}s, ${cachedData.stages.length} stages)`);
    return cachedData.stages;
  }

  // Fetching fresh HTML with timeout
  const url = buildSsiApiUrl(eventId, matchId, division);
  console.log(`[SSI API] Fetching fresh HTML from ${url} (timeout: ${config.fetchTimeout}ms)`);
  const fetchStartTime = Date.now();
  
  try {
    const response = await fetchWithTimeout(url, config.fetchTimeout);
    
    if (!response.ok) {
      const elapsed = Date.now() - fetchStartTime;
      console.error(`[SSI API] Request to ${url} returned ${response.status} ${response.statusText} after ${elapsed}ms`);
      throw new FetchError(
        `Failed to fetch HTML: ${response.status} ${response.statusText}`,
        response.status
      );
    }
    
    const html = await response.text();
    const fetchElapsed = Date.now() - fetchStartTime;
    console.log(`[SSI API] Successfully fetched HTML from ${url} (fetch time: ${fetchElapsed}ms, size: ${html.length} bytes)`);
    
    // Parse the HTML
    const parseStartTime = Date.now();
    const stages = parseLivescore(html);
    const parseElapsed = Date.now() - parseStartTime;
    const totalElapsed = Date.now() - fetchStartTime;
    console.log(`[Parse] Successfully parsed HTML in ${parseElapsed}ms (${stages.length} stages, total time: ${totalElapsed}ms)`);
    
    // Evict oldest entry if cache is full
    evictOldestEntry();
    
    cache[cacheKey] = {
      stages,
      timestamp: Date.now()
    };
    
    return stages;
  } catch (error) {
    const elapsed = Date.now() - fetchStartTime;
    if (error instanceof FetchError && error.statusCode === 504) {
      console.error(`[SSI API Timeout] Failed to fetch ${url} after ${elapsed}ms - timeout exceeded`);
    }
    throw error;
  }
} 