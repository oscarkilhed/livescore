import { Stage, CompetitorWithTotalScore, StageScore } from '../types';
import { calculateMaxPossibleScores, calculateCompetitorScores, compareCompetitors } from '../calculator';
// Use the parsed JSON directly
import rawStages from './livescore.json';

// Assert the type of the imported data
const stages = rawStages as Stage[];

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

    

    test('Competitor 5b668765 should have 1 procedure on stage 3', () => {
        const stagesWithMaxScores = calculateMaxPossibleScores(stages);
        const competitorScores = calculateCompetitorScores(stagesWithMaxScores);
        const oscar = competitorScores.find((c: CompetitorWithTotalScore) => c.competitorKey === 'Competitor 5b668765|Production Optics');
        expect(oscar).toBeDefined();
        const stage3 = oscar?.stageScores.find(s => s.stage === 3);
        expect(stage3).toBeDefined();
        expect(stage3?.procedures).toBe(1);
    });
}); 