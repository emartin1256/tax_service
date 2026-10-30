import Decimal from 'decimal.js';

const MIN_MONEY_PENNIES = -2_147_483_648;
const MAX_MONEY_PENNIES = 2_147_483_647;
const MAX_TAX_RATE_DECIMAL_PLACES = 8;

export function decimalTaxRate(value: number | string): Decimal {
  return new Decimal(value.toString());
}

export function calculateItemTaxPennies(
  costPennies: number,
  taxRate: number | string,
): number {
  return decimalTaxRate(taxRate)
    .mul(costPennies)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function penniesToPounds(pennies: number): number {
  return new Decimal(pennies).div(100).toNumber();
}

export function isValidTaxRate(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return false;
  }
  const decimal = new Decimal(value.toString());
  return decimal.decimalPlaces() <= MAX_TAX_RATE_DECIMAL_PLACES;
}

export function isValidMoneyAmountPennies(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return false;
  }
  return value >= MIN_MONEY_PENNIES && value <= MAX_MONEY_PENNIES;
}
