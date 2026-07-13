import { formatStageLabel } from '../stageLabel';

describe('formatStageLabel', () => {
  test('combines number and name when a name is present', () => {
    expect(formatStageLabel(1, 'Speed Option')).toBe('1 — Speed Option');
  });

  test('falls back to "Stage N" when the name is missing', () => {
    expect(formatStageLabel(3)).toBe('Stage 3');
    expect(formatStageLabel(3, undefined)).toBe('Stage 3');
  });

  test('treats an empty or whitespace-only name as missing', () => {
    expect(formatStageLabel(4, '')).toBe('Stage 4');
    expect(formatStageLabel(4, '   ')).toBe('Stage 4');
  });

  test('trims surrounding whitespace from a real name', () => {
    expect(formatStageLabel(2, '  Speed Option  ')).toBe('2 — Speed Option');
  });

  test('preserves the intrinsic number even when the sequence has gaps', () => {
    // A dropped stage 3 leaves 1, 2, 4 with their original numbers.
    expect(formatStageLabel(4, 'Long Course')).toBe('4 — Long Course');
  });
});
