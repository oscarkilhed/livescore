import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserPlus, faUserMinus, faChevronDown } from '@fortawesome/free-solid-svg-icons';
import './App.css';
import { CompetitorWithTotalScore, Stage } from './types';
import { calculateCompetitorScores, calculateMaxPossibleScores, compareCompetitors } from './calculator';
import Select, { MultiValue } from 'react-select';
import { isFeatureEnabled } from './featureFlags';

interface Division {
  value: string;
  label: string;
}

const DIVISIONS: Division[] = [
  { value: 'all', label: 'All' },
  { value: 'hg1', label: 'Open' },
  { value: 'hg2', label: 'Standard' },
  { value: 'hg3', label: 'Production' },
  { value: 'hg5', label: 'Revolver' },
  { value: 'hg12', label: 'Classic' },
  { value: 'hg18', label: 'Production Optics' }
];

function App() {
  const [stages, setStages] = useState<Array<Stage>>([]);
  const essFeatureEnabled = isFeatureEnabled('ESS_FEATURE');
  const [activeTab, setActiveTab] = useState<'SSI' | 'ESS'>(essFeatureEnabled ? 'SSI' : 'SSI');
  const [matchId, setMatchId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [division, setDivision] = useState('all');
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>([]);
  const [comparison, setComparison] = useState<CompetitorWithTotalScore[]>([]);
  const [scores, setScores] = useState<CompetitorWithTotalScore[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCompetitor, setExpandedCompetitor] = useState<string | null>(null);
  const [shouldFetch, setShouldFetch] = useState(false);
  const [excludedStages, setExcludedStages] = useState<number[]>([]);
  const [expandedStage, setExpandedStage] = useState<number | null>(null);
  const [expandedStageCompetitors, setExpandedStageCompetitors] = useState<Record<number, string[]>>({});
  const stageHeaderRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [selectedCategory, setSelectedCategory] = useState<string>('Overall');

  // Ensure activeTab is valid based on feature flags
  useEffect(() => {
    if (!essFeatureEnabled && activeTab === 'ESS') {
      setActiveTab('SSI');
    }
  }, [essFeatureEnabled, activeTab]);

  // Load initial values from URL parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlMatchId = params.get('matchId');
    const urlTypeId = params.get('typeId');
    const urlDivision = params.get('division');
    const urlCompetitors = params.get('competitors');
    const urlExclude = params.get('exclude');
    
    if (urlMatchId) setMatchId(urlMatchId);
    if (urlTypeId) setTypeId(urlTypeId);
    if (urlDivision) setDivision(urlDivision);
    if (urlCompetitors) setSelectedCompetitors(urlCompetitors.split(','));
    if (urlExclude) {
      const parsed = urlExclude
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(n => parseInt(n, 10))
        .filter(n => !Number.isNaN(n));
      setExcludedStages(parsed);
    }

    // If we have all required parameters, set shouldFetch to true
    if (urlMatchId && urlTypeId && (urlDivision || 'all')) {
      setShouldFetch(true);
    }
  }, []); // Empty dependency array means this runs once on mount

  

  // Update URL when matchId, typeId, division, selectedCompetitors, or excludedStages change
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
    
    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', newUrl);
  }, [matchId, typeId, division, selectedCompetitors, excludedStages]);

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
      const stagesWithMaxScores = calculateMaxPossibleScores(data);
      setStages(stagesWithMaxScores);
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

  const [ecmText, setEcmText] = useState('');

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
  }, [availableCategories, selectedCategory]);

  const submitEcmText = async () => {
    if (!ecmText || ecmText.trim().length === 0) {
      setError('Please paste ECM.txt content first');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const baseUrl = process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '/api';
      const response = await fetch(`${baseUrl}/ecm/txt/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: ecmText
      });
      
      if (!response.ok) {
        // Try to parse error response for more details
        let errorMessage = 'Failed to parse ECM text';
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
          } else if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch {
          // If we can't parse the error response, use status-based messages
          if (response.status === 504) {
            errorMessage = 'Request timed out. Please try again.';
          } else if (response.status === 503) {
            errorMessage = 'Service temporarily unavailable. Please try again in a moment.';
          }
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      const stagesWithMaxScores = calculateMaxPossibleScores(data);
      setStages(stagesWithMaxScores);
      setSelectedCategory('Overall');
      // Reset URL params to avoid confusion with SSI flow
      setTypeId('');
      setMatchId('');
      setDivision('hg18');
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
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

    return (
      <div className="stage-scores">
        <div className="sticky-competitor-name">
          <h3>{index + 1}. {competitor.name} {competitor.division}</h3>
        </div>
        <div className="total-hits">
          <div className="hits-container">
            <div className="hit">
              <span className="hit-type">A:</span>
              <span className="hit-count">{totalHits.A}</span>
            </div>
            <div className="hit">
              <span className="hit-type">C:</span>
              <span className="hit-count">{totalHits.C}</span>
            </div>
            <div className="hit">
              <span className="hit-type">D:</span>
              <span className="hit-count">{totalHits.D}</span>
            </div>
            <div className="hit">
              <span className="hit-type">M:</span>
              <span className="hit-count">{totalHits.M}</span>
            </div>
            <div className="hit">
              <span className="hit-type">NS:</span>
              <span className="hit-count">{totalHits.NS}</span>
            </div>
            <div className="hit">
              <span className="hit-type">Proc:</span>
              <span className="hit-count">{totalHits.procedures}</span>
            </div>
            <div className="hit">
              <span className="hit-type">Time:</span>
              <span className="hit-count">{totalHits.time.toFixed(2)}s</span>
            </div>
          </div>
        </div>
        {competitor.stageScores.map((stageScore) => {
          const safeHits = stageScore.hits ?? { A: 0, C: 0, D: 0, M: 0, NS: 0 };
          return (
            <div key={stageScore.stage} className="stage">
              <div className="stage-header">
                <h4>Stage {stageScore.stage}</h4>
                <div>
                  Score: <div className="stage-score">{(stageScore.score ?? 0).toFixed(2)} / {stageScore.maxPossibleScore ? (stageScore.maxPossibleScore).toFixed(2) : 'Unknown'}</div>
                </div>
                <div>
                  HF: <div className="hit-factor">{stageScore.hitFactor?.toFixed(4) || 'N/A'}</div>
                </div>
              </div>
              <div className="stage-details">
                <div className="stage-time">Time: {stageScore.time?.toFixed(2)}s</div>
                <div className="stage-content">
                  <div className="hits-container">
                    {Object.entries(safeHits).map(([type, count]) => (
                      <div key={type} className="hit">
                        <span className="hit-type">{type}:</span>
                        <span className="hit-count">{count}</span>
                      </div>
                    ))}
                    <div className="hit">
                      <span className="hit-type">Proc:</span>
                      <span className="hit-count">{stageScore.procedures}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // New function to render a competitor list item
  const renderCompetitorListItem = (competitor: CompetitorWithTotalScore, index: number, highestScore: number) => {
    return (
      <li key={competitor.competitorKey}>
        <div className="competitor-row">
          <span 
            className="competitor-name" 
            onClick={() => toggleCompetitorDetails(competitor.competitorKey)}
          >
            {index + 1}. {competitor.name}
          </span>
          <div className="competitor-actions">
            <span>{competitor.totalScore.toFixed(2)} ({calculatePercentage(competitor.totalScore, highestScore)}%)</span>
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

  // Update comparison and scores when stages, excludedStages, selectedCompetitors or category change
  useEffect(() => {
    const filteredStages = stages.filter(s => !excludedStages.includes(s.stage));
    const categoryParam = selectedCategory === 'Overall' ? undefined : selectedCategory;
    setComparison(compareCompetitors(filteredStages, selectedCompetitors, categoryParam));
    setScores(calculateCompetitorScores(filteredStages, categoryParam));
  }, [stages, selectedCompetitors, excludedStages, selectedCategory]);

  const availableStageNumbers = Array.from(new Set(stages.map(s => s.stage))).sort((a, b) => a - b);
  type StageOption = { value: number; label: string };
  const stageOptions: StageOption[] = availableStageNumbers.map(num => ({ value: num, label: `Stage ${num}` }));
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
      <div className="tabs">
        <div className="tab-headers" style={{ display: 'flex', gap: 8}}>
          <button
            className={activeTab === 'SSI' ? 'tab active' : 'tab'}
            onClick={() => setActiveTab('SSI')}
          >
            SSI
          </button>
          {essFeatureEnabled && (
            <button
              className={activeTab === 'ESS' ? 'tab active' : 'tab'}
              onClick={() => setActiveTab('ESS')}
            >
              ESS
            </button>
          )}
        </div>
        {activeTab === 'SSI' && (
          <div className="tab-panel">
            <form onSubmit={handleSubmit}>
              <div>
              <input
                type="text"
                placeholder="Paste ShootnScoreIt URL (e.g., https://shootnscoreit.com/event/22/21833/live-scores/)"
                onChange={(e) => handleUrlPaste(e.target.value)}
              />
              <input
                type="text"
                placeholder="Type ID"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
              />
              <input
                type="text"
                placeholder="Match ID"
                value={matchId}
                onChange={(e) => setMatchId(e.target.value)}
              />
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
                <button type="submit" disabled={loading}>
                  {loading ? 'Loading...' : 'Get Scores'}
                </button>
              </div>
            </form>
          </div>
        )}
        {activeTab === 'ESS' && (
          <div className="tab-panel">
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Paste the full stages page from ESS</label>
            <textarea
              placeholder="Paste the full stages page from ESS here"
              value={ecmText}
              onChange={(e) => setEcmText(e.target.value)}
              style={{ width: '100%', maxWidth: 720, height: 160 }}
            />
            <div style={{ height: 8 }} />
            <button onClick={submitEcmText} disabled={loading || !ecmText.trim()}>
              {loading ? 'Loading...' : 'Parse ECM Text'}
            </button>
            <div style={{ height: 12 }} />
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              disabled={availableCategories.length === 0}
              className="division-select"
              style={{ maxWidth: 320 }}
            >
              <option value="Overall">Overall</option>
              {availableCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="control-panel">
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Compare competitors</label>
        <Select
          isMulti
          options={competitorOptions}
          value={selectedCompetitorOptions}
          onChange={handleSelectedCompetitorsChange}
          placeholder="Search competitors to add"
          classNamePrefix="rs"
        />
        <div style={{ height: 12 }} />
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Exclude stages</label>
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
      {scores.length > 0 && (
        <div className="results" style={{ marginTop: '1rem' }}>
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
                  <h3>Stage {stageNum}</h3>
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
                            <span className="competitor-name">
                              <FontAwesomeIcon icon={faChevronDown} className={`chevron ${isCompetitorOpen ? 'open' : ''}`} />
                              {idx + 1}. {e.name} ({e.division})
                            </span>
                            <div className="competitor-actions">
                              <span className="hit-factor">HF {e.hitFactor.toFixed(4)}</span>
                              <span className="stage-percent">{highestStageScore > 0 ? `${calculatePercentage(e.score, highestStageScore)}%` : '0.0%'}</span>
                            </div>
                          </div>
                          {isCompetitorOpen && (
                            <div className="stage">
                              <div className="stage-details">
                                <div className="stage-time">Time: {e.time.toFixed(2)}s</div>
                                <div className="stage-content">
                                  <div className="hits-container">
                                    {Object.entries(e.hits || { A: 0, C: 0, D: 0, M: 0, NS: 0 }).map(([type, count]) => (
                                      <div key={type} className="hit">
                                        <span className="hit-type">{type}:</span>
                                        <span className="hit-count">{count as number}</span>
                                      </div>
                                    ))}
                                    <div className="hit">
                                      <span className="hit-type">Proc:</span>
                                      <span className="hit-count">{e.procedures}</span>
                                    </div>
                                  </div>
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
    </div>
  );
}

export default App; 