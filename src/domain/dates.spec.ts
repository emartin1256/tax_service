import {
  formatInstant,
  isValidInstantTimestamp,
  parseInstantToUtcDate,
} from './dates';

describe('dates', () => {
  describe('isValidInstantTimestamp', () => {
    it('accepts timestamps with date, time, and timezone', () => {
      expect(isValidInstantTimestamp('2024-02-22T17:29:39Z')).toBe(true);
      expect(isValidInstantTimestamp('2024-02-22T18:29:39+01:00')).toBe(true);
      expect(isValidInstantTimestamp('2024-02-22T17:29:39.123Z')).toBe(true);
    });

    it('rejects date-only and datetime without zone', () => {
      expect(isValidInstantTimestamp('2024-02-22')).toBe(false);
      expect(isValidInstantTimestamp('2024-02-22T17:29:39')).toBe(false);
    });
  });

  describe('parseInstantToUtcDate', () => {
    it('normalises offsets to the same UTC instant', () => {
      const fromZ = parseInstantToUtcDate('2024-02-22T17:29:39Z');
      const fromOffset = parseInstantToUtcDate('2024-02-22T18:29:39+01:00');
      expect(fromZ.getTime()).toBe(fromOffset.getTime());
    });

    it('throws for invalid timestamps', () => {
      expect(() => parseInstantToUtcDate('2024-02-22')).toThrow(
        'Invalid instant timestamp',
      );
    });
  });

  describe('formatInstant', () => {
    it('omits milliseconds when zero', () => {
      const date = parseInstantToUtcDate('2024-02-22T17:29:39Z');
      expect(formatInstant(date)).toBe('2024-02-22T17:29:39Z');
    });

    it('keeps three millisecond digits when non-zero', () => {
      const date = parseInstantToUtcDate('2024-02-22T17:29:39.123Z');
      expect(formatInstant(date)).toBe('2024-02-22T17:29:39.123Z');
    });
  });
});
