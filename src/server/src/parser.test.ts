import parseLivescore from './parser';
import fs from 'fs/promises';
import path from 'path';

describe('Competitor Parser', () => {
  let htmlContent: string;

  beforeAll(async () => {
    htmlContent = await fs.readFile("test/livescore_all.html", "utf-8");
  });

  it('should parse competitors from livescore.html', () => {
    const stages = parseLivescore(htmlContent);
    // Flatten all competitors from all stages
    const allCompetitors = stages.flatMap(stage => stage.competitors);
    expect(allCompetitors).toBeDefined();
    expect(allCompetitors.length).toBeGreaterThan(0);
    // Check for specific competitors (using anonymized names)
    const competitorB = allCompetitors.find(c => c.name === 'Test Competitor B');
    expect(competitorB).toBeDefined();
    expect(competitorB?.division).toBe('Production Optics');
    expect(competitorB?.powerFactor).toBe('Minor');
    const competitorA = allCompetitors.find(c => c.name === 'Test Competitor A');
    expect(competitorA).toBeDefined();
    expect(competitorA?.division).toBe('Production Optics');
    expect(competitorA?.powerFactor).toBe('Minor');
    const competitorD = allCompetitors.find(c => c.name === 'Test Competitor D');
    expect(competitorD).toBeDefined();
    expect(competitorD?.division).toBe('Standard');
    expect(competitorD?.powerFactor).toBe('Major');
  });

  test('Test Competitor A should have a time of 30.17 seconds on stage 1', () => {
    const stages = parseLivescore(htmlContent);
    const allCompetitors = stages.flatMap(stage => stage.competitors);
    const competitorA = allCompetitors.find(c => c.name === 'Test Competitor A');
    expect(competitorA).toBeDefined();
    const stage1 = stages.find(s => s.stage === 1);
    expect(stage1).toBeDefined();
    const competitorAStage1 = stage1?.competitors.find(c => c.name === 'Test Competitor A');
    expect(competitorAStage1).toBeDefined();
    expect(competitorAStage1?.time).toBe(30.17);
  });

  test('Test Competitor A should have a hit factor of 4.5078 on stage 1', () => {
    const stages = parseLivescore(htmlContent);
    const allCompetitors = stages.flatMap(stage => stage.competitors);
    const competitorA = allCompetitors.find(c => c.name === 'Test Competitor A');
    expect(competitorA).toBeDefined();
    const stage1 = stages.find(s => s.stage === 1);
    expect(stage1).toBeDefined();
    const competitorAStage1 = stage1?.competitors.find(c => c.name === 'Test Competitor A');
    expect(competitorAStage1).toBeDefined();
    expect(competitorAStage1?.hitFactor).toBe(4.5078);
  });
}); 

describe('Competitor Parser with empty stage', () => {
  let htmlContent: string;

  beforeAll(async () => {
    htmlContent = await fs.readFile("test/livescore_with_empty_stage.html", "utf-8");
  });

  it('should parse competitors from livescore.html', () => {
    const stages = parseLivescore(htmlContent);
    // Flatten all competitors from all stages
    const allCompetitors = stages.flatMap(stage => stage.competitors);
    expect(allCompetitors).toBeDefined();
    expect(allCompetitors.length).toBeGreaterThan(0);
    // Check for specific competitors (using anonymized names)
    const competitorB = allCompetitors.find(c => c.name === 'Test Competitor B');
    expect(competitorB).toBeDefined();
    expect(competitorB?.division).toBe('Production Optics');
    expect(competitorB?.powerFactor).toBe('Minor');
    const competitorA = allCompetitors.find(c => c.name === 'Test Competitor A');
    expect(competitorA).toBeDefined();
    expect(competitorA?.division).toBe('Production Optics');
    expect(competitorA?.powerFactor).toBe('Minor');
  });

  test('Test Competitor A should have a time of 30.17 seconds on stage 1', () => {
    const stages = parseLivescore(htmlContent);
    const allCompetitors = stages.flatMap(stage => stage.competitors);
    const competitorA = allCompetitors.find(c => c.name === 'Test Competitor A');
    expect(competitorA).toBeDefined();
    const stage1 = stages.find(s => s.stage === 1);
    expect(stage1).toBeDefined();
    const competitorAStage1 = stage1?.competitors.find(c => c.name === 'Test Competitor A');
    expect(competitorAStage1).toBeDefined();
    expect(competitorAStage1?.time).toBe(30.17);
  });

  test('Test Competitor A should have a hit factor of 4.5078 on stage 1', () => {
    const stages = parseLivescore(htmlContent);
    const allCompetitors = stages.flatMap(stage => stage.competitors);
    const competitorA = allCompetitors.find(c => c.name === 'Test Competitor A');
    expect(competitorA).toBeDefined();
    const stage1 = stages.find(s => s.stage === 1);
    expect(stage1).toBeDefined();
    const competitorAStage1 = stage1?.competitors.find(c => c.name === 'Test Competitor A');
    expect(competitorAStage1).toBeDefined();
    expect(competitorAStage1?.hitFactor).toBe(4.5078);
  });
}); 