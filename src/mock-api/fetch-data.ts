/**
 * Fetches a full competition snapshot from the real ShootnScoreIt API and
 * saves it as a mock data file.  Run this once to capture real data, then
 * develop offline against the mock API.
 *
 * Usage:
 *   npx ts-node --project src/mock-api/tsconfig.json \
 *       src/mock-api/fetch-data.ts <contentType> <eventId>
 *
 *   Example:
 *     npx ts-node --project src/mock-api/tsconfig.json \
 *         src/mock-api/fetch-data.ts 22 21833
 *
 * Required env vars (reads .env automatically):
 *   GRAPHQL_API_URL   (defaults to https://shootnscoreit.com/graphql/)
 *   GRAPHQL_API_KEY
 *
 * The file is written to:
 *   src/mock-api/data/{contentType}-{eventId}.json
 */

import fs from 'fs';
import path from 'path';

// Load .env from src/server/.env or project root .env
function loadEnv(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
loadEnv(path.join(__dirname, '..', 'server', '.env'));
loadEnv(path.join(__dirname, '..', '..', '.env'));

import fetch from 'node-fetch';

const GRAPHQL_API_URL     = process.env.GRAPHQL_API_URL      || 'https://shootnscoreit.com/graphql/';
const GRAPHQL_API_KEY     = process.env.GRAPHQL_API_KEY      || '';
const GRAPHQL_AUTH_USERNAME = process.env.GRAPHQL_AUTH_USERNAME;
const GRAPHQL_AUTH_PASSWORD = process.env.GRAPHQL_AUTH_PASSWORD;
const DATA_DIR = path.join(__dirname, 'data');

// ── JWT auth helpers (mirrors the logic in src/server/src/graphql.ts) ──────

async function gqlPost(body: object, authToken?: string): Promise<{ data?: Record<string, unknown>; errors?: Array<{ message: string }> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-api-key': GRAPHQL_API_KEY,
  };
  if (authToken) headers['Authorization'] = `JWT ${authToken}`;

  const res = await fetch(GRAPHQL_API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json() as Promise<{ data?: Record<string, unknown>; errors?: Array<{ message: string }> }>;
}

async function loginJwt(): Promise<string | undefined> {
  if (!GRAPHQL_AUTH_USERNAME || !GRAPHQL_AUTH_PASSWORD) return undefined;

  // Try snake_case mutation first (newer SSI API)
  const snakeRes = await gqlPost({
    query: `mutation TokenAuth($email: String!, $password: String!) {
      token_auth(email: $email, password: $password) {
        token { token }
        refresh_token { token }
      }
    }`,
    variables: { email: GRAPHQL_AUTH_USERNAME, password: GRAPHQL_AUTH_PASSWORD },
  });
  if (!snakeRes.errors?.length) {
    const payload = snakeRes.data?.token_auth as { token?: { token?: string } } | undefined;
    return payload?.token?.token;
  }

  // Fall back to camelCase mutation
  const camelRes = await gqlPost({
    query: `mutation TokenAuth($username: String!, $password: String!) {
      tokenAuth(username: $username, password: $password) { token refreshToken }
    }`,
    variables: { username: GRAPHQL_AUTH_USERNAME, password: GRAPHQL_AUTH_PASSWORD },
  });
  const camelPayload = camelRes.data?.tokenAuth as { token?: string } | undefined;
  return camelPayload?.token;
}

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

async function main() {
  const [, , rawContentType, eventId] = process.argv;

  if (!rawContentType || !eventId) {
    console.error('Usage: ts-node src/mock-api/fetch-data.ts <contentType> <eventId>');
    process.exit(1);
  }

  const contentType = parseInt(rawContentType, 10);
  if (isNaN(contentType)) {
    console.error(`Invalid contentType: ${rawContentType}`);
    process.exit(1);
  }

  if (!GRAPHQL_API_KEY) {
    console.error('GRAPHQL_API_KEY is required. Set it in your .env file.');
    process.exit(1);
  }

  console.log(`Fetching event ${eventId} (contentType=${contentType}) from ${GRAPHQL_API_URL}…`);

  // Try unauthenticated first; if rejected, log in and retry
  let json = await gqlPost({ query: LIVE_SCORES_QUERY, variables: { contentType, eventId } });

  if (json.errors?.some((e) => e.message.includes('authenticated'))) {
    console.log('Auth required — logging in…');
    const token = await loginJwt();
    if (!token) {
      console.error('Login failed. Set GRAPHQL_AUTH_USERNAME and GRAPHQL_AUTH_PASSWORD in src/server/.env');
      process.exit(1);
    }
    json = await gqlPost({ query: LIVE_SCORES_QUERY, variables: { contentType, eventId } }, token);
  }

  if (json.errors?.length) {
    console.error('GraphQL errors:', json.errors.map((e) => e.message).join('; '));
    process.exit(1);
  }

  const event = (json.data?.event ?? null) as { stages?: Array<{ scorecards?: Array<{ updated?: string }> }> } | null;
  if (!event) {
    console.error(`Event not found: ${eventId}`);
    process.exit(1);
  }

  // Derive competition window from scorecard timestamps
  let earliest = '';
  let latest   = '';
  for (const stage of (event.stages ?? [])) {
    for (const sc of (stage.scorecards ?? [])) {
      if (!sc.updated) continue;
      if (!earliest || sc.updated < earliest) earliest = sc.updated;
      if (!latest   || sc.updated > latest)   latest   = sc.updated;
    }
  }

  // Pad the start 30 min before the first scorecard so virtual time begins empty
  const startDate = earliest
    ? new Date(new Date(earliest).getTime() - 30 * 60 * 1000).toISOString()
    : new Date().toISOString();

  // Pad the end 30 min after the last scorecard
  const endDate = latest
    ? new Date(new Date(latest).getTime() + 30 * 60 * 1000).toISOString()
    : new Date().toISOString();

  const mockData = {
    meta: {
      competitionStart: startDate,
      competitionEnd:   endDate,
    },
    event: json.data?.event,
  };

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const outPath = path.join(DATA_DIR, `${contentType}-${eventId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(mockData, null, 2));

  const totalScorecards = (event.stages ?? []).reduce(
    (sum: number, s: { scorecards?: unknown[] }) => sum + (s.scorecards?.length ?? 0),
    0,
  );
  console.log(`Saved ${totalScorecards} scorecards to ${outPath}`);
  console.log(`Competition window: ${startDate} → ${endDate}`);
  console.log('');
  console.log('Start the mock API server and it will serve this data:');
  console.log('  npm run mock-api');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
