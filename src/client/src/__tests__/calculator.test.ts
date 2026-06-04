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