# Livescore

A web application for calculating and comparing IPSC (International Practical Shooting Confederation) live scores from ShootnScoreIt.com.

## Features

- **Live Score Fetching**: Fetch and parse live scores from ShootnScoreIt.com via GraphQL API
- **Score Calculation**: Calculate competitor scores across multiple stages with proper hit factor calculations
- **Competitor Comparison**: Compare specific competitors across common stages
- **Division Support**: Support for multiple IPSC divisions:
  - Open
  - Standard
  - Production
  - Revolver
  - Classic
  - Production Optics
- **Stage Exclusion**: Exclude specific stages from calculations
- **Category Filtering**: Filter competitors by category (Overall, Senior, etc.)
- **URL Sharing**: Shareable URLs with query parameters for easy score sharing

## Architecture

The application consists of:

- **Client** (`src/client/`): React-based frontend application
- **Server** (`src/server/`): Express.js backend API that:
  - Fetches data from ShootnScoreIt.com GraphQL API
  - Provides REST API endpoints with caching
- **Docker**: Containerized deployment with Docker Compose

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

Example:
```
http://localhost:3002/?matchId=21833&typeId=22&division=hg18&competitors=Competitor1|Division,Competitor2|Division&exclude=1,3
```

## API Endpoints

### GET `/:matchType/:matchId/:division/parse`

Fetches and parses live scores from ShootnScoreIt.com

**Parameters:**
- `matchType`: Event type ID
- `matchId`: Match ID
- `division`: Division code

**Response:** JSON object with eventName and stages array

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
- `GRAPHQL_CACHE_MAX_AGE_MS`: Max age for GraphQL cache (default: 259200000 = 3 days)
- `GRAPHQL_CACHE_IDLE_EVICTION_MS`: Idle eviction time (default: 3600000 = 1 hour)
- `RESPONSE_CACHE_TTL_MS`: Response cache TTL (default: 5000)
- `NODE_ENV`: Node environment - `development`, `production`, or `test`

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
│   │   │   ├── calculator.ts      # Score calculation logic
│   │   │   ├── types.ts           # TypeScript type definitions
│   │   │   ├── index.tsx          # React entry point
│   │   │   └── __tests__/        # Client-side tests
│   │   │       ├── calculator.test.ts
│   │   │       ├── livescore.json
│   │   │       └── livescore_all.json
│   │   ├── public/                # Static assets
│   │   └── package.json
│   └── server/                    # Express.js backend API
│       ├── src/
│       │   ├── index.ts           # Express server and API endpoints
│       │   ├── graphql.ts         # GraphQL API client
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
