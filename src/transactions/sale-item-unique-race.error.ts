import type Decimal from 'decimal.js';

export type PendingSaleItemInsert = {
  invoiceId: string;
  itemId: string;
  effectiveAt: Date;
  costPennies: number;
  taxRate: Decimal;
};

export class SaleItemUniqueRaceError extends Error {
  constructor(
    readonly invoiceId: string,
    readonly pendingInserts: PendingSaleItemInsert[],
  ) {
    super('Concurrent insert on sale item unique key');
    this.name = 'SaleItemUniqueRaceError';
  }
}
