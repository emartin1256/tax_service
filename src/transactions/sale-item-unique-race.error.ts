import type Decimal from 'decimal.js';

export class SaleItemUniqueRaceError extends Error {
  constructor(
    readonly invoiceId: string,
    readonly itemId: string,
    readonly effectiveAt: Date,
    readonly costPennies: number,
    readonly taxRate: Decimal,
  ) {
    super('Concurrent insert on sale item unique key');
    this.name = 'SaleItemUniqueRaceError';
  }
}
