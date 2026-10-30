import {
  calculateItemTaxPennies,
  isValidMoneyAmountPennies,
  isValidTaxRate,
  penniesToPounds,
} from './money';

describe('money', () => {
  describe('calculateItemTaxPennies', () => {
    it.each([
      [1099, 0.2, 220],
      [5, 0.5, 3],
      [1, 0.2, 0],
      [1000, 0.2, 200],
      [333, 0.2, 67],
      [100, 0.2, 20],
    ])('cost %i at rate %s rounds to %i pennies', (cost, rate, expected) => {
      expect(calculateItemTaxPennies(cost, rate)).toBe(expected);
    });

    it('rounds negative tax half away from zero', () => {
      expect(calculateItemTaxPennies(-5, 0.5)).toBe(-3);
    });

    it('accepts string tax rates', () => {
      expect(calculateItemTaxPennies(333, '0.2')).toBe(67);
    });
  });

  describe('penniesToPounds', () => {
    it('converts integer pennies to pounds', () => {
      expect(penniesToPounds(49)).toBe(0.49);
      expect(penniesToPounds(-13)).toBe(-0.13);
      expect(penniesToPounds(10)).toBe(0.1);
    });

    it('serialises 49 pennies without binary noise', () => {
      const pounds = penniesToPounds(49);
      expect(JSON.stringify(pounds)).toBe('0.49');
    });
  });

  describe('isValidTaxRate', () => {
    it('accepts finite non-negative rates with up to 8 decimal places', () => {
      expect(isValidTaxRate(0)).toBe(true);
      expect(isValidTaxRate(0.2)).toBe(true);
      expect(isValidTaxRate(0.12345678)).toBe(true);
    });

    it('rejects invalid rates', () => {
      expect(isValidTaxRate(-0.1)).toBe(false);
      expect(isValidTaxRate(Number.NaN)).toBe(false);
      expect(isValidTaxRate(Number.POSITIVE_INFINITY)).toBe(false);
      expect(isValidTaxRate(0.123456789)).toBe(false);
      expect(isValidTaxRate('0.2')).toBe(false);
    });
  });

  describe('isValidMoneyAmountPennies', () => {
    it('accepts signed 32-bit safe integers including zero', () => {
      expect(isValidMoneyAmountPennies(0)).toBe(true);
      expect(isValidMoneyAmountPennies(-13)).toBe(true);
      expect(isValidMoneyAmountPennies(2_147_483_647)).toBe(true);
      expect(isValidMoneyAmountPennies(-2_147_483_648)).toBe(true);
    });

    it('rejects out-of-range and non-integers', () => {
      expect(isValidMoneyAmountPennies(2_147_483_648)).toBe(false);
      expect(isValidMoneyAmountPennies(-2_147_483_649)).toBe(false);
      expect(isValidMoneyAmountPennies(0.5)).toBe(false);
      expect(isValidMoneyAmountPennies(Number.MAX_SAFE_INTEGER)).toBe(false);
    });
  });
});
