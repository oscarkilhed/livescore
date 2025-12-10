# End-to-End Tests with Playwright

This directory contains E2E (end-to-end) tests using Playwright for testing the full application flow in a real browser environment.

## Test Structure

- **`ssi-flow.spec.ts`** - Tests for the SSI (ShootnScoreIt) flow:
  - Loading the application
  - Fetching live scores via API
  - Displaying stages and competitors
  - URL parameter handling
  - Error handling

- **`ess-flow.spec.ts`** - Tests for the ESS (ECM text) flow:
  - Switching to ESS tab
  - Pasting and parsing ECM text
  - Displaying parsed results
  - Error handling for invalid input

- **`competitor-comparison.spec.ts`** - Tests for competitor comparison features:
  - Selecting competitors
  - Viewing comparison results
  - Stage-by-stage comparison
  - Stage exclusion functionality

## Running Tests

### Prerequisites

1. Ensure Docker services are running:
   ```bash
   docker compose up -d
   ```

2. Wait for services to be ready (check health endpoint):
   ```bash
   curl http://localhost/api/health
   ```

### Run All Tests

```bash
npm run test:e2e
```

### Run Tests in UI Mode (Interactive)

```bash
npm run test:e2e:ui
```

### Run Tests in Headed Mode (See Browser)

```bash
npm run test:e2e:headed
```

### Debug Tests

```bash
npm run test:e2e:debug
```

### Run Specific Test File

```bash
npx playwright test e2e/ssi-flow.spec.ts
```

## Test Configuration

Tests are configured in `playwright.config.ts`:
- Base URL: `http://localhost:80` (or set `PLAYWRIGHT_BASE_URL` env var)
- Browsers: Chromium, Firefox, WebKit
- Auto-starts Docker services before tests
- Screenshots on failure
- Trace collection on retry

## Mocking Strategy

Tests use a two-layer mocking approach:

1. **Backend Mocking**: The backend server mocks the SSI API when `MOCK_SSI_API=true` is set:
   - Uses `nock` to intercept all requests to `shootnscoreit.com`
   - Returns mock HTML from test files (`src/server/test/livescore.html`)
   - Prevents real API calls during e2e tests
   - Enabled automatically when running `npm run test:e2e`

2. **Frontend Mocking**: Playwright's route interception mocks API responses:
   - SSI API endpoints (`/api/:typeId/:matchId/:division/parse`)
   - ECM parsing endpoint (`/api/ecm/txt/parse`)

This ensures tests run fast and reliably without depending on external services.

### Enabling Mock SSI API

The mock SSI API is automatically enabled when running e2e tests via Playwright config.
To manually enable it:

```bash
MOCK_SSI_API=true docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d
```

## CI/CD Integration

E2E tests run automatically in GitHub Actions:
1. Docker services are built and started
2. Playwright browsers are installed
3. Tests run against the running services
4. Test reports are uploaded as artifacts

## Writing New Tests

When adding new tests:

1. Use descriptive test names that explain what is being tested
2. Mock external API calls using `page.route()`
3. Use Playwright's best practices for selectors (prefer `getByRole`, `getByText`, etc.)
4. Add appropriate waits for async operations
5. Clean up any test data or state after tests

Example:
```typescript
test('should do something', async ({ page }) => {
  // Mock API
  await page.route('**/api/endpoint', async (route) => {
    await route.fulfill({ json: mockData });
  });
  
  // Navigate and interact
  await page.goto('/');
  await page.getByRole('button', { name: 'Submit' }).click();
  
  // Assert
  await expect(page.getByText('Success')).toBeVisible();
});
```
