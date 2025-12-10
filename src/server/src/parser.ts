import { Stage, Competitor, Hits } from './types';
import * as cheerio from 'cheerio';

/**
 * Parses ECM (European Championship Match) text format into structured stage data.
 * 
 * ECM text format is tab-separated with stage headers in the format:
 * "Division Name - Stage N"
 * 
 * @param text - The ECM text content to parse
 * @returns Array of Stage objects containing competitors and their scores
 * 
 * @example
 * ```typescript
 * const ecmText = "Production Optics - Stage 1\nPlace\t#\tShooter\t...";
 * const stages = parseECMTxt(ecmText);
 * ```
 */
export function parseECMTxt(text: string): Stage[] {
    const stages: Stage[] = [];
    let currentStageNumber: number | null = null;
    let competitors: Competitor[] = [];
    let stageMaxPossibleScore: number | undefined = undefined;
    let headerIndexes: Record<string, number> | null = null;
    let currentDivision: string = 'Unknown';

    const lines = text.split(/\r?\n/);
    const stageHeaderRegex = /^(.+?)\s*-\s*stage\s*(\d+)/i;
    const isStageHeader = (line: string): boolean => stageHeaderRegex.test(line);

    const pushStageIfAny = () => {
        if (currentStageNumber !== null && competitors.length > 0) {
            stages.push({
                stage: currentStageNumber,
                competitors,
                procedures: 0,
                maxPossibleScore: stageMaxPossibleScore
            });
        }
        competitors = [];
        stageMaxPossibleScore = undefined;
        headerIndexes = null;
    };

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const line = rawLine.trim();
        if (!line) continue;

        if (isStageHeader(line)) {
            // finalize previous stage
            pushStageIfAny();
            // Parse stage number
            const match = line.match(stageHeaderRegex);
            if (match) {
                const [, divisionName, stageNum] = match;
                currentDivision = (divisionName || 'Unknown').trim();
                currentStageNumber = parseInt(stageNum, 10);
            } else {
                currentStageNumber = (currentStageNumber || 0) + 1;
            }
            continue;
        }

        // Detect header row
        if (!headerIndexes && /(^|\t)place(\t|$)/i.test(line) && /(^|\t)#(\t|$)/.test(line) && /(^|\t)shooter(\t|$)/i.test(line)) {
            const headers = rawLine.split('\t').map(h => h.trim().toLowerCase());
            headerIndexes = {
                no: headers.findIndex(h => h === '#' || h === 'no' || h === 'nr'),
                shooter: headers.findIndex(h => h.includes('shooter') || h.includes('name')),
                category: headers.findIndex(h => h.includes('category')),
                points: headers.findIndex(h => h.includes('points') || h === 'pts' || h === 'pt'),
                time: headers.findIndex(h => h.includes('time')),
                hf: headers.findIndex(h => h === 'hf' || h.includes('hit factor')),
                totalScore: headers.findIndex(h => h.includes('total score')),
                scorePercent: headers.findIndex(h => h.includes('score %') || h.includes('score%'))
            };
            continue;
        }

        // Data row
        if (headerIndexes && currentStageNumber !== null) {
            const cols = rawLine.split('\t');
            const get = (idx: number | undefined) => (idx !== undefined && idx >= 0 && idx < cols.length ? cols[idx].trim() : '');

            const numberText = get(headerIndexes.no);
            const competitorNumber = numberText.replace(/[^0-9]/g, '');
            const nameText = get(headerIndexes.shooter);
            if (!nameText) continue;

            const timeText = get(headerIndexes.time);
            const categoryText = get(headerIndexes.category);
            const pointsText = get(headerIndexes.points);
            const hfText = get(headerIndexes.hf);
            const totalScoreText = get(headerIndexes.totalScore);
            const scorePercentText = get(headerIndexes.scorePercent);

            const time = parseFloat((timeText || '').replace(',', '.')) || 0;
            const points = parseFloat((pointsText || '').replace(',', '.')) || 0;
            let hitFactor = parseFloat((hfText || '').replace(',', '.'));
            if ((!hitFactor || isNaN(hitFactor)) && time > 0 && points > 0) {
                hitFactor = points / time;
            }

            if (headerIndexes.totalScore !== -1 && headerIndexes.scorePercent !== -1) {
                const percent = parseFloat((scorePercentText || '').replace(',', '.'));
                if (!isNaN(percent) && Math.abs(percent - 100) < 1e-6) {
                    const totalScore = parseFloat((totalScoreText || '').replace(',', '.'));
                    if (!isNaN(totalScore)) {
                        stageMaxPossibleScore = totalScore;
                    }
                }
            }

            const hits: Hits = { A: 0, C: 0, D: 0, M: 0, NS: 0 };
            competitors.push({
                name: nameText,
                division: currentDivision,
                powerFactor: 'Minor',
                category: categoryText || undefined,
                hitFactor: hitFactor || 0,
                time,
                points,
                hits,
                competitorKey: competitorNumber || nameText
            });
        }
    }

    // push last stage
    pushStageIfAny();

    return stages;
}

/**
 * Parses HTML from ShootnScoreIt.com live scores page into structured stage data.
 * 
 * The HTML contains tables where each table represents a stage. Each row in a table
 * represents a competitor with their scores, hits, time, and hit factor.
 * 
 * @param html - The HTML content from ShootnScoreIt.com live scores page
 * @returns Array of Stage objects containing competitors and their scores
 * 
 * @example
 * ```typescript
 * const html = await fetch('https://shootnscoreit.com/event/...');
 * const stages = parseLivescore(html);
 * ```
 */
function parseLivescore(html: string): Stage[] {
    const $ = cheerio.load(html);

    const stages: Stage[] = [];

    $('table').each((tableIndex: number, table) => {
        const stageNumber = tableIndex + 1;
        const competitors: Competitor[] = [];
        const rows = $(table).find('tr');
        rows.each((i: number, row) => {
            const cells = $(row).find('td');
            if (cells.length > 0) {
                // Name parsing
                const nameCell = cells[1];
                const name = $(nameCell).text().trim();
                const nameLines = name.split('\n').map((s: string) => s.trim()).filter(Boolean);
                const fullName = nameLines.slice(0, 2).join(' ');

                // Division and power factor parsing
                const divisionCell = cells[1];
                const divisionText = $(divisionCell).text().trim();
                const divisionLines = divisionText.split('\n').map((s: string) => s.trim()).filter(Boolean);
                const division = divisionLines[2] ? divisionLines[2].replace(/[+-]$/, '').trim() : divisionText;
                const powerFactor = divisionLines[2] && divisionLines[2].endsWith('+') ? 'Major' : 'Minor';

                // Hit factor
                const hitFactor = parseFloat($(cells[0]).text().trim());
                // Time
                const time = parseFloat($(cells[2]).text().trim());
                // Points and hits
                const pointsAndHits = $(cells[3]).text().trim();
                const [pointsStr, hitsStr] = pointsAndHits.split('p ');
                const points = parseInt(pointsStr) || 0;
                let a = 0, c = 0, d = 0, m = 0, ns = 0;
                if (hitsStr) {
                    const hitValues = hitsStr.split('|').map((h: string) => parseInt(h) || 0);
                    [a, c, d, m, ns] = hitValues;
                }
                const hits: Hits = { A: a, C: c, D: d, M: m, NS: ns };

                competitors.push({
                    name: fullName,
                    division,
                    powerFactor,
                    hitFactor,
                    time,
                    points,
                    hits,
                    competitorKey: `${fullName}|${division}`
                });
            }
        });
        stages.push({
            stage: stageNumber,
            competitors,
            procedures: 0 // Initialize procedures property
        });
    });

    return stages;
}

export default parseLivescore;