/**
 * Human label for a stage, combining its ordinal number with its name.
 *
 * Competitors, RO briefings, and printed stage books refer to stages by their
 * number, so we always lead with it: "1 — Speed Option" when the stage has a
 * real name, or "Stage 1" as the fallback when it doesn't. This is the single
 * source of truth for that format across the app (detail rows, leaderboards,
 * pickers, and the canvas overlays), so the separator only ever changes here.
 *
 * `stage` is the intrinsic stage number from the source API (not an array
 * index), so a gap in the sequence (…2, 4… after a stage is dropped) is correct.
 */
export function formatStageLabel(stage: number, stageName?: string): string {
  const name = stageName?.trim();
  return name ? `${stage} — ${name}` : `Stage ${stage}`;
}
