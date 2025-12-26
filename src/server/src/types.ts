export interface Hits {
    A: number;
    C: number;
    D: number;
    M: number;
    NS: number;
}

export interface Competitor {
    name: string;
    division: string;
    powerFactor: 'Major' | 'Minor';
    category?: string;
    hitFactor: number;
    time: number;
    points: number;
    hits: Hits;
    stageScore?: number;
    competitorKey: string;
}

export interface Stage {
    stage: number;
    stageName?: string;
    competitors: Competitor[];
    maxPossibleScore?: number;
    procedures: number;
}

export interface StageScore {
    stage: number;
    score: number;
    maxPossibleScore: number;
    hits: Hits;
    time: number;
    points: number;
    procedures: number;
    hitFactor: number;
}

export interface CompetitorWithTotalScore {
    name: string;
    division: string;
    totalScore: number;
    stageScores: StageScore[];
    competitorKey: string;
} 

export interface CompetitorKey {
    name: string;
    division: string;
}