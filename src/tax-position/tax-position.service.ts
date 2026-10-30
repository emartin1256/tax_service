import { BadRequestException, Injectable } from '@nestjs/common';
import {
  resolveEffectiveLines,
  type Amendment,
  type SaleLine,
} from '../domain/amendment-resolver';
import { calculateTaxPositionPounds } from '../domain/tax-calculator';
import {
  formatInstant,
  isValidInstantTimestamp,
  parseInstantToUtcDate,
} from '../domain/dates';
import { SaleAmendmentRepository } from '../database/sale-amendment.repository';
import { SaleItemRepository } from '../database/sale-item.repository';
import { TaxPaymentRepository } from '../database/tax-payment.repository';

export type TaxPositionResponse = {
  date: string;
  taxPosition: number;
};

@Injectable()
export class TaxPositionService {
  constructor(
    private readonly saleItems: SaleItemRepository,
    private readonly saleAmendments: SaleAmendmentRepository,
    private readonly taxPayments: TaxPaymentRepository,
  ) {}

  async getTaxPosition(
    dateParam: string | undefined,
  ): Promise<TaxPositionResponse> {
    if (dateParam === undefined || dateParam === '') {
      throw new BadRequestException('date query parameter is required');
    }
    if (!isValidInstantTimestamp(dateParam)) {
      throw new BadRequestException(
        'date must be a valid ISO-8601 instant with timezone',
      );
    }

    const at = parseInstantToUtcDate(dateParam);

    const saleRows = await this.saleItems.findEffectiveAtOrBefore(at);
    const saleKeys = saleRows.map((row) => ({
      invoiceId: row.invoiceId,
      itemId: row.itemId,
    }));

    const [amendmentRows, paymentRows] = await Promise.all([
      this.saleAmendments.findForInvoiceItemsEffectiveAtOrBefore(saleKeys, at),
      this.taxPayments.findEffectiveAtOrBefore(at),
    ]);

    const sales: SaleLine[] = saleRows.map((row) => ({
      invoiceId: row.invoiceId,
      itemId: row.itemId,
      effectiveAt: row.effectiveAt,
      costPennies: row.costPennies,
      taxRate: row.taxRate.toString(),
    }));

    const amendments: Amendment[] = amendmentRows.map((row) => ({
      invoiceId: row.invoiceId,
      itemId: row.itemId,
      effectiveAt: row.effectiveAt,
      costPennies: row.costPennies,
      taxRate: row.taxRate.toString(),
      sequence: row.sequence,
      ingestedAt: row.ingestedAt,
    }));

    const paymentAmountsPennies = paymentRows.map((row) => row.amountPennies);
    const effectiveLines = resolveEffectiveLines(sales, amendments, at);
    const taxPosition = calculateTaxPositionPounds(
      effectiveLines,
      paymentAmountsPennies,
    );

    return {
      date: formatInstant(at),
      taxPosition,
    };
  }
}
