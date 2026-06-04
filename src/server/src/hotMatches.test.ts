import {
  recordHit,
  getHotMatches,
  _resetHotMatches,
  DEFAULT_WINDOW_MS,
} from './hotMatches';

describe('hotMatches', () => {
  beforeEach(() => {
    _resetHotMatches();
  });

  it('returns nothing when no hits recorded', () => {
    expect(getHotMatches()).toEqual([]);
  });

  it('counts hits for a match and reports the event name', () => {
    const now = 1_000_000;
    recordHit('22', '100', 'all', 'Spring Match', now);
    recordHit('22', '100', 'all', 'Spring Match', now);

    const hot = getHotMatches(12, DEFAULT_WINDOW_MS, now);
    expect(hot).toHaveLength(1);
    expect(hot[0]).toMatchObject({
      matchType: '22',
      matchId: '100',
      eventName: 'Spring Match',
      count: 2,
    });
  });

  it('groups hits across divisions under one match', () => {
    const now = 2_000_000;
    recordHit('22', '200', 'hg18', 'Optics Cup', now);
    recordHit('22', '200', 'hg1', 'Optics Cup', now);
    recordHit('22', '200', 'all', 'Optics Cup', now);

    const hot = getHotMatches(12, DEFAULT_WINDOW_MS, now);
    expect(hot).toHaveLength(1);
    expect(hot[0].count).toBe(3);
  });

  it('ranks matches by recent hit count, descending', () => {
    const now = 3_000_000;
    recordHit('22', 'A', 'all', 'A', now);
    recordHit('22', 'B', 'all', 'B', now);
    recordHit('22', 'B', 'all', 'B', now);
    recordHit('22', 'B', 'all', 'B', now);
    recordHit('22', 'C', 'all', 'C', now);
    recordHit('22', 'C', 'all', 'C', now);

    const hot = getHotMatches(12, DEFAULT_WINDOW_MS, now);
    expect(hot.map(m => m.matchId)).toEqual(['B', 'C', 'A']);
  });

  it('respects the limit', () => {
    const now = 4_000_000;
    recordHit('22', 'A', 'all', 'A', now);
    recordHit('22', 'B', 'all', 'B', now);
    recordHit('22', 'C', 'all', 'C', now);

    expect(getHotMatches(2, DEFAULT_WINDOW_MS, now)).toHaveLength(2);
  });

  it('prunes hits older than the window and drops matches that go cold', () => {
    const windowMs = 1000;
    const start = 5_000_000;
    recordHit('22', 'old', 'all', 'Old', start);

    // Within the window the match is still hot...
    expect(getHotMatches(12, windowMs, start + 500)).toHaveLength(1);

    // ...but once every hit ages out, the match disappears entirely.
    const later = getHotMatches(12, windowMs, start + 2000);
    expect(later).toHaveLength(0);
  });

  it('keeps recent hits while pruning stale ones from the same match', () => {
    const windowMs = 1000;
    const start = 6_000_000;
    recordHit('22', 'M', 'all', 'M', start); // stale
    recordHit('22', 'M', 'all', 'M', start + 900); // fresh

    const hot = getHotMatches(12, windowMs, start + 1200);
    expect(hot).toHaveLength(1);
    expect(hot[0].count).toBe(1); // only the fresh hit survives
  });

  it('picks the most-hit concrete division as topDivision', () => {
    const now = 7_000_000;
    recordHit('22', 'D', 'all', 'D', now);
    recordHit('22', 'D', 'hg18', 'D', now);
    recordHit('22', 'D', 'hg18', 'D', now);
    recordHit('22', 'D', 'hg1', 'D', now);

    expect(getHotMatches(12, DEFAULT_WINDOW_MS, now)[0].topDivision).toBe('hg18');
  });

  it('falls back to "all" when only the all-division was viewed', () => {
    const now = 8_000_000;
    recordHit('22', 'E', 'all', 'E', now);

    expect(getHotMatches(12, DEFAULT_WINDOW_MS, now)[0].topDivision).toBe('all');
  });
});
