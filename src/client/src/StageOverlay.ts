import JSZip from 'jszip';
import { Hits } from './types';
import { formatStageLabel } from './stageLabel';

// ─── Shared drawing helpers ───────────────────────────────────────────────────

const W = 900;
const H = 420;
const RADIUS = 18;
const PAD = 32;

const COLORS = {
  bg: 'rgba(15, 17, 22, 0.50)',
  accent: '#f0c040',
  text: '#ffffff',
  muted: '#9ba3b4',
  divider: 'rgba(255,255,255,0.10)',
  highlight: 'rgba(240,192,64,0.12)',
  green: '#4cce7a',
  red: '#f05060',
  rowAlt: 'rgba(255,255,255,0.04)',
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  roundRect(ctx, 0, 0, width, height, RADIUS);
  ctx.fillStyle = COLORS.bg;
  ctx.fill();
}

function drawDivider(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.strokeStyle = COLORS.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas toBlob returned null'));
    }, 'image/png');
  });
}

function triggerDownload(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

function sanitiseFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// ─── Image 1: Stage Result ────────────────────────────────────────────────────

export interface StageResultParams {
  stageNumber: number;
  /** Raw stage name (may be absent); combined with the number by {@link formatStageLabel}. */
  stageName?: string;
  hitFactor: number;
  time: number;
  stageScore: number;
  maxPossibleScore: number;
  hits: Hits;
  procedures: number;
  stagePercent: string;
}

export function downloadStageResultImage(params: StageResultParams): void {
  // ── Compute layout constants before creating the canvas ──────────
  const labelY  = PAD + 62;
  const valY    = PAD + 128;
  const hitLabelY = valY + 60;
  const hitValY   = valY + 92;
  const canvasH   = hitValY + 22 + PAD;   // bottom of 30px text + padding

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  drawBackground(ctx);

  // ── Header ──────────────────────────────────────────────────────
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(formatStageLabel(params.stageNumber, params.stageName), PAD, PAD + 22);

  drawDivider(ctx, PAD + 40);

  // ── Metrics labels row ───────────────────────────────────────────
  // (labelY and valY already computed above)

  ctx.fillStyle = COLORS.muted;
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('HIT FACTOR', PAD, labelY);
  ctx.fillText('TIME', 420, labelY);
  ctx.fillText('SCORE', 640, labelY);

  // ── Metric values row ────────────────────────────────────────────
  // Hit Factor (64px bold, baseline valY)
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 58px system-ui, sans-serif';
  ctx.fillText(params.hitFactor.toFixed(2), PAD, valY);

  // Time (40px bold, baseline valY)
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillText(`${params.time.toFixed(2)}s`, 420, valY);

  // Score (multi-line: value then percent)
  const scoreLine1 = `${params.stageScore.toFixed(2)} / ${params.maxPossibleScore.toFixed(2)}`;
  const scoreLine2 = `(${params.stagePercent}%)`;
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(scoreLine1, 640, valY - 18);
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText(scoreLine2, 640, valY + 12);

  drawDivider(ctx, valY + 28);

  // ── Hits breakdown ───────────────────────────────────────────────

  const hitsItems: [string, number][] = [
    ['A', params.hits.A],
    ['C', params.hits.C],
    ['D', params.hits.D],
    ['M', params.hits.M],
    ['NS', params.hits.NS],
    ['Proc', params.procedures],
  ];
  const colWidth = (W - PAD * 2) / hitsItems.length;

  hitsItems.forEach(([label, value], i) => {
    const x = PAD + i * colWidth;
    ctx.fillStyle = COLORS.muted;
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(label, x, hitLabelY);
    ctx.fillStyle = value > 0 && (label === 'M' || label === 'NS' || label === 'Proc')
      ? COLORS.red
      : COLORS.text;
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText(String(value), x, hitValY);
  });

  const filename = `${sanitiseFilename(formatStageLabel(params.stageNumber, params.stageName))}_result.png`;
  triggerDownload(canvas, filename);
}

export function buildStageResultCanvas(params: StageResultParams): HTMLCanvasElement {
  const labelY    = PAD + 62;
  const valY      = PAD + 128;
  const hitLabelY = valY + 60;
  const hitValY   = valY + 92;
  const canvasH   = hitValY + 22 + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  drawBackground(ctx);

  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(formatStageLabel(params.stageNumber, params.stageName), PAD, PAD + 22);
  drawDivider(ctx, PAD + 40);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('HIT FACTOR', PAD, labelY);
  ctx.fillText('TIME', 420, labelY);
  ctx.fillText('SCORE', 640, labelY);

  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 58px system-ui, sans-serif';
  ctx.fillText(params.hitFactor.toFixed(2), PAD, valY);

  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillText(`${params.time.toFixed(2)}s`, 420, valY);

  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(`${params.stageScore.toFixed(2)} / ${params.maxPossibleScore.toFixed(2)}`, 640, valY - 18);
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText(`(${params.stagePercent}%)`, 640, valY + 12);

  drawDivider(ctx, valY + 28);

  const hitsItems: [string, number][] = [
    ['A', params.hits.A], ['C', params.hits.C], ['D', params.hits.D],
    ['M', params.hits.M], ['NS', params.hits.NS], ['Proc', params.procedures],
  ];
  const colWidth = (W - PAD * 2) / hitsItems.length;
  hitsItems.forEach(([label, value], i) => {
    const x = PAD + i * colWidth;
    ctx.fillStyle = COLORS.muted;
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(label, x, hitLabelY);
    ctx.fillStyle = value > 0 && (label === 'M' || label === 'NS' || label === 'Proc') ? COLORS.red : COLORS.text;
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText(String(value), x, hitValY);
  });

  return canvas;
}

export function stageResultToBlob(params: StageResultParams): Promise<Blob> {
  return canvasToBlob(buildStageResultCanvas(params));
}

// ─── Image 2: Virtual Standings ───────────────────────────────────────────────

export type Movement = 'up' | 'down' | 'none';

export interface StandingRow {
  rank: number;
  name: string;
  scorePercent: number;
  isShooter: boolean;
}

export interface StandingsParams {
  stageNumber: number;
  /** Raw stage name (may be absent); combined with the number by {@link formatStageLabel}. */
  stageName?: string;
  rows: StandingRow[];
  movement: Movement;
  shooterTotalScore: number;
  totalCompetitors: number;
}

function drawMovementArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  movement: Movement,
): void {
  if (movement === 'none') return;

  const size = 12;
  ctx.beginPath();
  if (movement === 'up') {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y + size / 2);
    ctx.lineTo(x - size, y + size / 2);
    ctx.fillStyle = COLORS.green;
  } else {
    ctx.moveTo(x, y + size);
    ctx.lineTo(x + size, y - size / 2);
    ctx.lineTo(x - size, y - size / 2);
    ctx.fillStyle = COLORS.red;
  }
  ctx.closePath();
  ctx.fill();
}

export function downloadStandingsImage(params: StandingsParams): void {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  drawBackground(ctx);

  // ── Header ──────────────────────────────────────────────────────
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(`Standings after ${formatStageLabel(params.stageNumber, params.stageName)}`, PAD, PAD + 22);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillText(`${params.totalCompetitors} competitors`, W - PAD - 120, PAD + 22);

  drawDivider(ctx, PAD + 38);

  // ── Rows ─────────────────────────────────────────────────────────
  const rowH = 60;
  const startY = PAD + 50;

  params.rows.forEach((row, i) => {
    const ry = startY + i * rowH;

    if (row.isShooter) {
      roundRect(ctx, PAD - 8, ry - 2, W - PAD * 2 + 16, rowH - 4, 8);
      ctx.fillStyle = COLORS.highlight;
      ctx.fill();
    } else if (i % 2 === 0) {
      roundRect(ctx, PAD - 8, ry - 2, W - PAD * 2 + 16, rowH - 4, 8);
      ctx.fillStyle = COLORS.rowAlt;
      ctx.fill();
    }

    // Rank
    ctx.fillStyle = row.isShooter ? COLORS.accent : COLORS.muted;
    ctx.font = row.isShooter ? 'bold 22px system-ui, sans-serif' : '20px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`#${row.rank}`, PAD + 52, ry + rowH / 2 + 8);
    ctx.textAlign = 'left';

    // Name
    ctx.fillStyle = row.isShooter ? COLORS.text : COLORS.muted;
    ctx.font = row.isShooter ? 'bold 22px system-ui, sans-serif' : '20px system-ui, sans-serif';
    ctx.fillText(row.name, PAD + 64, ry + rowH / 2 + 8);

    // Score percent (right-aligned)
    const pctStr = `${row.scorePercent.toFixed(1)}%`;
    ctx.fillStyle = row.isShooter ? COLORS.accent : COLORS.muted;
    ctx.font = row.isShooter ? 'bold 20px system-ui, sans-serif' : '18px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(pctStr, W - PAD - (row.isShooter ? 48 : 8), ry + rowH / 2 + 8);
    ctx.textAlign = 'left';

    // Movement arrow — only on shooter row
    if (row.isShooter) {
      drawMovementArrow(ctx, W - PAD - 20, ry + rowH / 2, params.movement);
    }
  });

  const filename = `${sanitiseFilename(formatStageLabel(params.stageNumber, params.stageName))}_standings.png`;
  triggerDownload(canvas, filename);
}

export function buildStandingsCanvas(params: StandingsParams): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  drawBackground(ctx);

  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(`Standings after ${formatStageLabel(params.stageNumber, params.stageName)}`, PAD, PAD + 22);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillText(`${params.totalCompetitors} competitors`, W - PAD - 120, PAD + 22);

  drawDivider(ctx, PAD + 38);

  const rowH = 60;
  const startY = PAD + 50;

  params.rows.forEach((row, i) => {
    const ry = startY + i * rowH;
    if (row.isShooter) {
      roundRect(ctx, PAD - 8, ry - 2, W - PAD * 2 + 16, rowH - 4, 8);
      ctx.fillStyle = COLORS.highlight;
      ctx.fill();
    } else if (i % 2 === 0) {
      roundRect(ctx, PAD - 8, ry - 2, W - PAD * 2 + 16, rowH - 4, 8);
      ctx.fillStyle = COLORS.rowAlt;
      ctx.fill();
    }

    ctx.fillStyle = row.isShooter ? COLORS.accent : COLORS.muted;
    ctx.font = row.isShooter ? 'bold 22px system-ui, sans-serif' : '20px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`#${row.rank}`, PAD + 52, ry + rowH / 2 + 8);
    ctx.textAlign = 'left';

    ctx.fillStyle = row.isShooter ? COLORS.text : COLORS.muted;
    ctx.font = row.isShooter ? 'bold 22px system-ui, sans-serif' : '20px system-ui, sans-serif';
    ctx.fillText(row.name, PAD + 64, ry + rowH / 2 + 8);

    const pctStr = `${row.scorePercent.toFixed(1)}%`;
    ctx.fillStyle = row.isShooter ? COLORS.accent : COLORS.muted;
    ctx.font = row.isShooter ? 'bold 20px system-ui, sans-serif' : '18px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(pctStr, W - PAD - (row.isShooter ? 48 : 8), ry + rowH / 2 + 8);
    ctx.textAlign = 'left';

    if (row.isShooter) {
      drawMovementArrow(ctx, W - PAD - 20, ry + rowH / 2, params.movement);
    }
  });

  return canvas;
}

export function standingsToBlob(params: StandingsParams): Promise<Blob> {
  return canvasToBlob(buildStandingsCanvas(params));
}

// ─── Zip all stages for one competitor ───────────────────────────────────────

export interface StageOverlayEntry {
  stageResultParams: StageResultParams;
  standingsParams: StandingsParams;
  filePrefix: string;   // e.g. "01-Stage_5"
}

export async function downloadAllOverlaysAsZip(
  competitorName: string,
  entries: StageOverlayEntry[],
): Promise<void> {
  const zip = new JSZip();
  const folder = zip.folder(sanitiseFilename(competitorName))!;

  await Promise.all(
    entries.map(async ({ stageResultParams, standingsParams, filePrefix }) => {
      const [resultBlob, standingsBlob] = await Promise.all([
        stageResultToBlob(stageResultParams),
        standingsToBlob(standingsParams),
      ]);
      folder.file(`${filePrefix}_result.png`, resultBlob);
      folder.file(`${filePrefix}_standings.png`, standingsBlob);
    }),
  );

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitiseFilename(competitorName)}_overlays.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
