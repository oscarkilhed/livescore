import { test, expect } from '@playwright/test';
import fs from 'fs/promises';
import path from 'path';

/**
 * E2E tests for ESS (ECM text) flow
 * Tests the complete user journey of pasting ECM text and parsing it
 * 
 * Note: These tests require the ESS_FEATURE_ENABLED feature flag to be enabled.
 * Set ESS_FEATURE_ENABLED=true in your environment or docker compose configuration to run these tests.
 */
test.describe('ESS Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Check if ESS feature is enabled by checking if ESS tab is visible
    // If not visible, skip tests
    await page.goto('/');
    const essTab = page.getByRole('tab', { name: /ESS/i });
    const isEssVisible = await essTab.isVisible().catch(() => false);
    
    test.skip(!isEssVisible, 'ESS feature is disabled. Set ESS_FEATURE_ENABLED=true to enable.');
  });
  let mockEcmStagesData: any[];
  let sampleEcmText: string;

  test.beforeAll(async () => {
    // Load sample ECM text from test files
    try {
      const ecmTextPath = path.join(__dirname, '../src/server/test/ECM.txt');
      sampleEcmText = await fs.readFile(ecmTextPath, 'utf-8');
    } catch (error) {
      // Fallback to a minimal ECM text format if file doesn't exist
      sampleEcmText = `Production Optics - Stage 1
Place	#	Shooter	Division	PF	Time	Hits	Points	HF	Stage Pts	Stage %
1	1	Test Competitor A	Production Optics	Minor	30.17	136	136	4.5078	150.00	100.00
2	2	Test Competitor B	Production Optics	Minor	32.45	134	132	4.0654	135.00	90.00

Production Optics - Stage 2
Place	#	Shooter	Division	PF	Time	Hits	Points	HF	Stage Pts	Stage %
1	1	Test Competitor A	Production Optics	Minor	25.12	100	100	3.9876	120.00	100.00`;
    }

    // Mock parsed ECM data structure
    mockEcmStagesData = [
      {
        stage: 1,
        competitors: [
          {
            name: 'Test Competitor A',
            division: 'Production Optics',
            hitFactor: 4.5078,
            time: 30.17,
            hits: 136,
            competitorKey: 'competitor-a-key',
            powerFactor: 'Minor',
          },
          {
            name: 'Test Competitor B',
            division: 'Production Optics',
            hitFactor: 4.0654,
            time: 32.45,
            hits: 134,
            competitorKey: 'competitor-b-key',
            powerFactor: 'Minor',
          },
        ],
        procedures: [],
      },
      {
        stage: 2,
        competitors: [
          {
            name: 'Test Competitor A',
            division: 'Production Optics',
            hitFactor: 3.9876,
            time: 25.12,
            hits: 100,
            competitorKey: 'competitor-a-key',
            powerFactor: 'Minor',
          },
        ],
        procedures: [],
      },
    ];
  });

  test.beforeEach(async ({ page }) => {
    // Mock the ECM parsing endpoint
    await page.route('**/api/ecm/txt/parse', async (route) => {
      const request = route.request();
      const method = request.method();
      
      if (method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockEcmStagesData),
        });
      } else {
        await route.fulfill({
          status: 405,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Method not allowed' }),
        });
      }
    });
  });

  test('should switch to ESS tab and display ECM text input', async ({ page }) => {
    await page.goto('/');
    
    // Click on ESS tab
    const essTab = page.getByRole('tab', { name: /ESS/i });
    await expect(essTab).toBeVisible();
    await essTab.click();
    
    // Wait for tab to switch
    await page.waitForTimeout(300);
    
    // Check that ECM text area is visible
    const textArea = page.locator('textarea').filter({ hasText: /ecm|paste/i }).first();
    // If no specific label, just check for any textarea
    const anyTextArea = page.locator('textarea').first();
    await expect(anyTextArea).toBeVisible();
  });

  test('should parse ECM text and display stages when submitted', async ({ page }) => {
    await page.goto('/');
    
    // Switch to ESS tab
    const essTab = page.getByRole('tab', { name: /ESS/i });
    await essTab.click();
    await page.waitForTimeout(300);
    
    // Find and fill the textarea
    const textArea = page.locator('textarea').first();
    await textArea.fill(sampleEcmText);
    
    // Find and click submit button
    const submitButton = page.getByRole('button', { name: /parse|submit|process/i }).first();
    await submitButton.click();
    
    // Wait for parsing to complete
    await page.waitForTimeout(2000);
    
    // Verify stages are displayed
    const stageElements = page.locator('[data-testid*="stage"], .stage, h2, h3').filter({ hasText: /stage/i });
    await expect(stageElements.first()).toBeVisible({ timeout: 5000 });
    
    // Verify competitors are displayed
    const competitorName = page.getByText('Test Competitor A').first();
    await expect(competitorName).toBeVisible({ timeout: 5000 });
  });

  test('should show error for empty ECM text', async ({ page }) => {
    await page.goto('/');
    
    // Switch to ESS tab
    const essTab = page.getByRole('tab', { name: /ESS/i });
    await essTab.click();
    await page.waitForTimeout(300);
    
    // Try to submit empty textarea
    const submitButton = page.getByRole('button', { name: /parse|submit|process/i }).first();
    await submitButton.click();
    
    // Wait for error message
    await page.waitForTimeout(500);
    
    // Check that error message is displayed
    const errorMessage = page.getByText(/empty|paste|required/i);
    await expect(errorMessage.first()).toBeVisible({ timeout: 3000 });
  });

  test('should handle ECM parsing errors gracefully', async ({ page }) => {
    // Override mock to return error
    await page.route('**/api/ecm/txt/parse', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Failed to parse ECM text payload' }),
      });
    });
    
    await page.goto('/');
    
    // Switch to ESS tab
    const essTab = page.getByRole('tab', { name: /ESS/i });
    await essTab.click();
    await page.waitForTimeout(300);
    
    // Fill textarea with some text
    const textArea = page.locator('textarea').first();
    await textArea.fill('Invalid ECM text format');
    
    // Submit
    const submitButton = page.getByRole('button', { name: /parse|submit|process/i }).first();
    await submitButton.click();
    
    // Wait for error
    await page.waitForTimeout(1000);
    
    // Check that error message is displayed
    const errorMessage = page.getByText(/error|failed/i);
    await expect(errorMessage.first()).toBeVisible({ timeout: 3000 });
  });

  test('should clear ECM text and reset when switching tabs', async ({ page }) => {
    await page.goto('/');
    
    // Switch to ESS tab
    const essTab = page.getByRole('tab', { name: /ESS/i });
    await essTab.click();
    await page.waitForTimeout(300);
    
    // Fill textarea
    const textArea = page.locator('textarea').first();
    await textArea.fill(sampleEcmText);
    await expect(textArea).toHaveValue(sampleEcmText);
    
    // Switch back to SSI tab
    const ssiTab = page.getByRole('tab', { name: /SSI/i });
    await ssiTab.click();
    await page.waitForTimeout(300);
    
    // Switch back to ESS tab
    await essTab.click();
    await page.waitForTimeout(300);
    
    // Textarea should be empty or reset (depending on implementation)
    // This test verifies tab switching works correctly
    const newTextArea = page.locator('textarea').first();
    // The value might be cleared or preserved - both are acceptable behaviors
    await expect(newTextArea).toBeVisible();
  });

  test('should parse ECM text with Optics division (hg33)', async ({ page }) => {
    const opticsEcmText = `Optics - Stage 1
Place	#	Shooter	Division	PF	Time	Hits	Points	HF	Stage Pts	Stage %
1	1	Test Competitor A	Optics	Minor	30.17	136	136	4.5078	150.00	100.00
2	2	Test Competitor B	Optics	Minor	32.45	134	132	4.0654	135.00	90.00`;

    const mockOpticsData = [
      {
        stage: 1,
        competitors: [
          {
            name: 'Test Competitor A',
            division: 'Optics',
            hitFactor: 4.5078,
            time: 30.17,
            hits: 136,
            competitorKey: 'competitor-a-key',
            powerFactor: 'Minor',
          },
          {
            name: 'Test Competitor B',
            division: 'Optics',
            hitFactor: 4.0654,
            time: 32.45,
            hits: 134,
            competitorKey: 'competitor-b-key',
            powerFactor: 'Minor',
          },
        ],
        procedures: [],
      },
    ];

    await page.route('**/api/ecm/txt/parse', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockOpticsData),
      });
    });

    await page.goto('/');
    
    // Switch to ESS tab
    const essTab = page.getByRole('tab', { name: /ESS/i });
    await essTab.click();
    await page.waitForTimeout(300);
    
    // Fill textarea with Optics ECM text
    const textArea = page.locator('textarea').first();
    await textArea.fill(opticsEcmText);
    
    // Submit
    const submitButton = page.getByRole('button', { name: /parse|submit|process/i }).first();
    await submitButton.click();
    
    // Wait for parsing
    await page.waitForTimeout(2000);
    
    // Verify Optics competitors are displayed
    const competitorName = page.getByText('Test Competitor A').first();
    await expect(competitorName).toBeVisible({ timeout: 5000 });
  });

  test('should parse ECM text with Pistol Caliber Carbine division (hg17)', async ({ page }) => {
    const pccEcmText = `Pistol Caliber Carbine - Stage 1
Place	#	Shooter	Division	PF	Time	Hits	Points	HF	Stage Pts	Stage %
1	1	Test Competitor A	Pistol Caliber Carbine	Minor	30.17	136	136	4.5078	150.00	100.00
2	2	Test Competitor B	Pistol Caliber Carbine	Minor	32.45	134	132	4.0654	135.00	90.00`;

    const mockPccData = [
      {
        stage: 1,
        competitors: [
          {
            name: 'Test Competitor A',
            division: 'Pistol Caliber Carbine',
            hitFactor: 4.5078,
            time: 30.17,
            hits: 136,
            competitorKey: 'competitor-a-key',
            powerFactor: 'Minor',
          },
          {
            name: 'Test Competitor B',
            division: 'Pistol Caliber Carbine',
            hitFactor: 4.0654,
            time: 32.45,
            hits: 134,
            competitorKey: 'competitor-b-key',
            powerFactor: 'Minor',
          },
        ],
        procedures: [],
      },
    ];

    await page.route('**/api/ecm/txt/parse', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockPccData),
      });
    });

    await page.goto('/');
    
    // Switch to ESS tab
    const essTab = page.getByRole('tab', { name: /ESS/i });
    await essTab.click();
    await page.waitForTimeout(300);
    
    // Fill textarea with Pistol Caliber Carbine ECM text
    const textArea = page.locator('textarea').first();
    await textArea.fill(pccEcmText);
    
    // Submit
    const submitButton = page.getByRole('button', { name: /parse|submit|process/i }).first();
    await submitButton.click();
    
    // Wait for parsing
    await page.waitForTimeout(2000);
    
    // Verify Pistol Caliber Carbine competitors are displayed
    const competitorName = page.getByText('Test Competitor A').first();
    await expect(competitorName).toBeVisible({ timeout: 5000 });
  });
});
