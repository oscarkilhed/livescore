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
    category?: string;
    powerFactor: 'Major' | 'Minor';
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
    stageName?: string;
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
    key: string;
}