import { Stage, CompetitorWithTotalScore, StageScore, Competitor } from '../types';
import { calculateMaxPossibleScores, calculateCompetitorScores, compareCompetitors, computeProjectedFinish, getCompetitorAvgPct, computeProjectedStandings } from '../calculator';
// Use the parsed JSON directly
import rawStages from './livescore.json';

// Assert the type of the imported data
const stages = rawStages as Stage[];

// ── Synthetic data helpers for projection tests ──────────────────────
const mkComp = (key: string, hitFactor: number): Competitor => ({
    name: key,
    division: 'Production Optics',
    powerFactor: 'Minor',
    hitFactor,
    time: 10,
    points: 100,
    hits: { A: 20, C: 0, D: 0, M: 0, NS: 0 }, // maxPossibleScore = (A+C+D+M)*5 = 100
    competitorKey: key,
});
// Variant with an explicit round count so stages get different point weights
// (maxPossibleScore = rounds * 5).
const mkCompR = (key: string, hitFactor: number, rounds: number): Competitor => ({
    name: key,
    division: 'Production Optics',
    powerFactor: 'Minor',
    hitFactor,
    time: 10,
    points: rounds * 5,
    hits: { A: rounds, C: 0, D: 0, M: 0, NS: 0 },
    competitorKey: key,
});
const mkStage = (stage: number, comps: Competitor[]): Stage => ({ stage, competitors: comps, procedures: 0 });
const buildScores = (raw: Stage[]) => calculateCompetitorScores(calculateMaxPossibleScores(raw));

describe('Score Calculator', () => {
    test('should calculate max possible scores correctly', () => {
        const stagesWithMaxScores = calculateMaxPossibleScores(stages);
        const expectedScores = [
            { stage: 1, score: 150 },
            { stage: 2, score: 120 },
            { stage: 3, score: 60 },
            { stage: 4, score: 60 },
            { stage: 5, score: 120 },
            { stage: 6, score: 60 },
            { stage: 7, score: 50 }
        ];

        expectedScores.forEach(({ stage, score }) => {
            const stageScore = stagesWithMaxScores.find(s => s.stage === stage);
            expect(stageScore).toBeDefined();
            expect(stageScore?.maxPossibleScore).toBeCloseTo(score, 2);
        });
    });

    test('should calculate competitor scores correctly', () => {
        const stagesWithMaxScores = calculateMaxPossibleScores(stages);
        const competitorScores = calculateCompetitorScores(stagesWithMaxScores);

        // Test a specific competitor's scores
        const testCompetitor = competitorScores.find((c: CompetitorWithTotalScore) => c.competitorKey === 'Competitor 5b668765|Production Optics');
        expect(testCompetitor).toBeDefined();
        expect(testCompetitor?.totalScore).toBeGreaterThan(0);
        
        // Test each stage score individually
        const stageScores = testCompetitor?.stageScores || [];
        for (const stageScore of stageScores) {
            expect(stageScore.score).toBeLessThanOrEqual(stageScore.maxPossibleScore);
            expect(stageScore.score).toBeGreaterThanOrEqual(0);
        }

        // Log the scores for verification
        console.log('Competitor Scores:', {
            name: testCompetitor?.name,
            totalScore: testCompetitor?.totalScore,
            stageScores: stageScores.map((s: StageScore) => ({
                stage: s.stage,
                score: s.score,
                maxPossible: s.maxPossibleScore
            }))
        });
    });

    test('Competitor 5b668765 should have a total score close to 796.9627', () => {
        const stagesWithMaxScores = calculateMaxPossibleScores(stages);
        const competitorScores = calculateCompetitorScores(stagesWithMaxScores);
        
        const oscar = competitorScores.find((c: CompetitorWithTotalScore) => c.competitorKey === 'Competitor 5b668765|Production Optics');
        expect(oscar).toBeDefined();
        expect(oscar?.totalScore).toBeCloseTo(796.9627, 2);
        
        // Log the actual score for debugging
        console.log('Competitor 5b668765 actual total score:', oscar?.totalScore);
    });

    test('Competitor 358a44eb should have a total score close to 1148.9526', () => {
        const stagesWithMaxScores = calculateMaxPossibleScores(stages);
        const competitorScores = calculateCompetitorScores(stagesWithMaxScores);
        
        const david = competitorScores.find((c: CompetitorWithTotalScore) => c.competitorKey === 'Competitor 358a44eb|Production Optics');
        expect(david).toBeDefined();
        expect(david?.totalScore).toBeCloseTo(1148.9526, 2);
        
        // Log the actual score for debugging
        console.log('Competitor 358a44eb actual total score:', david?.totalScore);
    });

    test('compareCompetitors should return correct scores for Competitor 358a44eb, Competitor 5b668765, and Competitor f530b673', () => {
        const stagesWithMaxScores = calculateMaxPossibleScores(stages);
        const competitorsToCompare = [
            'Competitor 358a44eb|Production Optics',
            'Competitor 5b668765|Production Optics',
            'Competitor f530b673|Production Optics'
        ];
        const comparison = compareCompetitors(stagesWithMaxScores, competitorsToCompare);
        
        const david = comparison.find((c: CompetitorWithTotalScore) => c.competitorKey === 'Competitor 358a44eb|Production Optics');
        const oscar = comparison.find((c: CompetitorWithTotalScore) => c.competitorKey === 'Competitor 5b668765|Production Optics');
        const fredrik = comparison.find((c: CompetitorWithTotalScore) => c.competitorKey === 'Competitor f530b673|Production Optics');
        
        expect(david).toBeDefined();
        expect(oscar).toBeDefined();
        expect(fredrik).toBeDefined();
        
        expect(david?.totalScore).toBeCloseTo(782.78, 2);
        expect(oscar?.totalScore).toBeCloseTo(551.88, 2);
        expect(fredrik?.totalScore).toBeCloseTo(469.85, 2);
    });
});

describe('computeProjectedFinish', () => {
    const fixtureStages = calculateMaxPossibleScores(stages);
    const fixtureScores = calculateCompetitorScores(fixtureStages);
    const DAVID = 'Competitor 358a44eb|Production Optics';

    test('returns null for an unknown / zero-stage competitor', () => {
        expect(computeProjectedFinish('nobody|Nowhere', fixtureScores, fixtureStages)).toBeNull();
    });

    test('projectedPosition equals the independently computed avg-stage-% rank', () => {
        const proj = computeProjectedFinish(DAVID, fixtureScores, fixtureStages)!;
        expect(proj).not.toBeNull();

        const refAvg = getCompetitorAvgPct(DAVID, fixtureStages)!.avg;
        const expectedRank = 1 + fixtureScores
            .map(c => getCompetitorAvgPct(c.competitorKey, fixtureStages))
            .filter((r): r is NonNullable<typeof r> => r !== null)
            .filter(r => r.avg > refAvg)
            .length;
        expect(proj.projectedPosition).toBe(expectedRank);
    });

    test('projectedPercentile = projectedPosition / startedCount * 100', () => {
        const proj = computeProjectedFinish(DAVID, fixtureScores, fixtureStages)!;
        expect(proj.projectedPercentile).toBeCloseTo((proj.projectedPosition / proj.startedCount) * 100, 6);
    });

    test('projectedPctOfWinner = refAvg / maxAvg * 100', () => {
        const proj = computeProjectedFinish(DAVID, fixtureScores, fixtureStages)!;
        const avgs = fixtureScores
            .map(c => getCompetitorAvgPct(c.competitorKey, fixtureStages))
            .filter((r): r is NonNullable<typeof r> => r !== null)
            .map(r => r.avg);
        const maxAvg = Math.max(...avgs);
        expect(proj.projectedPctOfWinner).toBeCloseTo((proj.refAvgPct / maxAvg) * 100, 4);
    });

    test('range brackets the point estimate for a multi-stage competitor', () => {
        const proj = computeProjectedFinish(DAVID, fixtureScores, fixtureStages)!;
        expect(proj.currentStagesShot).toBeGreaterThanOrEqual(2);
        expect(proj.projectedBestPosition).toBeLessThanOrEqual(proj.projectedPosition);
        expect(proj.projectedWorstPosition).toBeGreaterThanOrEqual(proj.projectedPosition);
    });

    test('range collapses and stdErr is 0 for a single-stage competitor', () => {
        // 3-stage match. X shoots only stage 1; everyone else shoots all three.
        const raw = [
            mkStage(1, [mkComp('X', 10), mkComp('A', 7), mkComp('B', 7)]),
            mkStage(2, [mkComp('A', 7), mkComp('B', 7), mkComp('C', 10)]),
            mkStage(3, [mkComp('A', 7), mkComp('B', 7), mkComp('C', 10)]),
        ];
        const scores = buildScores(raw);
        const proj = computeProjectedFinish('X', scores, raw)!;
        expect(proj.currentStagesShot).toBe(1);
        expect(proj.stdErr).toBe(0);
        expect(proj.projectedBestPosition).toBe(proj.projectedPosition);
        expect(proj.projectedWorstPosition).toBe(proj.projectedPosition);
    });

    test('current position (total-score order) can be far worse than projected position', () => {
        // X is elite (100% on the one stage shot) but has a tiny total; A/B/C shot all 3.
        const raw = [
            mkStage(1, [mkComp('X', 10), mkComp('A', 7), mkComp('B', 7), mkComp('C', 10)]),
            mkStage(2, [mkComp('A', 7), mkComp('B', 7), mkComp('C', 10)]),
            mkStage(3, [mkComp('A', 7), mkComp('B', 7), mkComp('C', 10)]),
        ];
        const scores = buildScores(raw);
        const proj = computeProjectedFinish('X', scores, raw)!;
        // X ties C at the top of avg% → projected 1st; but X's accumulated total is lowest.
        expect(proj.projectedPosition).toBe(1);
        expect(proj.currentPosition).toBeGreaterThan(proj.projectedPosition);
        expect(proj.startedCount).toBe(scores.length);
    });

    test('confidence reflects sample size', () => {
        // 5-stage match. Reference with 1 stage → low; reference with all 5 → high.
        const raw = [
            mkStage(1, [mkComp('few', 8), mkComp('full', 8), mkComp('Z', 9)]),
            mkStage(2, [mkComp('full', 8), mkComp('Z', 9)]),
            mkStage(3, [mkComp('full', 8), mkComp('Z', 9)]),
            mkStage(4, [mkComp('full', 8), mkComp('Z', 9)]),
            mkStage(5, [mkComp('full', 8), mkComp('Z', 9)]),
        ];
        const scores = buildScores(raw);
        expect(computeProjectedFinish('few', scores, raw)!.confidence).toBe('low');
        expect(computeProjectedFinish('full', scores, raw)!.confidence).toBe('high');
    });
});

describe('computeProjectedStandings', () => {
    const fixtureStages = calculateMaxPossibleScores(stages);
    const fixtureScores = calculateCompetitorScores(fixtureStages);

    test('entries are sorted by avg stage % descending', () => {
        const standings = computeProjectedStandings(fixtureScores, fixtureStages);
        for (let i = 1; i < standings.length; i++) {
            expect(standings[i - 1].avgPct).toBeGreaterThanOrEqual(standings[i].avgPct);
        }
        // projectedPosition is monotonic non-decreasing and starts at 1
        expect(standings[0].projectedPosition).toBe(1);
    });

    test('top entry is 100% of projected winner; others are avg/maxAvg*100', () => {
        const standings = computeProjectedStandings(fixtureScores, fixtureStages);
        const maxAvg = standings[0].avgPct;
        expect(standings[0].projectedPctOfWinner).toBeCloseTo(100, 6);
        const sample = standings[Math.floor(standings.length / 2)];
        expect(sample.projectedPctOfWinner).toBeCloseTo((sample.avgPct / maxAvg) * 100, 4);
    });

    test('only includes competitors who have shot a scored stage', () => {
        const standings = computeProjectedStandings(fixtureScores, fixtureStages);
        const started = fixtureScores.filter(c => getCompetitorAvgPct(c.competitorKey, fixtureStages) !== null);
        expect(standings.length).toBe(started.length);
    });

    test('ties in avg % share the better (lower) rank (competition ranking)', () => {
        // A and B tie at 70%; C is top; D is lowest. Expected ranks: C#1, A#2, B#2, D#4.
        const raw = [mkStage(1, [mkComp('C', 10), mkComp('A', 7), mkComp('B', 7), mkComp('D', 5)])];
        const standings = computeProjectedStandings(buildScores(raw), raw);
        const pos = (k: string) => standings.find(e => e.competitor.competitorKey === k)!.projectedPosition;
        expect(pos('C')).toBe(1);
        expect(pos('A')).toBe(2);
        expect(pos('B')).toBe(2);
        expect(pos('D')).toBe(4); // rank skips 3 after the tie
    });

    test('a single-stage elite tops the projected order on avg %', () => {
        // X shot 1 great stage (top avg%) but tiny total; A/B/C shot all 3 stages.
        const raw = [
            mkStage(1, [mkComp('X', 10), mkComp('A', 7), mkComp('B', 7), mkComp('C', 10)]),
            mkStage(2, [mkComp('A', 7), mkComp('B', 7), mkComp('C', 10)]),
            mkStage(3, [mkComp('A', 7), mkComp('B', 7), mkComp('C', 10)]),
        ];
        const standings = computeProjectedStandings(buildScores(raw), raw);
        const x = standings.find(e => e.competitor.competitorKey === 'X')!;
        expect(x.projectedPosition).toBe(1); // ties C at the top of avg %
    });

    test('confidence is per-entry and sample-size driven', () => {
        const raw = [
            mkStage(1, [mkComp('few', 8), mkComp('full', 8), mkComp('Z', 9)]),
            mkStage(2, [mkComp('full', 8), mkComp('Z', 9)]),
            mkStage(3, [mkComp('full', 8), mkComp('Z', 9)]),
            mkStage(4, [mkComp('full', 8), mkComp('Z', 9)]),
            mkStage(5, [mkComp('full', 8), mkComp('Z', 9)]),
        ];
        const standings = computeProjectedStandings(buildScores(raw), raw);
        expect(standings.find(e => e.competitor.competitorKey === 'few')!.confidence).toBe('low');
        expect(standings.find(e => e.competitor.competitorKey === 'full')!.confidence).toBe('high');
    });
});

describe('points-weighted average', () => {
    test('avg is the points-weighted mean of stage %s', () => {
        // X: 100% on a 60-pt stage (12 rounds), 70% on a 160-pt stage (32 rounds).
        const raw = [
            mkStage(1, [mkCompR('X', 10, 12)]),                       // X alone => 100%, weight 60
            mkStage(2, [mkCompR('X', 7, 32), mkCompR('Y', 10, 32)]),  // X = 7/10 = 70%, weight 160
        ];
        const r = getCompetitorAvgPct('X', raw)!;
        expect(r.weights).toEqual([60, 160]);
        expect(r.avg).toBeCloseTo((100 * 60 + 70 * 160) / (60 + 160), 5); // 78.18, not the flat 85
    });

    test('does NOT penalize shooting small stages — equal % gives equal avg & rank', () => {
        // 'top' leads every stage (100%). S shoots 6 small stages @85%, B shoots 6 big @85%.
        const raw: Stage[] = [];
        for (let s = 1; s <= 6; s++) raw.push(mkStage(s, [mkCompR('top', 10, 12), mkCompR('S', 8.5, 12)]));
        for (let s = 7; s <= 12; s++) raw.push(mkStage(s, [mkCompR('top', 10, 32), mkCompR('B', 8.5, 32)]));
        const avgS = getCompetitorAvgPct('S', raw)!.avg;
        const avgB = getCompetitorAvgPct('B', raw)!.avg;
        expect(avgS).toBeCloseTo(85, 5);
        expect(avgB).toBeCloseTo(85, 5);
        const standings = computeProjectedStandings(buildScores(raw), raw);
        const posS = standings.find(e => e.competitor.competitorKey === 'S')!.projectedPosition;
        const posB = standings.find(e => e.competitor.competitorKey === 'B')!.projectedPosition;
        expect(posS).toBe(posB); // tie — small-stage shooter is not pushed down
    });

    test('ranking favours strength on the bigger (higher-point) stages', () => {
        // P strong on the big stage, Q strong on the small one; identical flat means.
        const raw = [
            mkStage(1, [mkCompR('top', 10, 12), mkCompR('P', 7, 12), mkCompR('Q', 10, 12)]), // small: P 70%, Q 100%
            mkStage(2, [mkCompR('top', 10, 32), mkCompR('P', 10, 32), mkCompR('Q', 7, 32)]), // big:   P 100%, Q 70%
        ];
        const standings = computeProjectedStandings(buildScores(raw), raw);
        const pos = (k: string) => standings.find(e => e.competitor.competitorKey === k)!.projectedPosition;
        expect(pos('P')).toBeLessThan(pos('Q'));
    });

    test('confidence keys off completed POINTS, not stage count', () => {
        // 6 small (60) + 6 big (160) stages; 'top' on all. smallA does 3 small, bigB does 3 big.
        const raw: Stage[] = [];
        for (let s = 1; s <= 6; s++) {
            const comps = [mkCompR('top', 10, 12)];
            if (s <= 3) comps.push(mkCompR('smallA', 8, 12));
            raw.push(mkStage(s, comps));
        }
        for (let s = 7; s <= 12; s++) {
            const comps = [mkCompR('top', 10, 32)];
            if (s <= 9) comps.push(mkCompR('bigB', 8, 32));
            comps.push(mkCompR('fullC', 8, 32)); // fullC shoots all 6 big stages
            raw.push(mkStage(s, comps));
        }
        const standings = computeProjectedStandings(buildScores(raw), raw);
        const rank = { low: 0, medium: 1, high: 2 } as const;
        const conf = (k: string) => rank[standings.find(e => e.competitor.competitorKey === k)!.confidence];
        // smallA & bigB both shot exactly 3 stages, yet bigB covers far more of the
        // match's points — so its dot must be strictly more confident. Stage count alone
        // doesn't decide confidence; completion by points does.
        expect(conf('bigB')).toBeGreaterThan(conf('smallA'));
        // Completing more of the match never lowers confidence.
        expect(conf('fullC')).toBeGreaterThanOrEqual(conf('bigB'));
    });

    test('a streaky shooter reads less confident than a metronome at equal completion', () => {
        // 5 equal-weight stages. M and S each shoot the same 3 stages with the same 80%
        // average, but S is wildly streaky (60/80/100) while M is a metronome (80/80/80).
        const raw = [
            mkStage(1, [mkComp('L', 10), mkComp('M', 8), mkComp('S', 6)]),  // M 80%, S 60%
            mkStage(2, [mkComp('L', 10), mkComp('M', 8), mkComp('S', 8)]),  // M 80%, S 80%
            mkStage(3, [mkComp('L', 10), mkComp('M', 8), mkComp('S', 10)]), // M 80%, S 100%
            mkStage(4, [mkComp('L', 10), mkComp('F', 7)]),
            mkStage(5, [mkComp('L', 10), mkComp('F', 7)]),
        ];
        const scores = buildScores(raw);
        const m = computeProjectedFinish('M', scores, raw)!;
        const s = computeProjectedFinish('S', scores, raw)!;
        // Identical completion and identical average → only consistency differs.
        expect(m.refAvgPct).toBeCloseTo(s.refAvgPct, 6);
        expect(m.currentStagesShot).toBe(s.currentStagesShot);
        // The metronome has the tighter band and the more confident dot.
        expect(s.stdErr).toBeGreaterThan(m.stdErr);
        const rank = { low: 0, medium: 1, high: 2 } as const;
        expect(rank[s.confidence]).toBeLessThan(rank[m.confidence]);
    });

    test('a single flat stage stays low — a tiny sample cannot earn a solid dot', () => {
        // 5-stage match; X has shot only stage 1, so there is no spread signal yet and
        // confidence falls back to completion alone.
        const raw = [
            mkStage(1, [mkComp('X', 10), mkComp('A', 8)]),
            mkStage(2, [mkComp('A', 8)]),
            mkStage(3, [mkComp('A', 8)]),
            mkStage(4, [mkComp('A', 8)]),
            mkStage(5, [mkComp('A', 8)]),
        ];
        const proj = computeProjectedFinish('X', buildScores(raw), raw)!;
        expect(proj.currentStagesShot).toBe(1);
        expect(proj.stdErr).toBe(0);         // no spread with one stage
        expect(proj.confidence).toBe('low'); // completion-only fallback
    });

    test('range widens as less of the match (by points) is completed', () => {
        // R shoots 2 stages with spread (70%, 90%), weights equal.
        const twoStages = [
            mkStage(1, [mkCompR('lead', 10, 20), mkCompR('R', 7, 20)]), // R 70%
            mkStage(2, [mkCompR('lead', 10, 20), mkCompR('R', 9, 20)]), // R 90%
        ];
        const seWhole = computeProjectedFinish('R', buildScores(twoStages), twoStages)!.stdErr;

        // Same two stages, but the match has 10 more stages R hasn't shot (someone else has).
        const bigMatch = [...twoStages.map(s => ({ ...s, competitors: [...s.competitors] }))];
        for (let s = 3; s <= 12; s++) bigMatch.push(mkStage(s, [mkCompR('other', 8, 20)]));
        const sefPartial = computeProjectedFinish('R', buildScores(bigMatch), bigMatch)!.stdErr;

        expect(seWhole).toBeGreaterThan(0);
        expect(sefPartial).toBeGreaterThan(seWhole); // unseen points widen the band
    });

    test('projected order converges to official total order when everyone is complete', () => {
        // 3 stages of different sizes; all three competitors shoot all of them.
        const raw = [
            mkStage(1, [mkCompR('top', 10, 12), mkCompR('mid', 8, 12), mkCompR('low', 5, 12)]),
            mkStage(2, [mkCompR('top', 10, 20), mkCompR('mid', 7, 20), mkCompR('low', 5, 20)]),
            mkStage(3, [mkCompR('top', 10, 32), mkCompR('mid', 9, 32), mkCompR('low', 5, 32)]),
        ];
        const scores = buildScores(raw);
        const standings = computeProjectedStandings(scores, raw);
        // Same order as the official total-score standings.
        expect(standings.map(e => e.competitor.competitorKey)).toEqual(scores.map(c => c.competitorKey));
        // And projected % of winner matches total / winner-total.
        const winnerTotal = scores[0].totalScore;
        standings.forEach(e => {
            const total = scores.find(c => c.competitorKey === e.competitor.competitorKey)!.totalScore;
            expect(e.projectedPctOfWinner).toBeCloseTo((total / winnerTotal) * 100, 4);
        });
    });
});