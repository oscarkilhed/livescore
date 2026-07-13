import React from 'react';

export interface HotMatch {
  matchType: string;
  matchId: string;
  eventName: string;
  count: number;
  topDivision: string;
}

interface HotMatchesProps {
  matches: HotMatch[];
  onSelect: (match: HotMatch) => void;
}

/**
 * "Live now" landing list: the matches currently being viewed most, so a user
 * arriving without a match in the URL can tap one instead of pasting a link.
 */
function HotMatches({ matches, onSelect }: HotMatchesProps) {
  if (matches.length === 0) return null;

  return (
    <div className="hot-matches">
      <h2 className="hot-matches-title">Live now</h2>
      <ul className="hot-matches-list">
        {matches.map((match) => (
          <li key={`${match.matchType}-${match.matchId}`}>
            <button
              type="button"
              className="hot-match-card"
              onClick={() => onSelect(match)}
            >
              <span className="hot-match-name">
                {match.eventName || `Match ${match.matchId}`}
              </span>
              <span className="hot-match-count" title="Viewers now">
                <span className="hot-match-dot" aria-hidden="true" />
                {match.count}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default HotMatches;
