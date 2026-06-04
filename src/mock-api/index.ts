/**
 * Mock GraphQL API server for local development.
 *
 * Mimics the ShootnScoreIt.com GraphQL API endpoint, serving static competition
 * data filtered by a configurable "virtual time". This lets you start the dev
 * server at competition start (no results yet) and fast-forward through the day.
 *
 * Usage:
 *   npm run mock-api          (from project root)
 *   PORT=3001 npm run mock-api
 *
 * Then set in your .env:
 *   GRAPHQL_API_URL=http://localhost:3001/graphql/
 *   GRAPHQL_API_KEY=mock-key
 *
 * Data files:
 *   Place event data at src/mock-api/data/{contentType}-{eventId}.json
 *   Any unknown event falls back to the built-in sample data.
 *
 * Time control API:
 *   GET  /mock/state                      — show virtual time for all events
 *   POST /mock/time  { time }             — jump to ISO timestamp
 *   POST /mock/time  { advanceMinutes }   — advance by N minutes
 *   POST /mock/time  { fastForward:true } — jump to latest available scorecard
 *   POST /mock/reset                      — reset to competition start
 */

import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const PORT = parseInt(process.env.MOCK_API_PORT || '3001', 10);
const DATA_DIR = path.join(__dirname, 'data');

// ============================================================================
// Types
// ============================================================================

interface GraphQLCompetitor {
  id: string;
  first_name: string;
  last_name: string;
  number: string;
  handgun_div?: string;
  handgun_pf?: string;
  get_handgun_div_display?: string;
  get_handgun_pf_display?: string;
  category?: string;
}

interface GraphQLScorecard {
  id: string;
  time: number;
  points: number;
  hitfactor: number;
  ascore: number;
  cscore: number;
  dscore: number;
  miss: number;
  penalty: number;
  procedural: number;
  updated?: string;
  competitor: GraphQLCompetitor;
}

interface GraphQLStage {
  id: string;
  number: number;
  name: string;
  scorecards: GraphQLScorecard[];
}

interface GraphQLEvent {
  id: string;
  name: string;
  uses_stages: boolean;
  stages: GraphQLStage[];
}

interface MockDataFile {
  meta: {
    competitionStart: string;
    competitionEnd: string;
  };
  event: GraphQLEvent;
}

// ============================================================================
// Sample data generator
// ============================================================================

/** Deterministic number in [0,1) seeded by integer n */
function det(n: number): number {
  const x = Math.sin(n + 1) * 73856093;
  return x - Math.floor(x);
}

function generateSampleData(): MockDataFile {
  const competitionStart = '2025-06-01T09:00:00Z';
  const competitionEnd = '2025-06-01T18:00:00Z';
  const startMs = new Date(competitionStart).getTime();

  const divisions = [
    { code: 'hg18', display: 'Production Optics', pf: '-', pfDisplay: 'Minor' },
    { code: 'hg3',  display: 'Production',         pf: '-', pfDisplay: 'Minor' },
    { code: 'hg2',  display: 'Standard',            pf: '+', pfDisplay: 'Major' },
    { code: 'hg1',  display: 'Open',                pf: '+', pfDisplay: 'Major' },
  ];

  const firstNames = ['Lars', 'Erik', 'Anna', 'Johan', 'Maria', 'Mikael', 'Sofia', 'Anders', 'Emma', 'Peter'];
  const lastNames  = ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsson', 'Persson', 'Svensson', 'Gustafsson'];

  interface CompEntry { competitor: GraphQLCompetitor; globalIdx: number }
  const allCompetitors: CompEntry[] = [];
  let num = 1;

  divisions.forEach((div) => {
    for (let i = 0; i < 10; i++) {
      allCompetitors.push({
        competitor: {
          id: `comp-${num}`,
          first_name: firstNames[i % firstNames.length],
          last_name: lastNames[(i + num) % lastNames.length],
          number: String(num),
          handgun_div: div.code,
          handgun_pf: div.pf,
          get_handgun_div_display: div.display,
          get_handgun_pf_display: div.pfDisplay,
          category: i === 2 ? 'S' : i === 7 ? 'L' : undefined,
        },
        globalIdx: num - 1,
      });
      num++;
    }
  });

  const NUM_STAGES = 6;
  const stageNames = [
    'The Long Run', 'Close Quarters', 'Speed Challenge',
    'Technical Stage', 'No-Shoot Nightmare', 'Final Showdown',
  ];

  // Competition schedule: squads of 10 rotate through stages.
  // Squad 0: stages 1,2,3,4,5,6 starting at 9:00
  // Squad 1: stages 2,3,4,5,6,1 starting at 9:00
  // Squad 2: stages 3,4,5,6,1,2 starting at 9:00
  // Squad 3: stages 4,5,6,1,2,3 starting at 9:00
  // Each stage slot is 75 min.  Within a slot each competitor has a ~4-min window.
  const SLOT_MS   = 75 * 60 * 1000;
  const WITHIN_MS =  4 * 60 * 1000;
  const TOTAL_COMP = allCompetitors.length;
  const SQUAD_SIZE = TOTAL_COMP / 4; // 10

  const stages: GraphQLStage[] = [];

  for (let sIdx = 0; sIdx < NUM_STAGES; sIdx++) {
    const scorecards: GraphQLScorecard[] = [];

    allCompetitors.forEach((entry, cIdx) => {
      const squadId  = Math.floor(cIdx / SQUAD_SIZE);           // 0-3
      const posInSquad = cIdx % SQUAD_SIZE;                      // 0-9

      // Which time slot does this squad shoot this stage?
      const stageOrder = (sIdx - squadId + NUM_STAGES) % NUM_STAGES;
      const slotStartMs = startMs + stageOrder * SLOT_MS;
      const jitterMs    = Math.floor(det(cIdx * 100 + sIdx) * WITHIN_MS);
      const shotMs      = slotStartMs + posInSquad * WITHIN_MS + jitterMs;

      if (shotMs >= new Date(competitionEnd).getTime()) return;

      const updatedISO = new Date(shotMs).toISOString();

      // Deterministic score generation
      const seed = entry.globalIdx * 7 + sIdx * 13;
      const totalRounds = 30;
      const rawA   = Math.floor(det(seed)     * 11) + 19; // 19-29
      const rawC   = Math.floor(det(seed + 1) *  8);       // 0-7
      const rawD   = Math.floor(det(seed + 2) *  3);       // 0-2
      const rawMiss = det(seed + 3) < 0.15 ? 1 : 0;       // 15% chance of miss

      // Ensure total <= totalRounds
      let A = rawA, C = rawC, D = rawD, miss = rawMiss;
      const total = A + C + D + miss;
      if (total > totalRounds) {
        A = Math.max(0, A - (total - totalRounds));
      }

      const points = A * 5 + C * 4 + D * 1 - miss * 10;
      const timeSec = 5 + det(seed + 4) * 30; // 5-35 s
      const hitfactor = timeSec > 0 ? Math.max(0, points) / timeSec : 0;

      scorecards.push({
        id: `sc-${sIdx + 1}-${entry.competitor.id}`,
        time:       Math.round(timeSec * 100) / 100,
        points:     Math.max(0, points),
        hitfactor:  Math.round(hitfactor * 10000) / 10000,
        ascore:     A,
        cscore:     C,
        dscore:     D,
        miss,
        penalty:    0,
        procedural: 0,
        updated:    updatedISO,
        competitor: entry.competitor,
      });
    });

    stages.push({
      id:     `stage-${sIdx + 1}`,
      number: sIdx + 1,
      name:   stageNames[sIdx],
      scorecards,
    });
  }

  return {
    meta: { competitionStart, competitionEnd },
    event: {
      id:         'sample',
      name:       'Sample IPSC Match 2025',
      uses_stages: true,
      stages,
    },
  };
}

// ============================================================================
// Data loading
// ============================================================================

const dataCache: Map<string, MockDataFile> = new Map();
let sampleData: MockDataFile | null = null;

/**
 * Real SSI snapshots often ship a useless `updated` field: when a competition is
 * finalized, every scorecard is re-verified at the end, stamping ~all of them with
 * the same end-of-match timestamp. That collapses virtual-time playback into a cliff
 * — nothing visible for most of the run, then everything at once.
 *
 * The scorecard `id` is assigned at creation, so its order is the true chronological
 * sequence in which scores were entered. When we detect this degenerate clustering,
 * we rewrite each card's `updated` to a synthetic time spread evenly across the
 * competition window in id order, restoring a smooth progressive reveal. Data whose
 * timestamps are already well-distributed (e.g. the generated sample data) is left
 * untouched.
 */
function applyRevealSchedule(data: MockDataFile): void {
  const cards: GraphQLScorecard[] = [];
  for (const stage of data.event.stages) {
    for (const sc of stage.scorecards) cards.push(sc);
  }
  if (cards.length === 0) return;

  // Degeneracy check: does one hour-bucket hold more than half the scorecards?
  const buckets = new Map<string, number>();
  for (const sc of cards) {
    const hour = sc.updated ? sc.updated.slice(0, 13) : 'none';
    buckets.set(hour, (buckets.get(hour) ?? 0) + 1);
  }
  const dominant = Math.max(...buckets.values());
  if (dominant / cards.length <= 0.5) return; // timestamps look genuine — leave them

  const startMs = new Date(data.meta.competitionStart).getTime();
  const endMs = new Date(data.meta.competitionEnd).getTime();
  const span = Math.max(0, endMs - startMs);

  // Sort by numeric id (creation order); fall back to lexical for non-numeric ids.
  const sorted = [...cards].sort((a, b) => {
    const na = Number(a.id);
    const nb = Number(b.id);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const n = sorted.length;
  sorted.forEach((sc, i) => {
    const frac = (i + 1) / (n + 1); // strictly inside (start, end) so t=start is empty
    sc.updated = new Date(startMs + frac * span).toISOString();
  });

  console.log(
    `[mock-api] Clobbered timestamps detected (${dominant}/${n} scorecards share one hour). ` +
    'Rewrote `updated` to an id-ordered even spread across the competition window.',
  );
}

function loadEventData(contentType: number | string, eventId: string): MockDataFile {
  const key = `${contentType}-${eventId}`;

  if (dataCache.has(key)) return dataCache.get(key)!;

  const filePath = path.join(DATA_DIR, `${key}.json`);
  if (fs.existsSync(filePath)) {
    const data: MockDataFile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    applyRevealSchedule(data);
    dataCache.set(key, data);
    console.log(`[mock-api] Loaded data from ${filePath}`);
    return data;
  }

  // Fall back to sample data (generated once, reused for all unknown events)
  if (!sampleData) {
    sampleData = generateSampleData();
    console.log('[mock-api] Using generated sample data (no data file found for this event)');
    console.log(`[mock-api] To use real data, save it to: ${path.join(DATA_DIR, `${key}.json`)}`);
  }
  return sampleData;
}

// ============================================================================
// Virtual time state
// ============================================================================

/** eventKey → ISO timestamp */
const virtualTimes: Map<string, string> = new Map();

function getVirtualTime(eventKey: string, data: MockDataFile): string {
  return virtualTimes.get(eventKey) ?? data.meta.competitionStart;
}

function findLatestTimestamp(data: MockDataFile): string {
  let latest = data.meta.competitionStart;
  for (const stage of data.event.stages) {
    for (const sc of stage.scorecards) {
      if (sc.updated && sc.updated > latest) latest = sc.updated;
    }
  }
  return latest;
}

function countVisibleScorecards(data: MockDataFile, virtualTime: string): number {
  let count = 0;
  for (const stage of data.event.stages) {
    count += stage.scorecards.filter((sc) => sc.updated && sc.updated <= virtualTime).length;
  }
  return count;
}

// ============================================================================
// GraphQL response filtering
// ============================================================================

/**
 * Returns an event with scorecards filtered to those with:
 *   updated <= virtualTime   (always)
 *   updated >  updatedAfter  (only for incremental queries)
 */
function filterEvent(
  event: GraphQLEvent,
  virtualTime: string,
  updatedAfter?: string,
): GraphQLEvent {
  return {
    ...event,
    stages: event.stages.map((stage) => ({
      ...stage,
      scorecards: stage.scorecards.filter((sc) => {
        if (!sc.updated) return false;
        if (sc.updated > virtualTime) return false;
        if (updatedAfter && sc.updated <= updatedAfter) return false;
        return true;
      }),
    })),
  };
}

// ============================================================================
// Express server
// ============================================================================

const app = express();
app.use(express.json());

// Allow CORS for local dev (frontend on :3002, mock on :3001)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

app.options('*', (_req, res) => res.sendStatus(204));

// ─── GraphQL endpoint ────────────────────────────────────────────────────────

app.post('/graphql/', (req: Request, res: Response) => {
  const { query = '', variables = {} } = req.body as {
    query?: string;
    variables?: Record<string, unknown>;
  };

  const contentType = variables.contentType;
  const eventId     = String(variables.eventId ?? 'sample');
  const updatedAfter = variables.updatedAfter as string | undefined;

  if (contentType === undefined) {
    return res.status(400).json({ errors: [{ message: 'Missing contentType variable' }] });
  }

  const data = loadEventData(contentType as number, eventId);
  const eventKey = `${contentType}-${eventId}`;
  const virtualTime = getVirtualTime(eventKey, data);

  const isIncremental = /GetLiveScoresIncremental/.test(query) || updatedAfter !== undefined;

  const filteredEvent = filterEvent(data.event, virtualTime, isIncremental ? updatedAfter : undefined);

  // For the incremental query the real API omits `uses_stages`
  const responseEvent = isIncremental
    ? (({ uses_stages: _omit, ...rest }) => rest)(filteredEvent)
    : filteredEvent;

  const visible  = countVisibleScorecards(data, virtualTime);
  const total    = data.event.stages.reduce((s, st) => s + st.scorecards.length, 0);

  console.log(
    `[mock-api] ${isIncremental ? 'incremental' : 'full'} query` +
    ` event=${eventId} virtualTime=${virtualTime}` +
    ` visible=${visible}/${total}` +
    (updatedAfter ? ` updatedAfter=${updatedAfter}` : ''),
  );

  res.json({ data: { event: responseEvent } });
});

// ─── Mock control endpoints ──────────────────────────────────────────────────

app.get('/mock/state', (_req: Request, res: Response) => {
  const events: Record<string, unknown>[] = [];

  // Report state for all events that have been accessed
  for (const [key, virtualTime] of virtualTimes.entries()) {
    const [ct, ...rest] = key.split('-');
    const evId = rest.join('-');
    const data = dataCache.get(key) ?? sampleData;
    if (!data) continue;
    const total   = data.event.stages.reduce((s, st) => s + st.scorecards.length, 0);
    const visible = countVisibleScorecards(data, virtualTime);
    events.push({
      key, contentType: ct, eventId: evId,
      eventName: data.event.name,
      virtualTime,
      competitionStart: data.meta.competitionStart,
      competitionEnd:   data.meta.competitionEnd,
      scorecards: { visible, total },
    });
  }

  res.json({
    port: PORT,
    dataDir: DATA_DIR,
    events,
    hint: events.length === 0
      ? 'No events queried yet. Make a request to /graphql/ first, then come back.'
      : undefined,
  });
});

app.post('/mock/time', (req: Request, res: Response) => {
  const { contentType, eventId, time, advanceMinutes, fastForward } = req.body as {
    contentType?: number | string;
    eventId?: string;
    time?: string;
    advanceMinutes?: number;
    fastForward?: boolean;
  };

  if (contentType === undefined || eventId === undefined) {
    return res.status(400).json({ error: 'contentType and eventId are required' });
  }

  const key  = `${contentType}-${eventId}`;
  const data = loadEventData(contentType as number, String(eventId));
  let virtualTime = getVirtualTime(key, data);

  if (time) {
    virtualTime = time;
  } else if (advanceMinutes !== undefined) {
    const d = new Date(virtualTime);
    d.setMinutes(d.getMinutes() + advanceMinutes);
    virtualTime = d.toISOString();
  } else if (fastForward) {
    virtualTime = findLatestTimestamp(data);
  } else {
    return res.status(400).json({ error: 'Provide time, advanceMinutes, or fastForward:true' });
  }

  // Clamp to [competitionStart, competitionEnd]
  if (virtualTime < data.meta.competitionStart) virtualTime = data.meta.competitionStart;
  if (virtualTime > data.meta.competitionEnd)   virtualTime = data.meta.competitionEnd;

  virtualTimes.set(key, virtualTime);

  const visible = countVisibleScorecards(data, virtualTime);
  const total   = data.event.stages.reduce((s, st) => s + st.scorecards.length, 0);

  console.log(`[mock-api] Time set to ${virtualTime} (${visible}/${total} scorecards visible)`);
  res.json({ virtualTime, scorecards: { visible, total } });
});

app.post('/mock/reset', (req: Request, res: Response) => {
  const { contentType, eventId } = req.body as { contentType?: number | string; eventId?: string };

  if (contentType === undefined || eventId === undefined) {
    return res.status(400).json({ error: 'contentType and eventId are required' });
  }

  const key  = `${contentType}-${eventId}`;
  const data = loadEventData(contentType as number, String(eventId));
  virtualTimes.set(key, data.meta.competitionStart);

  console.log(`[mock-api] Reset to competition start: ${data.meta.competitionStart}`);
  res.json({ virtualTime: data.meta.competitionStart });
});

// ─── Startup ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log(`║  Mock API running on http://localhost:${PORT}  ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('Configure the backend server with:');
  console.log(`  GRAPHQL_API_URL=http://localhost:${PORT}/graphql/`);
  console.log('  GRAPHQL_API_KEY=mock-key');
  console.log('');
  console.log('Control time via:');
  console.log(`  GET  http://localhost:${PORT}/mock/state`);
  console.log(`  POST http://localhost:${PORT}/mock/time  { "contentType":22, "eventId":"21833", "advanceMinutes":30 }`);
  console.log(`  POST http://localhost:${PORT}/mock/time  { "contentType":22, "eventId":"21833", "fastForward":true }`);
  console.log(`  POST http://localhost:${PORT}/mock/reset { "contentType":22, "eventId":"21833" }`);
  console.log('');
  console.log(`Data directory: ${DATA_DIR}`);
  console.log('Place {contentType}-{eventId}.json files there to use real competition data.');
  console.log('');
});
