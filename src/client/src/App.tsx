import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserPlus, faUserMinus, faChevronDown } from '@fortawesome/free-solid-svg-icons';
import './App.css';
import { CompetitorWithTotalScore, Stage } from './types';
import { calculateCompetitorScores, calculateMaxPossibleScores, compareCompetitors, findClosestRivals, RivalResult, computeProjectedFinish, ProjectedFinish, computeProjectedStandings, ProjectedStandingEntry } from './calculator';
import Select, { MultiValue } from 'react-select';
import {
  downloadAllOverlaysAsZip,
  StageOverlayEntry,
  Movement,
  StandingRow,
} from './StageOverlay';
import OverlaySettingsModal from './OverlaySettingsModal';
import HotMatches, { HotMatch } from './HotMatches';

interface Division {
  value: string;
  label: string;
}

const DIVISIONS: Division[] = [
  { value: 'all', label: 'Overall (division)' },
  { value: 'hg1', label: 'Open' },
  { value: 'hg2', label: 'Standard' },
  { value: 'hg3', label: 'Production' },
  { value: 'hg5', label: 'Revolver' },
  { value: 'hg12', label: 'Classic' },
  { value: 'hg17', label: 'Pistol Caliber Carbine' },
  { value: 'hg18', label: 'Production Optics' },
  { value: 'hg33', label: 'Optics' }
];

/**
 * Category code to display name mapping
 * Based on IPSC category codes from SSI GraphQL API
 */
const CATEGORY_DISPLAY_MAP: Record<string, string> = {
  '-': 'None',
  'L': 'Lady',
  'LS': 'Lady Senior',
  'SJ': 'Super Junior',
  'J': 'Junior',
  'S': 'Senior',
  'SS': 'Super Senior',
  'GS': 'Grand Senior',
};

/**
 * Get the display name for a category code
 */
const getCategoryDisplayName = (code: string): string => {
  return CATEGORY_DISPLAY_MAP[code] || code;
};

/**
 * Hit chip class — penalty hits (misses, no-shoots, procedures) that actually
 * scored against the shooter are flagged red so they stand out at a glance.
 */
const PENALTY_TYPES = new Set(['M', 'NS', 'Proc']);
const hitChipClass = (type: string, count: number): string =>
  PENALTY_TYPES.has(type) && count > 0 ? 'hit hit-penalty' : 'hit';

/**
 * Format a 1-based rank as an ordinal string (1 -> "1st", 2 -> "2nd", 11 -> "11th").
 */
const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/**
 * The three result views the user pages between (swipe on touch, tap a tab on
 * desktop). Order matters: it defines swipe direction.
 */
const VIEWS = ['standings', 'stages', 'projected'] as const;
type ViewKey = (typeof VIEWS)[number];
const VIEW_LABELS: Record<ViewKey, string> = {
  standings: 'Standings',
  stages: 'Stages',
  projected: 'Projected',
};

function App() {
  // Parse the URL query string once and seed state from it via lazy useState
  // initializers. Doing this at initialization (rather than in a mount effect)
  // is important: the URL-writeback effect below runs on the first commit with
  // whatever state exists then. Because the `division` default 'all' is truthy,
  // a mount-effect approach let that effect rewrite ?division=... in the URL
  // before setDivision was applied — and under React.StrictMode the mount effect
  // then re-read the already-clobbered URL and reset division back to 'all'.
  // (matchId/typeId escaped this only because their '' defaults are falsy and so
  // were never written to the URL.) Seeding state here means the first render
  // already holds the requested values, so there is nothing to clobber.
  const [initialParams] = useState(() => new URLSearchParams(window.location.search));
  const initialMatchId = initialParams.get('matchId') || '';
  const initialTypeId = initialParams.get('typeId') || '';

  const [stages, setStages] = useState<Array<Stage>>([]);
  const [matchId, setMatchId] = useState(initialMatchId);
  const [typeId, setTypeId] = useState(initialTypeId);
  const [division, setDivision] = useState(() => initialParams.get('division') || 'all');
  const [ssiUrl, setSsiUrl] = useState(() =>
    initialMatchId && initialTypeId
      ? `https://shootnscoreit.com/event/${initialTypeId}/${initialMatchId}/live-scores/`
      : '',
  );
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>(() => {
    const c = initialParams.get('competitors');
    return c ? c.split(',') : [];
  });
  const [comparison, setComparison] = useState<CompetitorWithTotalScore[]>([]);
  const [scores, setScores] = useState<CompetitorWithTotalScore[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCompetitor, setExpandedCompetitor] = useState<string | null>(null);
  // Fetch on load when we have the required params (division defaults to 'all').
  const [shouldFetch, setShouldFetch] = useState(() => Boolean(initialMatchId && initialTypeId));
  const [excludedStages, setExcludedStages] = useState<number[]>(() => {
    const urlExclude = initialParams.get('exclude');
    if (!urlExclude) return [];
    return urlExclude
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(n => parseInt(n, 10))
      .filter(n => !Number.isNaN(n));
  });
  const [expandedStage, setExpandedStage] = useState<number | null>(null);
  const [expandedStageCompetitors, setExpandedStageCompetitors] = useState<Record<number, string[]>>({});
  const stageHeaderRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [selectedCategory, setSelectedCategory] = useState<string>(() => initialParams.get('category') || 'Overall');
  const [appliedCategory, setAppliedCategory] = useState<string>(() => initialParams.get('category') || 'Overall');
  const [competitionName, setCompetitionName] = useState<string>('');
  const [hotMatches, setHotMatches] = useState<HotMatch[]>([]);
  const [overlayModalCompetitor, setOverlayModalCompetitor] = useState<CompetitorWithTotalScore | null>(null);
  const [overlayStartStage, setOverlayStartStage] = useState<number | null>(null);
  const [showOverlayFeature, setShowOverlayFeature] = useState(() => initialParams.get('overlay') === '1');
  const [activeView, setActiveView] = useState<ViewKey>(() => {
    const v = initialParams.get('view');
    return v === 'stages' || v === 'projected' ? v : 'standings';
  });
  // Direction of the last view change, used to pick the slide-in animation.
  const [slideDir, setSlideDir] = useState<'left' | 'right'>('left');
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const goToView = (next: ViewKey) => {
    if (next === activeView) return;
    setSlideDir(VIEWS.indexOf(next) > VIEWS.indexOf(activeView) ? 'left' : 'right');
    setActiveView(next);
  };

  const handleViewTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleViewTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Require a deliberate, mostly-horizontal swipe so we don't hijack scrolling.
    if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return;
    const idx = VIEWS.indexOf(activeView);
    const nextIdx = dx < 0 ? idx + 1 : idx - 1;
    if (nextIdx >= 0 && nextIdx < VIEWS.length) goToView(VIEWS[nextIdx]);
  };

  // Update URL when matchId, typeId, division, selectedCompetitors, excludedStages, or category change
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (matchId) params.set('matchId', matchId);
    if (typeId) params.set('typeId', typeId);
    if (division) params.set('division', division);
    if (selectedCompetitors.length > 0) {
      params.set('competitors', selectedCompetitors.join(','));
    } else {
      params.delete('competitors');
    }
    if (excludedStages.length > 0) {
      params.set('exclude', excludedStages.join(','));
    } else {
      params.delete('exclude');
    }
    if (appliedCategory && appliedCategory !== 'Overall') {
      params.set('category', appliedCategory);
    } else {
      params.delete('category');
    }
    if (activeView !== 'standings') {
      params.set('view', activeView);
    } else {
      params.delete('view');
    }

    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', newUrl);
  }, [matchId, typeId, division, selectedCompetitors, excludedStages, appliedCategory, activeView]);

  const getCommonStages = (competitors: CompetitorWithTotalScore[]): number[] => {
    if (competitors.length === 0) return [];
    
    // Get all stage numbers from the first competitor
    const firstCompetitorStages = competitors[0].stageScores.map(score => score.stage);
    
    // Filter to only include stages that all competitors have
    return firstCompetitorStages.filter(stage => 
      competitors.every(competitor => 
        competitor.stageScores.some(score => score.stage === stage)
      )
    );
  };

  const calculatePercentage = (score: number, highestScore: number): string => {
    return ((score / highestScore) * 100).toFixed(1);
  };

  /**
   * Get the placement (rank) of a competitor on a specific stage
   * Returns the 1-based position and the percentage of max score
   */
  const getStageStats = useCallback(
    (competitorKey: string, stageNumber: number): { placement: number; totalOnStage: number; stagePercent: string } => {
      const stageScoresForAll = scores
        .map(c => {
          const stageScore = c.stageScores.find(s => s.stage === stageNumber);
          return stageScore ? { key: c.competitorKey, score: stageScore.score, maxScore: stageScore.maxPossibleScore } : null;
        })
        .filter((s): s is { key: string; score: number; maxScore: number } => s !== null);

      const sorted = [...stageScoresForAll].sort((a, b) => b.score - a.score);
      const placement = sorted.findIndex(s => s.key === competitorKey) + 1;

      const myScore = stageScoresForAll.find(s => s.key === competitorKey);
      const maxScoreOnStage = sorted.length > 0 ? sorted[0].score : 0;
      const stagePercent = myScore && maxScoreOnStage > 0
        ? ((myScore.score / maxScoreOnStage) * 100).toFixed(1)
        : '0.0';

      return { placement, totalOnStage: sorted.length, stagePercent };
    },
    [scores],
  );

  /**
   * Returns the full ranked list of competitors for an explicit set of stage
   * numbers (order of the array does not matter for scoring, only membership).
   */
  const getVirtualRankings = useCallback(
    (stageNumbers: number[]): CompetitorWithTotalScore[] => {
      const set = new Set(stageNumbers);
      const relevantStages = stages.filter(s => set.has(s.stage) && !excludedStages.includes(s.stage));
      const categoryParam = appliedCategory === 'Overall' ? undefined : appliedCategory;
      return calculateCompetitorScores(relevantStages, categoryParam);
    },
    [stages, excludedStages, appliedCategory],
  );

  /**
   * Builds the shooting order starting from `startStage` and wrapping around.
   * E.g. stages [1,2,3,4,5,6], startStage=3 → [3,4,5,6,1,2].
   */
  const buildRotatedSequence = useCallback(
    (stageNumbers: number[], startStage: number): number[] => {
      const sorted = [...stageNumbers].sort((a, b) => a - b);
      const idx = sorted.indexOf(startStage);
      if (idx === -1) return sorted;
      return [...sorted.slice(idx), ...sorted.slice(0, idx)];
    },
    [],
  );

  const openOverlayModal = useCallback((competitor: CompetitorWithTotalScore) => {
    const earliest = competitor.stageScores.length > 0
      ? Math.min(...competitor.stageScores.map(s => s.stage))
      : 1;
    setOverlayStartStage(earliest);
    setOverlayModalCompetitor(competitor);
  }, []);

  const closeOverlayModal = useCallback(() => {
    setOverlayModalCompetitor(null);
    setOverlayStartStage(null);
  }, []);

  const handleDownloadAllOverlays = useCallback(
    async (competitor: CompetitorWithTotalScore, startStage: number) => {
      // Build the rotated shooting order: [startStage, …, last, 1, …, startStage-1]
      const allStageNums = competitor.stageScores.map(s => s.stage);
      const rotatedSequence = buildRotatedSequence(allStageNums, startStage);

      const padWidth = String(rotatedSequence.length).length;
      const entries: StageOverlayEntry[] = rotatedSequence.map((stageNum, seqIdx) => {
        const stageScore = competitor.stageScores.find(s => s.stage === stageNum)!;
        const stageName = stageScore.stageName || `Stage ${stageNum}`;

        // Stage result params
        const stageStats = getStageStats(competitor.competitorKey, stageNum);
        const stageResultParams = {
          stageName,
          hitFactor: stageScore.hitFactor,
          time: stageScore.time,
          stageScore: stageScore.score,
          maxPossibleScore: stageScore.maxPossibleScore,
          hits: stageScore.hits,
          procedures: stageScore.procedures,
          stagePercent: stageStats.stagePercent,
        };

        // Cumulative standings use all stages up to position seqIdx in the rotated order
        const stagesUpToNow = rotatedSequence.slice(0, seqIdx + 1);
        const rankingsNow = getVirtualRankings(stagesUpToNow);
        const posNow = rankingsNow.findIndex(c => c.competitorKey === competitor.competitorKey) + 1;
        const topScore = rankingsNow.length > 0 ? rankingsNow[0].totalScore : 0;
        const total = rankingsNow.length;

        // Movement: compare with standings after the previous stage in the rotated order
        let movement: Movement = 'none';
        if (seqIdx > 0) {
          const rankingsPrev = getVirtualRankings(rotatedSequence.slice(0, seqIdx));
          const posPrev = rankingsPrev.findIndex(c => c.competitorKey === competitor.competitorKey) + 1;
          if (posNow < posPrev) movement = 'up';
          else if (posNow > posPrev) movement = 'down';
        }

        const windowSize = 5;
        let windowStart = Math.max(0, posNow - 1 - Math.floor(windowSize / 2));
        if (windowStart + windowSize > total) windowStart = Math.max(0, total - windowSize);
        const rows: StandingRow[] = rankingsNow.slice(windowStart, windowStart + windowSize).map((c, idx) => ({
          rank: windowStart + idx + 1,
          name: c.name,
          scorePercent: topScore > 0 ? (c.totalScore / topScore) * 100 : 0,
          isShooter: c.competitorKey === competitor.competitorKey,
        }));

        const standingsParams = {
          stageName,
          stageNumber: stageNum,
          rows,
          movement,
          shooterTotalScore: rankingsNow.find(c => c.competitorKey === competitor.competitorKey)?.totalScore ?? 0,
          totalCompetitors: total,
        };

        const seqNum = String(seqIdx + 1).padStart(padWidth, '0');
        const filePrefix = `${seqNum}-${stageName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

        return { stageResultParams, standingsParams, filePrefix };
      });

      await downloadAllOverlaysAsZip(competitor.name, entries);
    },
    [buildRotatedSequence, getStageStats, getVirtualRankings],
  );

  const handleModalDownload = useCallback(async () => {
    if (!overlayModalCompetitor || overlayStartStage === null) return;
    await handleDownloadAllOverlays(overlayModalCompetitor, overlayStartStage);
    closeOverlayModal();
  }, [overlayModalCompetitor, overlayStartStage, handleDownloadAllOverlays, closeOverlayModal]);

  const handleUrlPaste = (url: string) => {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 3 && pathParts[0] === 'event') {
        setTypeId(pathParts[1]);
        setMatchId(pathParts[2]);
      }
    } catch (err) {
      setError('Invalid URL format');
    }
  };

  const toggleCompetitor = (competitorKey: string) => {
    setSelectedCompetitors(prev => {
      if (prev.includes(competitorKey)) {
        return prev.filter(key => key !== competitorKey);
      } else {
        return [...prev, competitorKey];
      }
    });
  };

  const clearAllCompetitors = () => {
    setSelectedCompetitors([]);
  };

  const toggleCompetitorDetails = (competitorKey: string) => {
    setExpandedCompetitor(expandedCompetitor === competitorKey ? null : competitorKey);
  };

  const fetchData = useCallback(async () => {
    if (!typeId || !matchId || !division) return;
    setLoading(true);
    setError(null);
    try {
      const baseUrl = process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '/api';
      const response = await fetch(`${baseUrl}/${typeId}/${matchId}/${division}/parse`);
      
      if (!response.ok) {
        // Try to parse error response for more details
        let errorMessage = 'Failed to fetch data';
        try {
          const errorData = await response.json();
          // Check if it's an SSI API timeout
          if (response.status === 504 || errorData.ssiApiTimeout) {
            errorMessage = errorData.message || errorData.error || 'The SSI (ShootnScoreIt) API timed out. The external service is responding slowly. Please try again in a moment.';
          } else if (errorData.error) {
            errorMessage = errorData.error;
          } else if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch {
          // If we can't parse the error response, use status-based messages
          if (response.status === 504) {
            errorMessage = 'The SSI (ShootnScoreIt) API timed out. The external service is responding slowly. Please try again in a moment.';
          } else if (response.status === 503) {
            errorMessage = 'Service temporarily unavailable. Please try again in a moment.';
          }
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      // Handle new response format: { eventName: string, stages: Stage[] }
      const stagesData = data.stages || data;
      const stagesWithMaxScores = calculateMaxPossibleScores(stagesData);
      setStages(stagesWithMaxScores);
      if (data.eventName) {
        setCompetitionName(data.eventName);
      }
    } catch (err) {
      // Handle network errors and other exceptions
      if (err instanceof TypeError && err.message === 'Failed to fetch') {
        setError('Network error: Unable to connect to the server. Please check your internet connection and try again.');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [typeId, matchId, division]);

  // Fetch data when shouldFetch is true and required parameters are present
  useEffect(() => {
    if (shouldFetch && matchId && typeId && division) {
      fetchData();
      setShouldFetch(false);
    }
  }, [shouldFetch, matchId, typeId, division, fetchData]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    stages.forEach(stage => {
      stage.competitors.forEach(c => {
        if (c.category) set.add(c.category);
      });
    });
    return Array.from(set).sort();
  }, [stages]);

  useEffect(() => {
    if (selectedCategory !== 'Overall' && !availableCategories.includes(selectedCategory)) {
      setSelectedCategory('Overall');
    }
    if (appliedCategory !== 'Overall' && !availableCategories.includes(appliedCategory)) {
      setAppliedCategory('Overall');
    }
  }, [availableCategories, selectedCategory, appliedCategory]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedCategory(selectedCategory);
    setShouldFetch(true);
  };

  // On the landing screen (no match selected), fetch the "live now" matches so
  // the user can tap one instead of pasting a URL.
  const isLanding = !matchId || !typeId;
  useEffect(() => {
    if (!isLanding) return;
    let cancelled = false;
    const baseUrl = process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '/api';
    fetch(`${baseUrl}/hot-matches`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then(data => {
        if (!cancelled) setHotMatches(Array.isArray(data?.matches) ? data.matches : []);
      })
      .catch(() => {
        if (!cancelled) setHotMatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isLanding]);

  const handleHotMatchSelect = (match: HotMatch) => {
    setTypeId(match.matchType);
    setMatchId(match.matchId);
    setDivision(match.topDivision || 'all');
    setSsiUrl(`https://shootnscoreit.com/event/${match.matchType}/${match.matchId}/live-scores/`);
    setShouldFetch(true);
  };

  const renderStageScores = (competitor: CompetitorWithTotalScore, index: number) => {
    if (expandedCompetitor !== competitor.competitorKey) return null;
    
    // Calculate total hits
    const totalHits = competitor.stageScores.reduce((acc, stage) => {
      const hits = stage.hits ?? { A: 0, C: 0, D: 0, M: 0, NS: 0 };
      return {
        A: acc.A + hits.A,
        C: acc.C + hits.C,
        D: acc.D + hits.D,
        M: acc.M + hits.M,
        NS: acc.NS + hits.NS,
        procedures: acc.procedures + (stage.procedures ?? 0),
        time: acc.time + (stage.time ?? 0)
      };
    }, { A: 0, C: 0, D: 0, M: 0, NS: 0, procedures: 0, time: 0 });

    // Closest rivals for this competitor, computed against the (stage-filtered) field.
    // Only runs for the expanded competitor thanks to the early return above.
    const filteredStages = stages.filter(s => !excludedStages.includes(s.stage));
    const rivals: RivalResult[] = findClosestRivals(competitor.competitorKey, scores, filteredStages, 5);
    const projection: ProjectedFinish | null = computeProjectedFinish(competitor.competitorKey, scores, filteredStages);

    return (
      <div className="stage-scores">
        <div className="sticky-competitor-name">
          <h3>{index + 1}. {competitor.name} {competitor.category && competitor.category !== '-' && `(${getCategoryDisplayName(competitor.category)}) `}{competitor.division}</h3>
          {showOverlayFeature && (
            <button
              className="overlay-btn download-all-btn"
              onClick={() => openOverlayModal(competitor)}
              title="Configure and download all stage overlay images as a ZIP file"
            >
              Download all overlays (.zip)
            </button>
          )}
        </div>
        <div className="total-hits">
          <div className="hits-container">
            <div className="hit">
              <span className="hit-type">A</span>
              <span className="hit-count">{totalHits.A}</span>
            </div>
            <div className="hit">
              <span className="hit-type">C</span>
              <span className="hit-count">{totalHits.C}</span>
            </div>
            <div className="hit">
              <span className="hit-type">D</span>
              <span className="hit-count">{totalHits.D}</span>
            </div>
            <div className={hitChipClass('M', totalHits.M)}>
              <span className="hit-type">M</span>
              <span className="hit-count">{totalHits.M}</span>
            </div>
            <div className={hitChipClass('NS', totalHits.NS)}>
              <span className="hit-type">NS</span>
              <span className="hit-count">{totalHits.NS}</span>
            </div>
            <div className={hitChipClass('Proc', totalHits.procedures)}>
              <span className="hit-type">Proc</span>
              <span className="hit-count">{totalHits.procedures}</span>
            </div>
            <div className="hit">
              <span className="hit-type">Time</span>
              <span className="hit-count">{totalHits.time.toFixed(2)}s</span>
            </div>
          </div>
        </div>
        {competitor.stageScores.map((stageScore) => {
          const safeHits = stageScore.hits ?? { A: 0, C: 0, D: 0, M: 0, NS: 0 };
          const stageStats = getStageStats(competitor.competitorKey, stageScore.stage);
          return (
            <div key={stageScore.stage} className="stage">
              <div className="stage-row">
                <span className="stage-name">{stageScore.stageName || `Stage ${stageScore.stage}`}</span>
                <span className="stage-placement">
                  #{stageStats.placement}/{stageStats.totalOnStage} · {stageStats.stagePercent}%
                </span>
              </div>
              <div className="stage-metrics">
                <span>HF <b>{stageScore.hitFactor?.toFixed(4) || 'N/A'}</b></span>
                <span><b>{(stageScore.score ?? 0).toFixed(2)}</b> / {stageScore.maxPossibleScore ? stageScore.maxPossibleScore.toFixed(2) : '—'}</span>
                <span><b>{stageScore.time?.toFixed(2)}</b>s</span>
              </div>
              <div className="hits-container">
                {Object.entries(safeHits).map(([type, count]) => (
                  <div key={type} className={hitChipClass(type, count)}>
                    <span className="hit-type">{type}</span>
                    <span className="hit-count">{count}</span>
                  </div>
                ))}
                <div className={hitChipClass('Proc', stageScore.procedures ?? 0)}>
                  <span className="hit-type">Proc</span>
                  <span className="hit-count">{stageScore.procedures}</span>
                </div>
              </div>
            </div>
          );
        })}
        {projection && (
          <div className="competitor-projection">
            <div className="competitor-projection-header">
              <h4>Projected finish</h4>
              <span className="rivals-ref-pct">Avg stage %: {projection.refAvgPct.toFixed(1)}%</span>
            </div>
            <div className="projection-headline">
              <span
                className={`rival-confidence-dot rival-confidence-${projection.confidence}`}
                title={`Confidence: ${projection.confidence} — based on ${projection.currentStagesShot} of ${projection.totalStages} stages shot`}
              />
              <span className="projection-headline-value">Projected top {projection.projectedPercentile.toFixed(0)}%</span>
              <span className="projection-headline-pos">
                ≈ {ordinal(projection.projectedPosition)} of {projection.startedCount} shooting so far
              </span>
            </div>
            <div className="projection-contrast">
              Currently {ordinal(projection.currentPosition)} ({projection.currentStagesShot} of {projection.totalStages} stages)
              {' → projected '}
              <span className="projection-target">{ordinal(projection.projectedPosition)}</span>
            </div>
            {projection.projectedBestPosition !== projection.projectedWorstPosition && (
              <div className="projection-range">
                Range: top {projection.projectedBestPercentile.toFixed(0)}%–{projection.projectedWorstPercentile.toFixed(0)}%
                {' ('}{ordinal(projection.projectedBestPosition)}–{ordinal(projection.projectedWorstPosition)}{')'}
              </div>
            )}
            <div className="projection-pct">{projection.projectedPctOfWinner.toFixed(1)}% of projected winner</div>
            <p className="projection-caveat">
              Based on {projection.startedCount} competitor{projection.startedCount === 1 ? '' : 's'} who&apos;ve started — others may still enter.
            </p>
          </div>
        )}
        {rivals.length > 0 && (
          <div className="competitor-rivals">
            <div className="competitor-rivals-header">
              <h4>Potential rivals</h4>
              <span className="rivals-ref-pct">Avg stage %: {rivals[0].refAvgPct.toFixed(1)}%</span>
            </div>
            <p className="rivals-confidence-legend">
              Dot shows how reliable each match is given the stages shot so far —
              <span className="rival-confidence-dot rival-confidence-high" /> solid,
              <span className="rival-confidence-dot rival-confidence-medium" /> fair,
              <span className="rival-confidence-dot rival-confidence-low" /> thin.
            </p>
            <ul className="competitor-rivals-list">
              {rivals.map((rival) => {
                const placement = scores.findIndex(c => c.competitorKey === rival.competitor.competitorKey) + 1;
                const above = rival.avgPct > rival.refAvgPct;
                const confidenceTitle = `Confidence: ${rival.confidence} — rival average based on ${rival.rivalStages} stage${rival.rivalStages === 1 ? '' : 's'}, ${rival.sharedStages} shared with ${competitor.name} (who has ${rival.refStages} stage${rival.refStages === 1 ? '' : 's'})`;
                return (
                  <li key={rival.competitor.competitorKey} className={`rival-row rival-conf-${rival.confidence}`}>
                    <div className="rival-main-row">
                      <span
                        className={`rival-confidence-dot rival-confidence-${rival.confidence}`}
                        title={confidenceTitle}
                      />
                      <span className="rival-placement">#{placement}</span>
                      <span className="rival-name">{rival.competitor.name}</span>
                      <span className="rival-avg-pct">{rival.avgPct.toFixed(1)}%</span>
                    </div>
                    <div className="rival-sub-row">
                      <span className="rival-division">{rival.competitor.division}</span>
                      <span className={`rival-gap ${above ? 'rival-gap-above' : 'rival-gap-below'}`}>
                        {above ? '+' : '-'}{rival.gap.toFixed(1)}%
                      </span>
                      {rival.sharedStages === 0 ? (
                        <span className="rival-badge rival-badge-new" title="No shared stages — similarity estimated from independent stage performance">
                          new rival
                        </span>
                      ) : (
                        <span className="rival-badge rival-badge-shared" title={`${rival.sharedStages} stage${rival.sharedStages > 1 ? 's' : ''} in common`}>
                          {rival.sharedStages} shared
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    );
  };

  // New function to render a competitor list item
  const renderCompetitorListItem = (competitor: CompetitorWithTotalScore, index: number, highestScore: number) => {
    return (
      <li key={competitor.competitorKey}>
        <div className="competitor-row">
          <span className="row-left">
            <span className="rank">#{index + 1}</span>
            <span
              className="competitor-name"
              onClick={() => toggleCompetitorDetails(competitor.competitorKey)}
            >
              {competitor.name} <span className="row-division">({competitor.division})</span>
            </span>
          </span>
          <div className="competitor-actions">
            <span className="metric">
              {calculatePercentage(competitor.totalScore, highestScore)}% <span className="metric-sub">{competitor.totalScore.toFixed(2)}</span>
            </span>
            <span
              className={`add-button ${selectedCompetitors.includes(competitor.competitorKey) ? 'selected' : ''}`}
              onClick={() => toggleCompetitor(competitor.competitorKey)}
              title={selectedCompetitors.includes(competitor.competitorKey) ? "Remove from comparison" : "Add to comparison"}
            >
              <FontAwesomeIcon
                icon={selectedCompetitors.includes(competitor.competitorKey) ? faUserMinus : faUserPlus}
              />
            </span>
          </div>
        </div>
        {renderStageScores(competitor, index)}
      </li>
    );
  };

  // Render a row in the projected standings (ranked by avg stage %, with movement vs current)
  const renderProjectedListItem = (entry: ProjectedStandingEntry) => {
    const { competitor, projectedPosition, confidence, projectedPctOfWinner, avgPct } = entry;
    return (
      <li key={competitor.competitorKey} className={`projected-row${confidence === 'low' ? ' is-low' : ''}`}>
        <div className="competitor-row">
          <span className="row-left">
            <span
              className={`rival-confidence-dot rival-confidence-${confidence}`}
              title={`Confidence: ${confidence} — based on ${entry.stagesShot} stage${entry.stagesShot === 1 ? '' : 's'} shot`}
            />
            <span className="rank">#{projectedPosition}</span>
            <span className="competitor-name" onClick={() => toggleCompetitorDetails(competitor.competitorKey)}>
              {competitor.name} <span className="row-division">({competitor.division})</span>
            </span>
          </span>
          <div className="competitor-actions">
            <span className="metric">
              {projectedPctOfWinner.toFixed(1)}% <span className="metric-sub">avg {avgPct.toFixed(1)}%</span>
            </span>
            <span
              className={`add-button ${selectedCompetitors.includes(competitor.competitorKey) ? 'selected' : ''}`}
              onClick={() => toggleCompetitor(competitor.competitorKey)}
              title={selectedCompetitors.includes(competitor.competitorKey) ? 'Remove from comparison' : 'Add to comparison'}
            >
              <FontAwesomeIcon icon={selectedCompetitors.includes(competitor.competitorKey) ? faUserMinus : faUserPlus} />
            </span>
          </div>
        </div>
        {renderStageScores(competitor, projectedPosition - 1)}
      </li>
    );
  };

  // Update comparison and scores when stages, excludedStages, selectedCompetitors or appliedCategory change
  useEffect(() => {
    const filteredStages = stages.filter(s => !excludedStages.includes(s.stage));
    const categoryParam = appliedCategory === 'Overall' ? undefined : appliedCategory;
    setComparison(compareCompetitors(filteredStages, selectedCompetitors, categoryParam));
    setScores(calculateCompetitorScores(filteredStages, categoryParam));
  }, [stages, selectedCompetitors, excludedStages, appliedCategory]);

  // Projected standings: the full field re-ranked by avg stage %. Inherits the same
  // division/category/excluded-stage filters as `scores`.
  const projectedStandings = useMemo(() => {
    const filtered = stages.filter(s => !excludedStages.includes(s.stage));
    return computeProjectedStandings(scores, filtered);
  }, [scores, stages, excludedStages]);

  const availableStageNumbers = Array.from(new Set(stages.map(s => s.stage))).sort((a, b) => a - b);
  // Build a map of stage number to stage name for use in the UI
  const stageNameMap = useMemo(() => {
    const map = new Map<number, string>();
    stages.forEach(s => {
      map.set(s.stage, s.stageName || `Stage ${s.stage}`);
    });
    return map;
  }, [stages]);

  type StageOption = { value: number; label: string };
  const stageOptions: StageOption[] = availableStageNumbers.map(num => ({ 
    value: num, 
    label: stageNameMap.get(num) || `Stage ${num}` 
  }));
  const selectedStageOptions: StageOption[] = stageOptions.filter(o => excludedStages.includes(o.value));
  const handleExcludedStagesChange = (opts: MultiValue<StageOption>) => {
    setExcludedStages(opts.map(o => o.value));
  };

  type CompetitorOption = { value: string; label: string };
  const competitorOptions: CompetitorOption[] = scores.map(c => ({ value: c.competitorKey, label: `${c.name} (${c.division})` }));
  const selectedCompetitorOptions: CompetitorOption[] = competitorOptions.filter(o => selectedCompetitors.includes(o.value));
  const handleSelectedCompetitorsChange = (opts: MultiValue<CompetitorOption>) => {
    setSelectedCompetitors(opts.map(o => o.value));
  };

  // Stage Results helpers
  const allStageNumbers = Array.from(new Set(scores.flatMap(c => c.stageScores.map(s => s.stage)))).sort((a, b) => a - b);
  const toggleStage = (stageNum: number) => {
    setExpandedStage(prev => {
      const next = prev === stageNum ? null : stageNum;
      // Keep competitor expansions; only one stage is visible at a time anyway
      return next;
    });
  };
  const toggleStageCompetitor = (stageNum: number, competitorKey: string) => {
    setExpandedStageCompetitors(prev => {
      const current = prev[stageNum] ? [...prev[stageNum]] : [];
      const idx = current.indexOf(competitorKey);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(competitorKey);
      }
      return { ...prev, [stageNum]: current };
    });
  };

  useEffect(() => {
    if (expandedStage !== null) {
      const el = stageHeaderRefs.current[expandedStage];
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [expandedStage]);

  return (
    <div className="App">
      <h1>Live Scores</h1>
      <div className="tab-panel">
        {isLanding && <HotMatches matches={hotMatches} onSelect={handleHotMatchSelect} />}
        <form onSubmit={handleSubmit}>
          <div>
          <input
            type="text"
            placeholder="Paste ShootnScoreIt URL (e.g., https://shootnscoreit.com/event/22/21833/live-scores/)"
            value={ssiUrl}
            onChange={(e) => {
              setSsiUrl(e.target.value);
              handleUrlPaste(e.target.value);
            }}
          />
          <input type="hidden" name="typeId" value={typeId} />
          <input type="hidden" name="matchId" value={matchId} />
          <select
            value={division}
            onChange={(e) => setDivision(e.target.value)}
            className="division-select"
          >
            {DIVISIONS.map((div) => (
              <option key={div.value} value={div.value}>
                {div.label}
              </option>
            ))}
          </select>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="division-select"
            title="Filter by competitor category"
          >
            <option value="Overall">Overall (category)</option>
            {availableCategories.map(cat => (
              <option key={cat} value={cat}>{getCategoryDisplayName(cat)}</option>
            ))}
          </select>
            <button type="submit" disabled={loading}>
              {loading ? 'Loading...' : 'Get Scores'}
            </button>
          </div>
        </form>
      </div>
      {competitionName && (
        <h3 className="competition-name">{competitionName}</h3>
      )}
      <div className="control-panel">
        <label>Compare competitors</label>
        <Select
          isMulti
          options={competitorOptions}
          value={selectedCompetitorOptions}
          onChange={handleSelectedCompetitorsChange}
          placeholder="Search competitors to add"
          classNamePrefix="rs"
        />
        <div className="control-panel-spacer" />
        <label>Exclude stages</label>
        <Select
          isMulti
          options={stageOptions}
          value={selectedStageOptions}
          onChange={handleExcludedStagesChange}
          placeholder="Select stages to exclude"
          classNamePrefix="rs"
        />
      </div>
      {loading && <p className="loading">Loading...</p>}
      {error && <p className="error">{error}</p>}
      {scores.length > 0 && (
        <>
          <div className="view-tabs" role="tablist">
            {VIEWS.map(v => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={activeView === v}
                className={`view-tab ${activeView === v ? 'active' : ''}`}
                onClick={() => goToView(v)}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          <div
            className="view-viewport"
            onTouchStart={handleViewTouchStart}
            onTouchEnd={handleViewTouchEnd}
          >
            <div key={activeView} className={`view-panel slide-${slideDir}`}>
              {activeView === 'standings' && (
                <div className="results">
                  {selectedCompetitors.length > 0 && (
                    <>
                      <div className="results-header">
                        <h2>Results based on stages {getCommonStages(scores.filter(c => selectedCompetitors.includes(c.competitorKey))).join(', ')}</h2>
                      </div>
                      <ul>
                        {comparison
                          .filter(competitor => selectedCompetitors.includes(competitor.competitorKey))
                          .map((competitor, index) => {
                            const highestScore = comparison[0].totalScore;
                            return renderCompetitorListItem(competitor, index, highestScore);
                          })}
                      </ul>
                      <div className="clear-button-container">
                        <button
                          className="clear-button"
                          onClick={clearAllCompetitors}
                          title="Clear all competitors from comparison"
                        >
                          Clear Selected
                        </button>
                      </div>
                      <div className="section-divider"></div>
                      <ul>
                        {comparison.map((competitor, index) => {
                          const highestScore = comparison[0].totalScore;
                          return renderCompetitorListItem(competitor, index, highestScore);
                        })}
                      </ul>
                    </>
                  )}
                  <h2>All Competitor Scores</h2>
                  <ul>
                    {scores.map((competitor, index) => {
                      const highestScore = scores[0].totalScore;
                      return renderCompetitorListItem(competitor, index, highestScore);
                    })}
                  </ul>
                </div>
              )}
              {activeView === 'stages' && (
        <div className="results">
          <h2>Stage Results</h2>
          {allStageNumbers.map(stageNum => {
            const entries = scores
              .map(c => {
                const ss = c.stageScores.find(s => s.stage === stageNum);
                if (!ss) return null;
                return {
                  key: c.competitorKey,
                  name: c.name,
                  division: c.division,
                  score: ss.score ?? 0,
                  hitFactor: ss.hitFactor ?? 0,
                  time: ss.time ?? 0,
                  hits: ss.hits,
                  procedures: ss.procedures ?? 0,
                  points: ss.points ?? 0
                };
              })
              .filter((e): e is { key: string; name: string; division: string; score: number; hitFactor: number; time: number; hits: { A: number; C: number; D: number; M: number; NS: number }; procedures: number; points: number } => {
                return e !== null && e.hits !== undefined;
              })
              .sort((a, b) => b.score - a.score);
            const isOpen = expandedStage === stageNum;
            const highestStageScore = entries.length > 0 ? entries[0].score : 0;
            return (
              <div key={stageNum} className="stage-results">
                <div
                  className="stage-header"
                  onClick={() => toggleStage(stageNum)}
                  style={{ cursor: 'pointer' }}
                  ref={(el) => { stageHeaderRefs.current[stageNum] = el; }}
                >
                  <h3>{stageNameMap.get(stageNum) || `Stage ${stageNum}`}</h3>
                  <div>
                    <FontAwesomeIcon icon={faChevronDown} className={`chevron ${isOpen ? 'open' : ''}`} />
                  </div>
                </div>
                {isOpen && (
                  <ul>
                    {entries.map((e, idx) => {
                      const isCompetitorOpen = !!(expandedStageCompetitors[stageNum]?.includes(e.key));
                      return (
                        <li key={e.key} className={isCompetitorOpen ? 'expanded' : ''}>
                          <div className="competitor-row" onClick={() => toggleStageCompetitor(stageNum, e.key)} style={{ cursor: 'pointer' }}>
                            <span className="row-left">
                              <span className="rank">#{idx + 1}</span>
                              <span className="competitor-name">
                                {e.name} <span className="row-division">({e.division})</span>
                              </span>
                            </span>
                            <div className="competitor-actions">
                              <span className="metric">
                                {highestStageScore > 0 ? `${calculatePercentage(e.score, highestStageScore)}%` : '0.0%'} <span className="metric-sub">HF {e.hitFactor.toFixed(4)}</span>
                              </span>
                            </div>
                          </div>
                          {isCompetitorOpen && (
                            <div className="stage">
                              <div className="stage-metrics">
                                <span><b>{e.time.toFixed(2)}</b>s</span>
                              </div>
                              <div className="hits-container">
                                {Object.entries(e.hits || { A: 0, C: 0, D: 0, M: 0, NS: 0 }).map(([type, count]) => (
                                  <div key={type} className={hitChipClass(type, count as number)}>
                                    <span className="hit-type">{type}</span>
                                    <span className="hit-count">{count as number}</span>
                                  </div>
                                ))}
                                <div className={hitChipClass('Proc', e.procedures)}>
                                  <span className="hit-type">Proc</span>
                                  <span className="hit-count">{e.procedures}</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
              )}
              {activeView === 'projected' && (
                projectedStandings.length > 0 ? (
                  <div className="results projected-standings">
                    <h2>Projected standings</h2>
                    <p className="rivals-confidence-legend">
                      Field re-ranked by average stage % (projected finish).
                      Dot shows reliability given stages shot so far —
                      <span className="rival-confidence-dot rival-confidence-high" /> solid,
                      <span className="rival-confidence-dot rival-confidence-medium" /> fair,
                      <span className="rival-confidence-dot rival-confidence-low" /> thin.
                    </p>
                    <ul>
                      {projectedStandings.map(entry => renderProjectedListItem(entry))}
                    </ul>
                  </div>
                ) : (
                  <div className="results">
                    <p className="loading">Not enough data to project standings yet.</p>
                  </div>
                )
              )}
            </div>
          </div>
        </>
      )}
      {showOverlayFeature && overlayModalCompetitor && overlayStartStage !== null && (
        <OverlaySettingsModal
          competitor={overlayModalCompetitor}
          startStage={overlayStartStage}
          availableStages={overlayModalCompetitor.stageScores
            .map(s => ({ value: s.stage, label: s.stageName || `Stage ${s.stage}` }))
            .sort((a, b) => a.value - b.value)}
          onStartStageChange={setOverlayStartStage}
          onDownload={handleModalDownload}
          onClose={closeOverlayModal}
        />
      )}
      <footer className="app-footer">
        <a
          className="feature-toggle-link"
          href={(() => {
            const params = new URLSearchParams(window.location.search);
            if (showOverlayFeature) {
              params.delete('overlay');
            } else {
              params.set('overlay', '1');
            }
            return `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
          })()}
        >
          {showOverlayFeature ? 'Hide image tools' : '·'}
        </a>
      </footer>
    </div>
  );
}

export default App;
