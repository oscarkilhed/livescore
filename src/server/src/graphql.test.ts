import {
  transformScorecard,
  transformStages,
  inferPowerFactor,
  determinePowerFactor,
  DIVISION_CODE_MAP,
  DIVISION_DISPLAY_MAP,
  GraphQLScorecard,
  GraphQLStage,
  clearGraphQLCache,
  getGraphQLCacheStats,
} from './graphql';

describe('GraphQL Module', () => {
  describe('determinePowerFactor', () => {
    it('should return Major when display shows Major', () => {
      expect(determinePowerFactor('+', 'Major')).toBe('Major');
      expect(determinePowerFactor('-', 'Major')).toBe('Major'); // Display takes precedence
      expect(determinePowerFactor(undefined, 'Major')).toBe('Major');
    });

    it('should return Minor when display shows Minor', () => {
      expect(determinePowerFactor('-', 'Minor')).toBe('Minor');
      expect(determinePowerFactor(undefined, 'Minor')).toBe('Minor');
    });

    it('should use handgun_pf when display is not available', () => {
      expect(determinePowerFactor('+', undefined)).toBe('Major');
      expect(determinePowerFactor('-', undefined)).toBe('Minor');
      expect(determinePowerFactor(undefined, undefined)).toBe('Minor');
    });
  });

  describe('inferPowerFactor (legacy)', () => {
    it('should return Major for division ending with +', () => {
      expect(inferPowerFactor('OPEN+')).toBe('Major');
      expect(inferPowerFactor('Standard+')).toBe('Major');
    });

    it('should return Minor for divisions without +', () => {
      expect(inferPowerFactor('PROD')).toBe('Minor');
      expect(inferPowerFactor('PO')).toBe('Minor');
    });
  });

  describe('DIVISION_DISPLAY_MAP', () => {
    it('should have display names for division codes', () => {
      expect(DIVISION_DISPLAY_MAP['hg1']).toBe('Open');
      expect(DIVISION_DISPLAY_MAP['hg2']).toBe('Standard');
      expect(DIVISION_DISPLAY_MAP['hg3']).toBe('Production');
      expect(DIVISION_DISPLAY_MAP['hg5']).toBe('Revolver');
      expect(DIVISION_DISPLAY_MAP['hg12']).toBe('Classic');
      expect(DIVISION_DISPLAY_MAP['hg18']).toBe('Production Optics');
    });
  });

  describe('DIVISION_CODE_MAP (backward compatibility)', () => {
    it('should be the same as DIVISION_DISPLAY_MAP', () => {
      expect(DIVISION_CODE_MAP).toBe(DIVISION_DISPLAY_MAP);
    });
  });

  describe('transformScorecard', () => {
    const mockScorecard: GraphQLScorecard = {
      id: '123',
      time: 25.5,
      points: 120,
      hitfactor: 4.7059,
      ascore: 10,
      bscore: 1,  // NS
      cscore: 2,
      dscore: 1,
      hscore: 0,  // M
      competitor: {
        id: '456',
        first_name: 'John',
        last_name: 'Doe',
        number: '42',
        handgun_div: 'hg18',
        handgun_pf: '-',
        get_handgun_div_display: 'Production Optics',
        get_handgun_pf_display: 'Minor',
        category: 'S',
      },
    };

    it('should transform scorecard to competitor format', () => {
      const competitor = transformScorecard(mockScorecard);

      expect(competitor.name).toBe('John Doe');
      expect(competitor.division).toBe('Production Optics');
      expect(competitor.powerFactor).toBe('Minor');
      expect(competitor.category).toBe('S');
      expect(competitor.hitFactor).toBe(4.7059);
      expect(competitor.time).toBe(25.5);
      expect(competitor.points).toBe(120);
      expect(competitor.competitorKey).toBe('42');
    });

    it('should correctly detect Major power factor', () => {
      const majorScorecard: GraphQLScorecard = {
        ...mockScorecard,
        competitor: {
          ...mockScorecard.competitor,
          handgun_pf: '+',
          get_handgun_pf_display: 'Major',
        },
      };

      const competitor = transformScorecard(majorScorecard);
      expect(competitor.powerFactor).toBe('Major');
    });

    it('should map hits correctly', () => {
      const competitor = transformScorecard(mockScorecard);

      expect(competitor.hits.A).toBe(10);
      expect(competitor.hits.C).toBe(2);
      expect(competitor.hits.D).toBe(1);
      expect(competitor.hits.M).toBe(0);  // hscore
      expect(competitor.hits.NS).toBe(1); // bscore
    });

    it('should handle missing competitor number by using name|division as key', () => {
      const scorecardWithoutNumber: GraphQLScorecard = {
        ...mockScorecard,
        competitor: {
          ...mockScorecard.competitor,
          number: '',
        },
      };

      const competitor = transformScorecard(scorecardWithoutNumber);
      expect(competitor.competitorKey).toBe('John Doe|Production Optics');
    });

    it('should use display division from get_handgun_div_display', () => {
      const competitor = transformScorecard(mockScorecard);
      expect(competitor.division).toBe('Production Optics');
    });

    it('should fall back to DIVISION_DISPLAY_MAP when get_handgun_div_display is not available', () => {
      const scorecardWithoutDisplay: GraphQLScorecard = {
        ...mockScorecard,
        competitor: {
          ...mockScorecard.competitor,
          get_handgun_div_display: undefined,
        },
      };

      const competitor = transformScorecard(scorecardWithoutDisplay);
      expect(competitor.division).toBe('Production Optics'); // From DIVISION_DISPLAY_MAP['hg18']
    });

    it('should handle unknown division code', () => {
      const scorecardWithUnknownDivision: GraphQLScorecard = {
        ...mockScorecard,
        competitor: {
          ...mockScorecard.competitor,
          handgun_div: 'hg99',
          get_handgun_div_display: undefined,
        },
      };

      const competitor = transformScorecard(scorecardWithUnknownDivision);
      expect(competitor.division).toBe('hg99'); // Falls back to code
    });

    it('should handle zero values', () => {
      const scorecardWithZeros: GraphQLScorecard = {
        id: '123',
        time: 0,
        points: 0,
        hitfactor: 0,
        ascore: 0,
        bscore: 0,
        cscore: 0,
        dscore: 0,
        hscore: 0,
        competitor: {
          id: '456',
          first_name: 'Jane',
          last_name: 'Smith',
          number: '99',
          handgun_div: 'hg2',
          handgun_pf: '-',
          get_handgun_div_display: 'Standard',
          get_handgun_pf_display: 'Minor',
        },
      };

      const competitor = transformScorecard(scorecardWithZeros);
      expect(competitor.time).toBe(0);
      expect(competitor.points).toBe(0);
      expect(competitor.hitFactor).toBe(0);
      expect(competitor.hits.A).toBe(0);
    });
  });

  describe('transformStages', () => {
    const mockStages: GraphQLStage[] = [
      {
        id: 'stage1',
        number: 1,
        name: 'Stage 1',
        scorecards: [
          {
            id: '1',
            time: 20.0,
            points: 100,
            hitfactor: 5.0,
            ascore: 10,
            bscore: 0,
            cscore: 0,
            dscore: 0,
            hscore: 0,
            competitor: {
              id: 'c1',
              first_name: 'Alice',
              last_name: 'Johnson',
              number: '1',
              handgun_div: 'hg18',
              handgun_pf: '-',
              get_handgun_div_display: 'Production Optics',
              get_handgun_pf_display: 'Minor',
            },
          },
          {
            id: '2',
            time: 25.0,
            points: 90,
            hitfactor: 3.6,
            ascore: 8,
            bscore: 0,
            cscore: 2,
            dscore: 0,
            hscore: 0,
            competitor: {
              id: 'c2',
              first_name: 'Bob',
              last_name: 'Williams',
              number: '2',
              handgun_div: 'hg12',
              handgun_pf: '-',
              get_handgun_div_display: 'Production',
              get_handgun_pf_display: 'Minor',
            },
          },
        ],
      },
      {
        id: 'stage2',
        number: 2,
        name: 'Stage 2',
        scorecards: [
          {
            id: '3',
            time: 15.0,
            points: 80,
            hitfactor: 5.33,
            ascore: 8,
            bscore: 0,
            cscore: 0,
            dscore: 0,
            hscore: 0,
            competitor: {
              id: 'c1',
              first_name: 'Alice',
              last_name: 'Johnson',
              number: '1',
              handgun_div: 'hg18',
              handgun_pf: '-',
              get_handgun_div_display: 'Production Optics',
              get_handgun_pf_display: 'Minor',
            },
          },
        ],
      },
    ];

    it('should transform all stages without filter', () => {
      const stages = transformStages(mockStages);

      expect(stages).toHaveLength(2);
      expect(stages[0].stage).toBe(1);
      expect(stages[0].competitors).toHaveLength(2);
      expect(stages[1].stage).toBe(2);
      expect(stages[1].competitors).toHaveLength(1);
    });

    it('should include procedures property set to 0', () => {
      const stages = transformStages(mockStages);

      stages.forEach((stage) => {
        expect(stage.procedures).toBe(0);
      });
    });

    it('should filter by division code (hg18 = Production Optics)', () => {
      const stages = transformStages(mockStages, 'hg18');

      expect(stages).toHaveLength(2);
      expect(stages[0].competitors).toHaveLength(1);
      expect(stages[0].competitors[0].name).toBe('Alice Johnson');
      expect(stages[0].competitors[0].division).toBe('Production Optics');
      expect(stages[1].competitors).toHaveLength(1);
    });

    it('should filter for Production division (hg12)', () => {
      const stages = transformStages(mockStages, 'hg12');

      expect(stages).toHaveLength(2);
      expect(stages[0].competitors).toHaveLength(1);
      expect(stages[0].competitors[0].name).toBe('Bob Williams');
      expect(stages[0].competitors[0].division).toBe('Production');
      expect(stages[1].competitors).toHaveLength(0);
    });

    it('should return all competitors when division is "all"', () => {
      const stages = transformStages(mockStages, 'all');

      expect(stages[0].competitors).toHaveLength(2);
    });

    it('should handle empty stages', () => {
      const emptyStages: GraphQLStage[] = [
        {
          id: 'stage1',
          number: 1,
          name: 'Empty Stage',
          scorecards: [],
        },
      ];

      const stages = transformStages(emptyStages);

      expect(stages).toHaveLength(1);
      expect(stages[0].competitors).toHaveLength(0);
    });

    it('should preserve stage numbers from GraphQL', () => {
      const nonSequentialStages: GraphQLStage[] = [
        {
          id: 'stage1',
          number: 5,
          name: 'Stage 5',
          scorecards: [],
        },
        {
          id: 'stage2',
          number: 10,
          name: 'Stage 10',
          scorecards: [],
        },
      ];

      const stages = transformStages(nonSequentialStages);

      expect(stages[0].stage).toBe(5);
      expect(stages[1].stage).toBe(10);
    });
  });

  describe('GraphQL Cache', () => {
    beforeEach(() => {
      clearGraphQLCache();
    });

    it('should start with empty cache', () => {
      const stats = getGraphQLCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.entries).toHaveLength(0);
    });

    it('should clear cache for specific event', () => {
      // Cache is empty initially
      const stats = getGraphQLCacheStats();
      expect(stats.size).toBe(0);
      
      // Clear specific event should not throw
      clearGraphQLCache(22, '21833');
      expect(getGraphQLCacheStats().size).toBe(0);
    });

    it('should clear all cache entries', () => {
      clearGraphQLCache();
      expect(getGraphQLCacheStats().size).toBe(0);
    });
  });
});

