import fetch, { Response } from 'node-fetch';
import { config, buildSsiApiUrl } from './config';
import { FetchError } from './errors';

/**
 * Maximum number of cached entries before eviction
 */
const MAX_CACHE_SIZE = 100;

/**
 * In-memory cache for HTML responses from the SSI API.
 * Key format: `${eventId}-${matchId}-${division}`
 * Value: { html: string, timestamp: number }
 */
const cache: Record<string, { html: string; timestamp: number }> = {};

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
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns Promise resolving to the Response from node-fetch
 * @throws FetchError if request times out or fails
 */
async function fetchWithTimeout(url: string, timeoutMs: number = 30000): Promise<Response> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Request timeout'));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(url),
      timeoutPromise
    ]);
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === 'Request timeout') {
      throw new FetchError(`Request timeout after ${timeoutMs}ms`, 504, error);
    }
    throw new FetchError(`Network error: ${error instanceof Error ? error.message : String(error)}`, 503, error);
  }
}

/**
 * Export cache for testing purposes (to allow clearing cache in tests)
 */
export const __cache = cache;

/**
 * Fetches HTML from the SSI API with caching support.
 * 
 * Cached responses are valid for the duration specified by `config.cacheTtl`.
 * If a cached response exists and is still valid, it is returned immediately.
 * Otherwise, a fresh request is made to the SSI API.
 * 
 * @param eventId - The event/type ID from ShootnScoreIt.com
 * @param matchId - The match ID from ShootnScoreIt.com
 * @param division - The division code (e.g., 'hg18' for Production Optics)
 * @returns Promise resolving to the HTML content from the SSI API
 * @throws Error if the HTTP request fails (non-2xx status)
 * 
 * @example
 * ```typescript
 * const html = await getCachedHtml('22', '21833', 'hg18');
 * ```
 */
export async function getCachedHtml(eventId: string, matchId: string, division: string): Promise<string> {
  const cacheKey = `${eventId}-${matchId}-${division}`;
  const cachedData = cache[cacheKey];
  
  if (cachedData && Date.now() - cachedData.timestamp < config.cacheTtl) {
    // Using cached HTML
    return cachedData.html;
  }

  // Fetching fresh HTML with timeout
  const url = buildSsiApiUrl(eventId, matchId, division);
  const response = await fetchWithTimeout(url, config.fetchTimeout);
  
  if (!response.ok) {
    throw new FetchError(
      `Failed to fetch HTML: ${response.status} ${response.statusText}`,
      response.status
    );
  }
  
  const html = await response.text();
  
  // Evict oldest entry if cache is full
  evictOldestEntry();
  
  cache[cacheKey] = {
    html,
    timestamp: Date.now()
  };
  
  return html;
} 