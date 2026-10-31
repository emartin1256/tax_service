import {
  formatInstant,
  isValidInstantTimestamp,
  parseInstantToUtcDate,
} from './dates';

describe('dates', () => {
  describe('isValidInstantTimestamp', () => {
    it('accepts valid instants including offsets, leap day, and fractions', () => {
      expect(isValidInstantTimestamp('2024-02-22T17:29:39Z')).toBe(true);
      expect(isValidInstantTimestamp('2024-02-22T18:29:39+01:00')).toBe(true);
      expect(isValidInstantTimestamp('2024-02-29T00:00:00Z')).toBe(true);
      expect(isValidInstantTimestamp('2024-02-22T23:59:59Z')).toBe(true);
      expect(isValidInstantTimestamp('2024-02-22T17:29:39.123Z')).toBe(true);
      expect(isValidInstantTimestamp('2024-01-01T00:00:00.123456789Z')).toBe(
        true,
      );
    });

    it('rejects date-only and datetime without zone', () => {
      expect(isValidInstantTimestamp('2024-02-22')).toBe(false);
      expect(isValidInstantTimestamp('2024-02-22T17:29:39')).toBe(false);
    });

    it('rejects impossible calendar dates', () => {
      expect(isValidInstantTimestamp('2024-02-31T00:00:00Z')).toBe(false);
      expect(isValidInstantTimestamp('2024-04-31T00:00:00Z')).toBe(false);
      expect(isValidInstantTimestamp('2023-02-29T00:00:00Z')).toBe(false);
      expect(isValidInstantTimestamp('2024-13-01T00:00:00Z')).toBe(false);
    });

    it('rejects out-of-range time fields', () => {
      expect(isValidInstantTimestamp('2024-01-01T24:00:00Z')).toBe(false);
      expect(isValidInstantTimestamp('2024-01-01T00:00:60Z')).toBe(false);
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
      expect(() => parseInstantToUtcDate('2024-02-31T00:00:00Z')).toThrow(
        'Invalid instant timestamp',
      );
      expect(() => parseInstantToUtcDate('2023-02-29T00:00:00Z')).toThrow(
        'Invalid instant timestamp',
      );
      expect(() => parseInstantToUtcDate('2024-01-01T24:00:00Z')).toThrow(
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
