# Feature Flags

This project uses feature flags to enable/disable features without code changes. Feature flags are controlled via environment variables.

## Available Feature Flags

### ESS_FEATURE

Controls the ESS (ECM text parsing) functionality.

- **Default**: `false` (disabled)
- **Client**: Set `REACT_APP_FEATURE_FLAG_ESS_FEATURE=true` at build time
- **Server**: Set `ESS_FEATURE_ENABLED=true` at runtime

When disabled:
- ESS tab is hidden in the UI
- `/api/ecm/txt/parse` endpoint returns 403 Forbidden
- ESS-related E2E tests are skipped

## Configuration

### Local Development

#### Client (React App)

Create a `.env` file in the project root:

```bash
REACT_APP_FEATURE_FLAG_ESS_FEATURE=true
```

Then rebuild the client:
```bash
cd src/client
npm run build
```

#### Server

Set environment variable:
```bash
export ESS_FEATURE_ENABLED=true
```

Or create a `.env` file:
```bash
ESS_FEATURE_ENABLED=true
```

### Docker Compose

Set the environment variable in `docker-compose.yml` or use a `.env` file:

```yaml
services:
  client:
    build:
      args:
        REACT_APP_FEATURE_FLAG_ESS_FEATURE: ${ESS_FEATURE_ENABLED:-false}
  server:
    environment:
      - ESS_FEATURE_ENABLED=${ESS_FEATURE_ENABLED:-false}
```

Then set in your `.env` file:
```bash
ESS_FEATURE_ENABLED=true
```

Rebuild and restart:
```bash
docker-compose up --build -d
```

### Production Deployment

#### Client Build (included in nginx image)

Pass build arg during Docker build:
```bash
docker build \
  --build-arg REACT_APP_FEATURE_FLAG_ESS_FEATURE=true \
  -f Dockerfile.nginx \
  -t livescore-nginx .
```

#### Server Runtime

Set environment variable:
```bash
docker run -e ESS_FEATURE_ENABLED=true livescore-server
```

Or in `docker-compose.yml`:
```yaml
services:
  server:
    environment:
      - ESS_FEATURE_ENABLED=true
```

## Testing

### E2E Tests

ESS flow tests automatically skip if the feature is disabled. To run ESS tests:

```bash
# Enable feature flag
export ESS_FEATURE_ENABLED=true
export REACT_APP_FEATURE_FLAG_ESS_FEATURE=true

# Rebuild client with feature flag
docker-compose build client

# Start services
docker-compose up -d

# Run tests
npm run test:e2e
```

### Unit Tests

Feature flag checks in unit tests can be mocked:

```typescript
// Mock feature flag
jest.mock('./featureFlags', () => ({
  isFeatureEnabled: jest.fn(() => true),
}));
```

## Adding New Feature Flags

1. Add flag name to `FeatureFlag` type in `src/client/src/featureFlags.ts`
2. Add default value in `defaultFlags` object
3. Add environment variable parsing in `getFeatureFlagsFromEnv()`
4. Add server-side flag in `src/server/src/config.ts` if needed
5. Update this documentation

Example:

```typescript
// Client: src/client/src/featureFlags.ts
export type FeatureFlag = 'ESS_FEATURE' | 'NEW_FEATURE';

const defaultFlags: Record<FeatureFlag, boolean> = {
  ESS_FEATURE: false,
  NEW_FEATURE: false, // New flag
};

function getFeatureFlagsFromEnv(): Partial<FeatureFlagConfig> {
  const flags: Partial<FeatureFlagConfig> = {};
  
  // ... existing flags ...
  
  const newFeature = process.env.REACT_APP_FEATURE_FLAG_NEW_FEATURE;
  if (newFeature !== undefined) {
    flags.NEW_FEATURE = newFeature === 'true' || newFeature === '1';
  }
  
  return flags;
}
```

## Best Practices

1. **Default to disabled**: New features should be disabled by default
2. **Document flags**: Always document new flags in this file
3. **Test both states**: Write tests for both enabled and disabled states
4. **Server/client sync**: Keep server and client flags in sync when needed
5. **Environment-specific**: Consider different defaults for dev/staging/prod

## Troubleshooting

### ESS tab not showing

1. Check that `REACT_APP_FEATURE_FLAG_ESS_FEATURE=true` was set at **build time**
2. Rebuild the client: `docker-compose build client`
3. Restart services: `docker-compose restart client`

### ESS endpoint returns 403

1. Check that `ESS_FEATURE_ENABLED=true` is set in server environment
2. Restart server: `docker-compose restart server`
3. Verify: `curl http://localhost/api/ecm/txt/parse` should not return 403

### Tests failing

1. Ensure feature flags are set before building/running tests
2. Check that Docker services are rebuilt with correct flags
3. Verify environment variables are passed correctly
