import { parseECMTxt } from './parser';
import fs from 'fs/promises';

describe('ECM TXT Parser', () => {
  let txtContent: string;

  beforeAll(async () => {
    txtContent = await fs.readFile('test/ECM.txt', 'utf-8');
  });

  it('parses Stage 2 and validates Test Competitor C (#1068) HF and time', () => {
    const stages = parseECMTxt(txtContent);
    expect(stages.length).toBeGreaterThan(1);
    const stage2 = stages.find(s => s.stage === 2);
    expect(stage2).toBeDefined();
    if (!stage2) return;

    const competitor = stage2.competitors.find(c => c.competitorKey === '1068' || c.name.includes('Test Competitor C'));
    expect(competitor).toBeDefined();
    if (!competitor) return;

    expect(competitor.name).toBe('Test Competitor C');
    expect(competitor.competitorKey).toBe('1068');
    expect(competitor.hitFactor).toBeCloseTo(7.9893, 4);
    expect(competitor.time).toBeCloseTo(7.51, 2);
  });
});


