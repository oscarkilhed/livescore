import { Stage, StageScore, CompetitorWithTotalScore, Competitor, Hits, CompetitorKey } from './types';

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
    const hitsScore = calculateHitsScore(competitor.hits, competitor.powerFactor);
    const procedures = Math.max(0, (hitsScore - (competitor.points || 0)) / 10);

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
 * Calculates the total points score based on hits and power factor.
 * 
 * IPSC scoring:
 * - Major: A=5, C=4, D=2, M=-10, NS=-10
 * - Minor: A=5, C=3, D=1, M=-10, NS=-10
 * 
 * @param hits - Object containing hit counts (A, C, D, M, NS)
 * @param powerFactor - 'Major' or 'Minor'
 * @returns Total points score based on hits
 */
function calculateHitsScore(hits: Hits, powerFactor: string): number {
    if (powerFactor === 'Major') {
        return hits.A * 5 + hits.C * 4 + hits.D * 2 + hits.M * -10 + hits.NS * -10;
    } else {
        return hits.A * 5 + hits.C * 3 + hits.D * 1 + hits.M * -10 + hits.NS * -10;
    }
}

/**
 * Internal function to calculate scores for all competitors across given stages.
 * 
 * Filters competitors by category if provided, then calculates stage scores
 * and total scores for each competitor.
 * 
 * @param stages - Array of Stage objects to process
 * @param category - Optional category filter (e.g., 'Overall', 'Senior', 'Lady')
 * @returns Array of CompetitorWithTotalScore sorted by total score (descending)
 */
function calculateScoresForStages(stages: Stage[], category?: string): CompetitorWithTotalScore[] {
    const competitorSet = new Set<CompetitorKey>();
    stages.forEach(stage => {
        stage.competitors.filter(c => category ? c.category === category : true).forEach(c => competitorSet.add({ name: c.name, division: c.division, key: c.competitorKey }));
    });
    const competitorsToInclude = Array.from(competitorSet);

    const competitorMap = new Map<string, CompetitorWithTotalScore>();
    competitorsToInclude.forEach(competitor => {
        const key = competitor.key;
        competitorMap.set(key, {
            name: competitor.name,
            division: competitor.division,
            totalScore: 0,
            stageScores: [],
            competitorKey: key
        });
    });

    stages.forEach(stage => {
        const maxPossibleScore = stage.maxPossibleScore || 0;
        // Filter competitors by category before calculating maxHitFactor
        // This ensures category-specific rankings (e.g., top Senior gets 100% in Senior category)
        const categoryCompetitors = category 
            ? stage.competitors.filter(c => c.category === category)
            : stage.competitors;
        const validHitFactors = categoryCompetitors
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
