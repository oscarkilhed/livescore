import { Stage, StageScore, CompetitorWithTotalScore, Competitor, CompetitorKey } from './types';

export type RivalConfidence = 'high' | 'medium' | 'low';

export interface RivalResult {
    competitor: CompetitorWithTotalScore;
    avgPct: number;
    refAvgPct: number;
    gap: number;
    sharedStages: number;
    /** Number of stages the rival's average is based on (their own sample size). */
    rivalStages: number;
    /** Number of stages the reference's average is based on. */
    refStages: number;
    confidence: RivalConfidence;
}

export interface ProjectedFinish {
    competitorKey: string;
    /** 1-based rank in the live standings (total-score order), biased by how many stages each has shot. */
    currentPosition: number;
    /** Stages the reference competitor has shot so far. */
    currentStagesShot: number;
    /** Distinct stage count in the match. */
    totalStages: number;

    /** Projected rank by average stage % among the started field. */
    projectedPosition: number;
    /** projectedPosition / startedCount * 100 — "projected top X%". Robust to unknown final field size. */
    projectedPercentile: number;
    /** Optimistic / pessimistic ends of the range derived from the competitor's own stage-to-stage consistency. */
    projectedBestPosition: number;
    projectedWorstPosition: number;
    projectedBestPercentile: number;
    projectedWorstPercentile: number;

    /** Reference competitor's mean stage %. */
    refAvgPct: number;
    /** refAvgPct / max(avg in field) * 100 — projected % of the projected winner. */
    projectedPctOfWinner: number;

    /** Number of competitors visible so far (the projection universe). */
    startedCount: number;
    confidence: RivalConfidence;
    /** Standard error of the mean stage %, in percentage points (0 if <2 stages). */
    stdErr: number;
}

export interface ProjectedStandingEntry {
    competitor: CompetitorWithTotalScore;
    /** Mean stage % (the skill proxy the projected order is sorted by). */
    avgPct: number;
    /** Stages the competitor has shot (sample size). */
    stagesShot: number;
    /** Competition rank by avgPct (1-based; ties share the better rank). */
    projectedPosition: number;
    /** avgPct / max(avg in field) * 100 — projected % of the projected winner. */
    projectedPctOfWinner: number;
    confidence: RivalConfidence;
}

/**
 * Calculates the maximum possible score for each stage.
 * 
 * If a stage already has a maxPossibleScore set, it is preserved.
 * Otherwise, the max possible score is calculated based on the total number
 * of hits (A, C, D, M) multiplied by 5 (the maximum points per hit).
 * 
 * @param stages - Array of Stage objects
 * @returns Array of Stage objects with maxPossibleScore populated
 * 
 * @example
 * ```typescript
 * const stagesWithMaxScores = calculateMaxPossibleScores(stages);
 * ```
 */
export function calculateMaxPossibleScores(stages: Stage[]): Stage[] {
    return stages.map(stage => {
        if (stage.competitors.length === 0) {
            return {
                ...stage,
                maxPossibleScore: undefined
            };
        }
        if (stage.maxPossibleScore) {
            return stage;
        }
        const competitor = stage.competitors[0];
        const maxPossibleScore = (competitor.hits.A + competitor.hits.C + competitor.hits.D + competitor.hits.M) * 5;
        return {
            ...stage,
            maxPossibleScore
        };
    });
}

/**
 * Calculates the stage score for a single competitor.
 * 
 * Score calculation formula: (competitor.hitFactor / maxHitFactor) * maxPossibleScore
 * Procedures are calculated based on the difference between hits score and points.
 * 
 * @param competitor - The competitor data for this stage
 * @param maxHitFactor - The maximum hit factor among all competitors in this stage
 * @param maxPossibleScore - The maximum possible score for this stage
 * @param stageNumber - The stage number
 * @returns StageScore object with calculated score, procedures, and other data
 */
function calculateStageScore(competitor: Competitor, maxHitFactor: number, maxPossibleScore: number, stageNumber: number, stageName?: string): StageScore {
    // Handle cases where there are no valid hit factors (e.g., empty stage)
    if (!maxHitFactor || maxHitFactor <= 0) {
        return {
            stage: stageNumber,
            stageName: stageName || `Stage ${stageNumber}`,
            score: 0,
            hits: competitor.hits,
            points: competitor.points || 0,
            time: competitor.time || 0,
            procedures: 0,
            maxPossibleScore,
            hitFactor: competitor.hitFactor || 0
        };
    }

    const stageScore = (competitor.hitFactor / maxHitFactor) * maxPossibleScore;
    
    // Procedure count is directly available from the GraphQL API
    const procedures = competitor.procedures ?? 0;

    return {
        stage: stageNumber,
        stageName: stageName || `Stage ${stageNumber}`,
        score: stageScore,
        hits: competitor.hits,
        points: competitor.points || 0,
        time: competitor.time || 0,
        procedures,
        maxPossibleScore,
        hitFactor: competitor.hitFactor || 0
    };
}

/**
 * Internal function to calculate scores for all competitors across given stages.
 * 
 * Scores are always computed relative to the division-wide max hit factor per stage,
 * so a category winner's score reflects their standing within the full division.
 * The category parameter only controls which competitors appear in the returned ranking.
 * 
 * @param stages - Array of Stage objects to process
 * @param category - Optional category filter (e.g., 'Senior', 'Lady'). When set, only
 *   competitors in that category are returned, but scoring still uses the full division.
 * @returns Array of CompetitorWithTotalScore sorted by total score (descending)
 */
function calculateScoresForStages(stages: Stage[], category?: string): CompetitorWithTotalScore[] {
    const competitorSet = new Set<CompetitorKey>();
    stages.forEach(stage => {
        stage.competitors.filter(c => category ? c.category === category : true).forEach(c => competitorSet.add({ name: c.name, division: c.division, category: c.category, key: c.competitorKey }));
    });
    const competitorsToInclude = Array.from(competitorSet);

    const competitorMap = new Map<string, CompetitorWithTotalScore>();
    competitorsToInclude.forEach(competitor => {
        const key = competitor.key;
        competitorMap.set(key, {
            name: competitor.name,
            division: competitor.division,
            category: competitor.category,
            totalScore: 0,
            stageScores: [],
            competitorKey: key
        });
    });

    stages.forEach(stage => {
        const maxPossibleScore = stage.maxPossibleScore || 0;
        // maxHitFactor is always computed from the full division (all competitors),
        // so scores are relative to the division leader, not just the category leader.
        // Category only controls which competitors appear in the final ranking.
        const validHitFactors = stage.competitors
            .map(c => c.hitFactor)
            .filter(hf => hf && hf > 0);
        const maxHitFactor = validHitFactors.length > 0 ? Math.max(...validHitFactors) : 0;

        stage.competitors
            .filter(competitor => competitorsToInclude.some(c => c.key === competitor.competitorKey))
            .forEach(competitor => {
                const key = competitor.competitorKey;
                const competitorData = competitorMap.get(key);
                if (!competitorData) return;
                const stageScore = calculateStageScore(competitor, maxHitFactor, maxPossibleScore, stage.stage, stage.stageName);
                competitorData.stageScores.push(stageScore);
                competitorData.totalScore += stageScore.score;
            });
    });

    return Array.from(competitorMap.values()).sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Compares specific competitors across their common stages.
 * 
 * Only includes stages where all specified competitors participated.
 * This allows for fair comparison by ensuring all competitors shot the same stages.
 * 
 * @param stages - Array of all Stage objects
 * @param competitorKeys - Array of competitor keys to compare (format: "Name|Division")
 * @param category - Optional category filter (e.g., 'Overall', 'Senior', 'Lady')
 * @returns Array of CompetitorWithTotalScore for the specified competitors, sorted by total score
 * 
 * @example
 * ```typescript
 * const comparison = compareCompetitors(stages, [
 *   'Test Competitor A|Production Optics',
 *   'Test Competitor B|Production Optics'
 * ]);
 * ```
 */
export function compareCompetitors(stages: Stage[], competitorKeys: string[], category?: string): CompetitorWithTotalScore[] {
    const commonStages = stages.filter(stage =>
        competitorKeys.every(key =>
            stage.competitors.some(c => c.competitorKey === key)
        )
    );
    const allScores = calculateScoresForStages(commonStages, category);
    return allScores;
}

/**
 * Calculates scores for all competitors across all stages.
 * 
 * This is the main function for calculating competitor scores. It processes
 * all stages and calculates both individual stage scores and total scores.
 * 
 * @param stages - Array of Stage objects (should have maxPossibleScore set)
 * @param category - Optional category filter (e.g., 'Overall', 'Senior', 'Lady')
 * @returns Array of CompetitorWithTotalScore sorted by total score (descending)
 * 
 * @example
 * ```typescript
 * const stagesWithMaxScores = calculateMaxPossibleScores(stages);
 * const competitorScores = calculateCompetitorScores(stagesWithMaxScores);
 * ```
 */
export function calculateCompetitorScores(stages: Stage[], category?: string): CompetitorWithTotalScore[] {
    return calculateScoresForStages(stages, category);
}

/**
 * Average stage score percentage for a competitor — their hit factor as a percentage
 * of the stage leader's, meaned across the stages they have shot. This is the skill
 * proxy that powers both the rivals and projection features. Returns the per-stage
 * `pcts` list too, so callers can measure stage-to-stage consistency (variance).
 */
export function getCompetitorAvgPct(competitorKey: string, stages: Stage[]): { avg: number; count: number; pcts: number[] } | null {
    const pcts: number[] = [];
    for (const stage of stages) {
        const competitor = stage.competitors.find(c => c.competitorKey === competitorKey);
        if (!competitor) continue;
        const validHFs = stage.competitors.map(c => c.hitFactor).filter(hf => hf > 0);
        const maxHF = validHFs.length > 0 ? Math.max(...validHFs) : 0;
        if (maxHF > 0) {
            pcts.push((competitor.hitFactor / maxHF) * 100);
        }
    }
    if (pcts.length === 0) return null;
    return { avg: pcts.reduce((a, b) => a + b, 0) / pcts.length, count: pcts.length, pcts };
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Estimates how trustworthy a rival's similarity score is, given the partial-data
 * realities of a live match. Two factors drive it:
 *  - sample size: the weaker of the two averages (reference vs rival stage counts),
 *    since a comparison is only as solid as its thinner side.
 *  - overlap: how many stages the two actually share, which anchors the cross-stage
 *    normalization. Zero overlap is still usable (that is the point of the feature),
 *    so it floors at a non-zero score rather than disqualifying the rival.
 */
export function computeConfidence(minStages: number, sharedStages: number, totalStages: number): RivalConfidence {
    if (totalStages === 0) return 'low';
    const fullSample = Math.max(3, Math.ceil(totalStages * 0.6));
    const fullOverlap = Math.max(1, Math.ceil(totalStages * 0.4));
    const sampleScore = clamp01(minStages / fullSample);
    const overlapScore = 0.2 + 0.8 * clamp01(sharedStages / fullOverlap);
    const score = 0.6 * sampleScore + 0.4 * overlapScore;
    return score >= 0.75 ? 'high' : score >= 0.45 ? 'medium' : 'low';
}

/**
 * Finds competitors whose average stage score percentage is closest to a reference competitor's,
 * regardless of whether they share any stages. Useful for identifying hidden rivals.
 *
 * @param referenceKey - Competitor key for the reference competitor
 * @param scores - All competitor scores (used to get the ranked list)
 * @param stages - Stages to compute averages against
 * @param count - Number of rivals to return (default 5)
 */
export function findClosestRivals(
    referenceKey: string,
    scores: CompetitorWithTotalScore[],
    stages: Stage[],
    count = 5
): RivalResult[] {
    const ref = getCompetitorAvgPct(referenceKey, stages);
    if (ref === null) return [];
    const totalStages = stages.length;

    const results: RivalResult[] = [];
    for (const c of scores) {
        if (c.competitorKey === referenceKey) continue;
        const rival = getCompetitorAvgPct(c.competitorKey, stages);
        if (rival === null) continue;
        const sharedStages = stages.filter(
            s => s.competitors.some(comp => comp.competitorKey === referenceKey) &&
                 s.competitors.some(comp => comp.competitorKey === c.competitorKey)
        ).length;
        results.push({
            competitor: c,
            avgPct: rival.avg,
            refAvgPct: ref.avg,
            gap: Math.abs(ref.avg - rival.avg),
            sharedStages,
            rivalStages: rival.count,
            refStages: ref.count,
            confidence: computeConfidence(Math.min(ref.count, rival.count), sharedStages, totalStages),
        });
    }

    return results.sort((a, b) => a.gap - b.gap).slice(0, count);
}

/**
 * Projects where a competitor will finish, from partial mid-competition data.
 *
 * Model: assume every competitor finishes at their current average stage %. Since
 * projected final score = avgPct/100 × Σ(maxPossibleScore over all stages) and the Σ
 * term is identical for everyone, the projected final rank is simply the rank by
 * average stage % — no need to know maxPossibleScore for un-shot stages.
 *
 * The live feed only contains competitors who have already shot, and the eventual
 * field size is unknown, so the headline metric is a percentile (rank / started-count),
 * which is unbiased as more competitors start (assuming the started field is a
 * representative sample). A best/worst range is derived from the competitor's own
 * stage-to-stage consistency (standard error of their stage %s). Confidence reuses
 * {@link computeConfidence} with sharedStages = the competitor's own stage count, so it
 * is driven purely by sample size — the intended "few stages = low confidence" semantics.
 *
 * @param referenceKey - Competitor to project.
 * @param scores - Full ranked standings (total-score order); used for currentPosition.
 * @param stages - Stages to project against (already stage/category filtered by caller).
 * @returns A {@link ProjectedFinish}, or null if the competitor has shot no scored stage.
 */
export function computeProjectedFinish(
    referenceKey: string,
    scores: CompetitorWithTotalScore[],
    stages: Stage[],
): ProjectedFinish | null {
    const ref = getCompetitorAvgPct(referenceKey, stages);
    if (ref === null) return null;

    const totalStages = new Set(stages.map(s => s.stage)).size;

    // The projection universe: every competitor who has shot at least one scored stage.
    const field = scores
        .map(c => getCompetitorAvgPct(c.competitorKey, stages))
        .filter((r): r is { avg: number; count: number; pcts: number[] } => r !== null);
    const startedCount = field.length;

    // Rank by avg stage %; strict `>` lets ties share the better (lower) rank.
    const rankAt = (avg: number): number => 1 + field.filter(f => f.avg > avg).length;
    const projectedPosition = rankAt(ref.avg);

    const maxAvg = field.reduce((m, f) => Math.max(m, f.avg), 0);
    const projectedPctOfWinner = maxAvg > 0 ? (ref.avg / maxAvg) * 100 : 0;

    // Range band from the competitor's own consistency (standard error of the mean).
    let stdErr = 0;
    if (ref.count >= 2) {
        const mean = ref.avg;
        const variance = ref.pcts.reduce((s, p) => s + (p - mean) ** 2, 0) / (ref.count - 1);
        stdErr = Math.sqrt(variance) / Math.sqrt(ref.count);
    }
    const projectedBestPosition = rankAt(ref.avg + stdErr);
    const projectedWorstPosition = rankAt(ref.avg - stdErr);

    const toPercentile = (pos: number): number => (startedCount > 0 ? (pos / startedCount) * 100 : 0);

    const currentPosition = 1 + scores.findIndex(c => c.competitorKey === referenceKey);

    return {
        competitorKey: referenceKey,
        currentPosition,
        currentStagesShot: ref.count,
        totalStages,
        projectedPosition,
        projectedPercentile: toPercentile(projectedPosition),
        projectedBestPosition,
        projectedWorstPosition,
        projectedBestPercentile: toPercentile(projectedBestPosition),
        projectedWorstPercentile: toPercentile(projectedWorstPosition),
        refAvgPct: ref.avg,
        projectedPctOfWinner,
        startedCount,
        confidence: computeConfidence(ref.count, ref.count, totalStages),
        stdErr,
    };
}

/**
 * Ranks the whole field by projected finish (average stage %), producing a leaderboard
 * that corrects the mid-competition bias of the accumulated-total standings: competitors
 * who have shot fewer stages are no longer pushed down just for having a smaller total.
 *
 * Each entry carries a sample-size `confidence` so thin-data entries can be flagged.
 * Only competitors who have shot at least one scored stage are included.
 *
 * @param scores - Live standings (any order); the started subset is re-ranked by avg %.
 * @param stages - Stages to rank against (already stage/category filtered by caller).
 * @returns Entries sorted by projectedPosition (best first).
 */
export function computeProjectedStandings(
    scores: CompetitorWithTotalScore[],
    stages: Stage[],
): ProjectedStandingEntry[] {
    const totalStages = new Set(stages.map(s => s.stage)).size;

    // Started field: competitors who have shot at least one scored stage.
    const field = scores
        .map(c => {
            const a = getCompetitorAvgPct(c.competitorKey, stages);
            return a ? { competitor: c, avg: a.avg, count: a.count } : null;
        })
        .filter((x): x is { competitor: CompetitorWithTotalScore; avg: number; count: number } => x !== null);

    const maxAvg = field.reduce((m, f) => Math.max(m, f.avg), 0);
    const sorted = [...field].sort((a, b) => b.avg - a.avg);

    // Competition ranking: ties share the better rank, the next distinct value skips ahead.
    let rank = 0;
    let prevAvg = Number.POSITIVE_INFINITY;
    return sorted.map((f, idx) => {
        if (f.avg < prevAvg) {
            rank = idx + 1;
            prevAvg = f.avg;
        }
        return {
            competitor: f.competitor,
            avgPct: f.avg,
            stagesShot: f.count,
            projectedPosition: rank,
            projectedPctOfWinner: maxAvg > 0 ? (f.avg / maxAvg) * 100 : 0,
            confidence: computeConfidence(f.count, f.count, totalStages),
        };
    });
}
