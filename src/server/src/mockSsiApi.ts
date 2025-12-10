/**
 * Mock SSI API for testing purposes
 * When MOCK_SSI_API environment variable is set, this module provides mock HTML responses
 */

import fs from 'fs/promises';
import path from 'path';
import nock from 'nock';
import { config } from './config';

let mockHtml: string | null = null;
let nockScope: nock.Scope | null = null;

/**
 * Initialize mock SSI API if MOCK_SSI_API environment variable is set
 * This should be called before any SSI API requests are made
 */
export async function initializeMockSsiApi(): Promise<void> {
  if (process.env.MOCK_SSI_API !== 'true' && process.env.MOCK_SSI_API !== '1') {
    return; // Mock mode not enabled
  }

  try {
    // Load mock HTML from test files
    const testHtmlPath = path.join(__dirname, '../test/livescore.html');
    mockHtml = await fs.readFile(testHtmlPath, 'utf-8');
    
    // Set up nock to intercept all SSI API requests
    const ssiBaseUrl = config.ssiApiBaseUrl.replace(/^https?:\/\//, '');
    nockScope = nock(`https://${ssiBaseUrl}`)
      .persist() // Keep interceptors active across multiple requests
      .get(/^\/event\/\d+\/\d+\/live-scores\//)
      .query(true) // Match any query parameters
      .reply(200, () => mockHtml);
    
    console.log('[Mock SSI API] Mock mode enabled - all SSI API requests will be intercepted');
  } catch (error) {
    console.error('[Mock SSI API] Failed to initialize mock:', error);
    throw error;
  }
}

/**
 * Clean up mock interceptors
 */
export function cleanupMockSsiApi(): void {
  if (nockScope) {
    nock.cleanAll();
    nockScope = null;
    console.log('[Mock SSI API] Mock interceptors cleaned up');
  }
}

/**
 * Check if mock mode is enabled
 */
export function isMockModeEnabled(): boolean {
  return process.env.MOCK_SSI_API === 'true' || process.env.MOCK_SSI_API === '1';
}
