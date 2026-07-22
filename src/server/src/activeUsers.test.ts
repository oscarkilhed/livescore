import {
  recordActiveUser,
  getActiveUserCounts,
  _resetActiveUsers,
} from './activeUsers';

describe('activeUsers', () => {
  beforeEach(() => {
    _resetActiveUsers();
  });

  it('reports zero for every window when nothing recorded', () => {
    expect(getActiveUserCounts(1_000_000)).toEqual({ '5m': 0, '1h': 0, '24h': 0 });
  });

  it('counts distinct visitors across the app', () => {
    const now = 1_000_000;
    recordActiveUser('v1', now);
    recordActiveUser('v2', now);
    recordActiveUser('v3', now);

    expect(getActiveUserCounts(now)).toEqual({ '5m': 3, '1h': 3, '24h': 3 });
  });

  it('dedups repeat activity by the same visitor', () => {
    const now = 2_000_000;
    recordActiveUser('v1', now);
    recordActiveUser('v1', now + 1);
    recordActiveUser('v1', now + 2);

    expect(getActiveUserCounts(now + 2)).toEqual({ '5m': 1, '1h': 1, '24h': 1 });
  });

  it('places a visitor in every window whose span still covers their last-seen', () => {
    const now = 10_000_000;
    // Seen 10 minutes ago: outside 5m, inside 1h and 24h.
    recordActiveUser('recent', now - 10 * 60_000);
    // Seen 2 hours ago: outside 5m and 1h, inside 24h.
    recordActiveUser('older', now - 2 * 60 * 60_000);
    // Seen just now: inside all windows.
    recordActiveUser('live', now);

    expect(getActiveUserCounts(now)).toEqual({ '5m': 1, '1h': 2, '24h': 3 });
  });

  it('prunes visitors older than the widest window', () => {
    const now = 100_000_000;
    recordActiveUser('stale', now - 25 * 60 * 60_000); // beyond 24h
    recordActiveUser('fresh', now);

    expect(getActiveUserCounts(now)).toEqual({ '5m': 1, '1h': 1, '24h': 1 });
    // A later read with no new activity still only sees the fresh visitor.
    expect(getActiveUserCounts(now + 1)['24h']).toBe(1);
  });

  it('refreshes a visitor\'s windows on repeat activity', () => {
    const now = 200_000_000;
    recordActiveUser('v1', now - 10 * 60_000); // would be outside 5m...
    recordActiveUser('v1', now); // ...but the refresh slides them back in

    expect(getActiveUserCounts(now)['5m']).toBe(1);
  });
});
