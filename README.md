# Livescore

A web application for calculating and comparing IPSC (International Practical Shooting Confederation) live scores from ShootnScoreIt.com.

## Features

- **Live Score Fetching**: Fetch and parse live scores from ShootnScoreIt.com via GraphQL API
- **Score Calculation**: Calculate competitor scores across multiple stages with proper hit factor calculations
- **Competitor Comparison**: Compare specific competitors across common stages
- **Projected Finish & Standings**: Mid-match projection of where each competitor is heading, with a confidence indicator based on how much of the match is done and how consistent their scores are
- **Closest Rivals**: Surface the competitors performing most similarly to a given shooter, even across stages they haven't both shot
- **"Live now" Matches**: Landing page highlighting the matches currently being viewed most (unique viewers)
- **Stage Overlay Images**: Export per-stage result and standings cards (PNG, or all stages as a ZIP) for streaming/social use
- **Division Support**: Support for multiple IPSC divisions:
  - Open
  - Standard
  - Production
  - Revolver
  - Classic
  - Pistol Caliber Carbine
  - Production Optics
  - Optics
- **Stage Exclusion**: Exclude specific stages from calculations
- **Category Filtering**: Filter competitors by category (Overall, Senior, etc.)
- **URL Sharing**: Shareable URLs with query parameters for easy score sharing

## Architecture

The application consists of:

- **Client** (`src/client/`): React-based frontend application
- **Server** (`src/server/`): Express.js backend API that:
  - Fetches data from ShootnScoreIt.com GraphQL API
  - Provides REST API endpoints fronted by a multi-layer cache (see [Caching strategy](#caching-strategy))
- **Mock API** (`src/mock-api/`): Local GraphQL server for development (see [Development with Mock API](#development-with-mock-api))
- **Docker**: Containerized deployment with Docker Compose

### Caching strategy

ShootnScoreIt (SSI) is an external, shared service that can be slow under load, so
the server is built to shield it: **many concurrent viewers of a match collapse to
at most one upstream SSI call at a time, and refreshed views cost an incremental
delta rather than a full re-fetch.** Three cooperating layers sit in front of the
SSI GraphQL API (all in-memory — they reset on restart and re-warm on the next
request):

1. **Response (burst) cache** — keyed by *event* (`matchType-matchId`), TTL
   `RESPONSE_CACHE_TTL_MS` (default 30s). A hit is served entirely from memory with
   **zero SSI traffic**. The SSI fetch always returns every division's scorecards,
   so one entry serves all divisions: the requested division is filtered from the
   cached raw stages and **memoized per division**, so repeat requests skip both the
   fetch *and* the transform. Switching divisions during the window reuses the same
   cached event.

2. **Single-flight coalescing** — while one fetch for an event is in flight, other
   requests for that event await the *same* promise instead of launching their own.
   This is what protects the server (and SSI) from a stampede when the burst cache is
   cold or has just expired, or while a slow SSI response is pending: a burst of N
   requests still triggers at most **one** upstream call.

3. **GraphQL cache** — a per-event store of the last fetched data, max age
   `GRAPHQL_CACHE_MAX_AGE_MS` (default 3 days). The first view does a full fetch;
   subsequent views issue a cheap **incremental** query (only scorecards updated
   since the last fetch, via `updated_after`) and merge the delta. Entries not
   requested for `GRAPHQL_CACHE_IDLE_EVICTION_MS` (default 6h) are evicted.

Net effect during a live match: the first viewer triggers one full fetch; everyone
after that is served from the burst cache, and once it expires a single coalesced
incremental query refreshes it — regardless of how many people or divisions are
being watched.

## Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose (for containerized deployment)

## Installation

### Local Development

1. Clone the repository:
```bash
git clone <repository-url>
cd livescore
```

2. Install dependencies:
```bash
# Install root dependencies
npm install

# Install client dependencies
cd src/client && npm install && cd ../..

# Install server dependencies
cd src/server && npm install && cd ../..
```

3. Start the development servers:

**Server** (runs on port 3000):
```bash
cd src/server
npm run dev
```

**Client** (runs on port 3002):
```bash
cd src/client
npm start
```

### Docker Deployment

1. Build and start all services:
```bash
docker compose up --build
```

The application will be available at `http://localhost:80`

2. Or use the build script:
```bash
./build.sh
docker compose up -d
```

## Usage

### Fetching Scores

1. Enter a ShootnScoreIt URL (the app will extract IDs automatically)
2. Select a division
3. Click "Get Scores" to fetch and display scores

### Comparing Competitors

1. After loading scores, select competitors using the multi-select dropdown
2. The app will show a comparison view with scores across common stages
3. You can exclude specific stages from the comparison

### URL Parameters

The app supports URL parameters for easy sharing:
- `matchId`: Match ID
- `typeId`: Type ID
- `division`: Division code (e.g., `hg18` for Production Optics)
- `competitors`: Comma-separated list of competitor keys
- `exclude`: Comma-separated list of stage numbers to exclude
- `category`: Category filter (e.g., `S` for Senior; default `Overall`)
- `view`: Active result tab — `standings`, `stages`, or `projected`

Example:
```
http://localhost:3002/?matchId=21833&typeId=22&division=hg18&competitors=Competitor1|Division,Competitor2|Division&exclude=1,3
```

## API Endpoints

### GET `/:matchType/:matchId/:division/parse`

Fetches and parses live scores from ShootnScoreIt.com.

**Parameters:**
- `matchType`: Event type ID
- `matchId`: Match ID
- `division`: Division code (or `all`)

**Response:** JSON object with `eventName` and a `stages` array. Returns `403` with code `RESULTS_RESTRICTED` when the organizer has limited results to organizers only, and `504` when the SSI API times out.

### GET `/hot-matches`

Returns the matches currently being viewed most (unique viewers, sliding window). Optional `?limit=` (1–50, default 12).

**Response:** `{ matches: [...] }`

### GET `/health`

Health check for monitoring/load balancers; includes cache stats.

### DELETE `/api/cache/:matchType/:matchId` and DELETE `/api/cache`

Clear the GraphQL cache for a specific event, or all events.

## Configuration

The server can be configured using environment variables:

- `PORT`: Server port (default: 3000)
- `GRAPHQL_API_URL`: GraphQL API endpoint (default: `https://shootnscoreit.com/graphql/`)
- `GRAPHQL_API_KEY`: **Required** SSI API key sent as `x-api-key`
- `GRAPHQL_AUTH_TOKEN`: Optional bearer token for authenticated SSI calls
- `GRAPHQL_SESSION_COOKIE`: Optional cookie header for authenticated SSI calls (for example `sessionid=...`)
- `GRAPHQL_AUTH_USERNAME`: Optional SSI username for JWT login mutation
- `GRAPHQL_AUTH_PASSWORD`: Optional SSI password for JWT login mutation (must be set with username)
- `GRAPHQL_TIMEOUT`: Timeout for GraphQL requests in ms (default: 60000)
- `GRAPHQL_CACHE_MAX_AGE_MS`: Max age for GraphQL cache before a full re-fetch (default: 259200000 = 3 days)
- `GRAPHQL_CACHE_IDLE_EVICTION_MS`: Evict an event after this long with no requests (default: 21600000 = 6 hours)
- `RESPONSE_CACHE_TTL_MS`: Response (burst) cache TTL in ms (default: 30000 = 30 seconds)
- `RATE_LIMIT_ENABLED`: Enable per-IP rate limiting; set to `false` to disable (default: enabled)
- `RATE_LIMIT_WINDOW_MS`: Rate-limit window in ms (default: 900000 = 15 minutes)
- `RATE_LIMIT_MAX`: Max requests per IP per window (default: 100)
- `NODE_ENV`: Node environment - `development`, `production`, or `test`

## Development with Mock API

The mock API server replaces the live ShootnScoreIt.com API during development. It serves a static snapshot of real competition data, filtered by a configurable **virtual time** — so you can start at the beginning of a competition (no results) and fast-forward through the day without needing a live API connection or valid credentials.

### Setup

**Step 1 — Fetch a competition snapshot** (requires SSI credentials in `src/server/.env`):

```bash
npm run mock-api:fetch 22 24850
# Saves to src/mock-api/data/22-24850.json
# Arguments: <contentType> <eventId> (from the ShootnScoreIt URL)
```

If you don't have API credentials, the mock server falls back to built-in synthetic data automatically — no setup needed.

**Step 2 — Point the backend at the mock API** in `src/server/.env`:

```env
GRAPHQL_API_URL=http://localhost:3001/graphql/
GRAPHQL_API_KEY=mock-key
```

**Step 3 — Start both servers:**

```bash
# Terminal 1
npm run mock-api

# Terminal 2
cd src/server && npm run dev
```

### Controlling virtual time

The mock API starts at the beginning of the competition — no scorecards are visible yet. Use the control endpoints to advance time:

```bash
# Check current state
curl http://localhost:3001/mock/state

# Advance by 30 minutes
curl -X POST http://localhost:3001/mock/time \
  -H "Content-Type: application/json" \
  -d '{"contentType":22,"eventId":"24850","advanceMinutes":30}'

# Jump to a specific time
curl -X POST http://localhost:3001/mock/time \
  -H "Content-Type: application/json" \
  -d '{"contentType":22,"eventId":"24850","time":"2026-05-16T12:00:00Z"}'

# Show all results immediately
curl -X POST http://localhost:3001/mock/time \
  -H "Content-Type: application/json" \
  -d '{"contentType":22,"eventId":"24850","fastForward":true}'

# Reset to competition start
curl -X POST http://localhost:3001/mock/reset \
  -H "Content-Type: application/json" \
  -d '{"contentType":22,"eventId":"24850"}'
```

### Data files

Fetched snapshots are stored in `src/mock-api/data/{contentType}-{eventId}.json` and are excluded from git (they may contain real competitor names). The mock server automatically uses the matching file when queried for that event, or falls back to synthetic sample data if no file exists.

### Mock API port

The mock API runs on port 3001 by default. Override with `MOCK_API_PORT=<port>`.

## Development

### Running Tests

**Server tests:**
```bash
cd src/server
npm test
```

**Client tests:**
```bash
cd src/client
npm test
```

**Docker build tests:**
```bash
npm run test:docker
```

### Project Structure

```
livescore/
├── src/
│   ├── client/                    # React frontend application
│   │   ├── src/
│   │   │   ├── App.tsx            # Main application component
│   │   │   ├── App.css            # Application styles
│   │   │   ├── calculator.ts      # Score, projection & rivals logic
│   │   │   ├── stageLabel.ts      # Shared stage-label formatter
│   │   │   ├── HotMatches.tsx     # "Live now" landing list
│   │   │   ├── StageOverlay.ts    # Canvas overlay image generation
│   │   │   ├── OverlaySettingsModal.tsx # Overlay export settings dialog
│   │   │   ├── types.ts           # TypeScript type definitions
│   │   │   ├── index.tsx          # React entry point
│   │   │   └── __tests__/        # Client-side tests
│   │   │       ├── calculator.test.ts
│   │   │       ├── stageLabel.test.ts
│   │   │       ├── livescore.json
│   │   │       └── livescore_all.json
│   │   ├── public/                # Static assets
│   │   └── package.json
│   ├── mock-api/                  # Local mock GraphQL server (dev only)
│   │   ├── index.ts               # Mock server (time-filtered competition data)
│   │   ├── fetch-data.ts          # Script to snapshot real SSI data
│   │   ├── tsconfig.json
│   │   └── data/                  # Fetched snapshots (gitignored)
│   └── server/                    # Express.js backend API
│       ├── src/
│       │   ├── index.ts           # Express server, API endpoints & response cache
│       │   ├── graphql.ts         # GraphQL API client, cache & single-flight
│       │   ├── hotMatches.ts      # Unique-viewer "Live now" tracking
│       │   ├── config.ts          # Server configuration management
│       │   ├── errors.ts          # Error handling classes
│       │   ├── types.ts           # TypeScript type definitions
│       │   └── *.test.ts         # Server-side tests
│       ├── .eslintrc.js          # ESLint configuration
│       ├── jest.config.js         # Jest test configuration
│       └── package.json
├── Dockerfile.server              # Server Docker image
├── Dockerfile.nginx               # Nginx reverse proxy image (includes built client)
├── docker-compose.yml             # Docker Compose configuration
├── nginx.conf                     # Nginx configuration (includes client serving and API proxy)
├── .gitignore                    # Git ignore rules
├── README.md                      # Project documentation
├── CONTRIBUTING.md                # Contribution guidelines
├── SECURITY.md                    # Security policy
├── LICENSE                        # MIT License
└── package.json                   # Root package.json (scripts only)
```

**Key Directories:**
- `src/client/` - React frontend application (port 3002)
- `src/server/` - Express.js backend API (port 3000)
- Root level - Docker configurations and project documentation

## License

See [LICENSE](LICENSE) file for details.

## Acknowledgments

- Uses data from [ShootnScoreIt.com](https://shootnscoreit.com)
- Built for the nordic IPSC community
