import { calculateItemTaxPennies, penniesToPounds } from './money';

export type ResolvedTaxLine = {
  costPennies: number;
  taxRate: string;
};

export function calculateTaxPositionPennies(
  resolvedLines: ResolvedTaxLine[],
  paymentAmountsPennies: number[],
): number {
  const totalTax = resolvedLines.reduce(
    (sum, line) =>
      sum + calculateItemTaxPennies(line.costPennies, line.taxRate),
    0,
  );
  const totalPayments = paymentAmountsPennies.reduce(
    (sum, amount) => sum + amount,
    0,
  );
  return totalTax - totalPayments;
}

export function calculateTaxPositionPounds(
  resolvedLines: ResolvedTaxLine[],
  paymentAmountsPennies: number[],
): number {
  return penniesToPounds(
    calculateTaxPositionPennies(resolvedLines, paymentAmountsPennies),
  );
}
