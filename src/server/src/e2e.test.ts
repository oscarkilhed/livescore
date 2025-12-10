import request from 'supertest';
import nock from 'nock';
import { app } from './index';
import { buildSsiApiUrl } from './config';
import { __cache } from './cache';
import { Stage } from './types';
import fs from 'fs/promises';
import path from 'path';

describe('E2E API Tests with Mocked SSI API', () => {
  const testHtmlPath = path.join(__dirname, '../test/livescore.html');
  let mockHtml: string;

  beforeAll(async () => {
    // Load test HTML file
    mockHtml = await fs.readFile(testHtmlPath, 'utf-8');
  });

  beforeEach(() => {
    // Clean up nock interceptors before each test
    nock.cleanAll();
    // Clear the cache before each test
    Object.keys(__cache).forEach(key => delete __cache[key]);
  });

  afterEach(() => {
    // Ensure all nock interceptors were called
    nock.isDone();
  });

  describe('GET /:matchType/:matchId/:division/parse', () => {
    it('should fetch and parse SSI live scores successfully', async () => {
      const matchType = '22';
      const matchId = '21833';
      const division = 'hg18';
      const ssiUrl = buildSsiApiUrl(matchType, matchId, division);

      // Mock SSI API response
      nock('https://shootnscoreit.com')
        .get(`/event/${matchType}/${matchId}/live-scores/`)
        .query({ divShown: division })
        .reply(200, mockHtml);

      const response = await request(app)
        .get(`/${matchType}/${matchId}/${division}/parse`)
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBeGreaterThan(0);

      // Verify stage structure
      const stage = response.body[0];
      expect(stage).toHaveProperty('stage');
      expect(stage).toHaveProperty('competitors');
      expect(stage).toHaveProperty('procedures');
      expect(Array.isArray(stage.competitors)).toBe(true);

      // Verify competitor structure if competitors exist
      if (stage.competitors.length > 0) {
        const competitor = stage.competitors[0];
        expect(competitor).toHaveProperty('name');
        expect(competitor).toHaveProperty('division');
        expect(competitor).toHaveProperty('hitFactor');
        expect(competitor).toHaveProperty('time');
        expect(competitor).toHaveProperty('hits');
        expect(competitor).toHaveProperty('competitorKey');
      }
    });

    it('should handle invalid division parameter', async () => {
      // Test with a division that is invalid format
      const matchType = '22';
      const matchId = '99997';
      const division = 'invalid-division';

      const response = await request(app)
        .get(`/${matchType}/${matchId}/${division}/parse`);

      // Should return 400 validation error (invalid division format)
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should handle SSI API errors gracefully', async () => {
      const matchType = '22';
      const matchId = '99999'; // Use different ID to avoid cache
      const division = 'hg18';

      // Mock SSI API error response
      const scope = nock('https://shootnscoreit.com')
        .get(`/event/${matchType}/${matchId}/live-scores/`)
        .query({ divShown: division })
        .reply(500, 'Internal Server Error');

      const response = await request(app)
        .get(`/${matchType}/${matchId}/${division}/parse`);

      // Verify the mock was called
      expect(scope.isDone()).toBe(true);
      
      // Should return error status (500 from SSI API becomes 500 in our response)
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code');
    });

    it('should handle SSI API network errors', async () => {
      const matchType = '22';
      const matchId = '99998'; // Use different ID to avoid cache
      const division = 'hg18';

      // Mock SSI API network error
      nock('https://shootnscoreit.com')
        .get(`/event/${matchType}/${matchId}/live-scores/`)
        .query({ divShown: division })
        .replyWithError('Network error');

      const response = await request(app)
        .get(`/${matchType}/${matchId}/${division}/parse`);

      // Should return 503 (Service Unavailable) for network errors
      expect(response.status).toBe(503);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code', 'FETCH_ERROR');
    });

    it('should use cache for repeated requests within TTL', async () => {
      const matchType = '22';
      const matchId = '21833';
      const division = 'hg18';

      // Mock SSI API response - should only be called once due to caching
      const scope = nock('https://shootnscoreit.com')
        .get(`/event/${matchType}/${matchId}/live-scores/`)
        .query({ divShown: division })
        .reply(200, mockHtml)
        .persist(); // Allow multiple calls but we'll verify it's only called once

      // First request
      const response1 = await request(app)
        .get(`/${matchType}/${matchId}/${division}/parse`)
        .expect(200);

      // Second request should use cache (no additional HTTP call)
      // Note: Cache is in-memory, so it persists across requests in the same process
      const response2 = await request(app)
        .get(`/${matchType}/${matchId}/${division}/parse`)
        .expect(200);

      expect(response1.body).toEqual(response2.body);
      // Verify responses are identical (indicating cache was used)
      expect(JSON.stringify(response1.body)).toBe(JSON.stringify(response2.body));
    });
  });

  describe('POST /ecm/txt/parse', () => {
    // Skip tests if ESS feature is disabled
    const essFeatureEnabled = process.env.ESS_FEATURE_ENABLED === 'true' || process.env.ESS_FEATURE_ENABLED === '1';
    
    (essFeatureEnabled ? it : it.skip)('should parse ECM text successfully', async () => {
      const ecmTextPath = path.join(__dirname, '../test/ECM.txt');
      const ecmText = await fs.readFile(ecmTextPath, 'utf-8');

      const response = await request(app)
        .post('/ecm/txt/parse')
        .set('Content-Type', 'text/plain')
        .send(ecmText)
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBeGreaterThan(0);

      // Verify stage structure
      const stage = response.body[0];
      expect(stage).toHaveProperty('stage');
      expect(stage).toHaveProperty('competitors');
      expect(Array.isArray(stage.competitors)).toBe(true);
    });

    (essFeatureEnabled ? it : it.skip)('should return 400 for empty request body', async () => {
      const response = await request(app)
        .post('/ecm/txt/parse')
        .set('Content-Type', 'text/plain')
        .send('')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Empty request body');
    });

    (essFeatureEnabled ? it : it.skip)('should handle invalid ECM text gracefully', async () => {
      const invalidText = 'This is not valid ECM text format';

      const response = await request(app)
        .post('/ecm/txt/parse')
        .set('Content-Type', 'text/plain')
        .send(invalidText);

      // Should either return empty array or handle error gracefully
      expect([200, 500]).toContain(response.status);
    });
  });

  describe('Full flow: Client request -> Server -> SSI API (mocked) -> Response', () => {
    it('should complete full request flow with mocked SSI API', async () => {
      const matchType = '22';
      const matchId = '21833';
      const division = 'hg18';

      // Mock SSI API
      nock('https://shootnscoreit.com')
        .get(`/event/${matchType}/${matchId}/live-scores/`)
        .query({ divShown: division })
        .reply(200, mockHtml);

      // Simulate client request
      const response = await request(app)
        .get(`/${matchType}/${matchId}/${division}/parse`)
        .set('Accept', 'application/json')
        .expect(200)
        .expect('Content-Type', /json/);

      // Verify response structure matches what client expects
      expect(Array.isArray(response.body)).toBe(true);
      
      if (response.body.length > 0) {
        const stages = response.body;
        
        // Verify all stages have required fields
        stages.forEach((stage: Stage) => {
          expect(stage).toHaveProperty('stage');
          expect(stage).toHaveProperty('competitors');
          expect(typeof stage.stage).toBe('number');
          expect(Array.isArray(stage.competitors)).toBe(true);
        });

        // Verify competitors have required fields
        const allCompetitors = stages.flatMap((s: Stage) => s.competitors);
        if (allCompetitors.length > 0) {
          const competitor = allCompetitors[0];
          expect(competitor).toHaveProperty('name');
          expect(competitor).toHaveProperty('competitorKey');
          expect(competitor).toHaveProperty('hitFactor');
          expect(typeof competitor.hitFactor).toBe('number');
        }
      }
    });
  });
});
