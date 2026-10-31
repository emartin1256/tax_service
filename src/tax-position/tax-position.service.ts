import { BadRequestException, Injectable } from '@nestjs/common';
import {
  resolveEffectiveLines,
  type Amendment,
  type SaleLine,
} from '../domain/amendment-resolver';
import { calculateTaxPositionPennies } from '../domain/tax-calculator';
import {
  formatInstant,
  isValidInstantTimestamp,
  parseInstantToUtcDate,
} from '../domain/dates';
import { penniesToPounds } from '../domain/money';
import { SaleAmendmentRepository } from '../database/sale-amendment.repository';
import { SaleItemRepository } from '../database/sale-item.repository';
import { TaxPaymentRepository } from '../database/tax-payment.repository';
import {
  classifyTaxPositionQueryHorizon,
  LedgerMetrics,
} from '../observability/ledger-metrics';

export type TaxPositionResponse = {
  date: string;
  taxPosition: number;
};

export type TaxPositionAtResult = {
  pennies: number;
  effectiveLineCount: number;
};

@Injectable()
export class TaxPositionService {
  constructor(
    private readonly saleItems: SaleItemRepository,
    private readonly saleAmendments: SaleAmendmentRepository,
    private readonly taxPayments: TaxPaymentRepository,
    private readonly ledgerMetrics: LedgerMetrics,
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
    const now = new Date();
    const { pennies, effectiveLineCount } = await this.positionPenniesAt(at);

    this.ledgerMetrics.recordTaxPositionQuery(
      classifyTaxPositionQueryHorizon(at, now),
    );
    this.ledgerMetrics.recordTaxPositionResult(pennies);
    this.ledgerMetrics.recordTaxPositionLines(effectiveLineCount);

    return {
      date: formatInstant(at),
      taxPosition: penniesToPounds(pennies),
    };
  }

  async positionPenniesAt(at: Date): Promise<TaxPositionAtResult> {
    const effectiveLines = await this.loadResolvedLinesForPounds(at);
    const paymentAmountsPennies = await this.loadPaymentAmountsPennies(at);
    const pennies = calculateTaxPositionPennies(
      effectiveLines,
      paymentAmountsPennies,
    );
    return {
      pennies,
      effectiveLineCount: effectiveLines.length,
    };
  }

  private async loadResolvedLinesForPounds(at: Date) {
    const saleRows = await this.saleItems.findEffectiveAtOrBefore(at);
    const saleKeys = saleRows.map((row) => ({
      invoiceId: row.invoiceId,
      itemId: row.itemId,
    }));

    const amendmentRows =
      await this.saleAmendments.findForInvoiceItemsEffectiveAtOrBefore(
        saleKeys,
        at,
      );

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

    return resolveEffectiveLines(sales, amendments, at);
  }

  private async loadPaymentAmountsPennies(at: Date): Promise<number[]> {
    const paymentRows = await this.taxPayments.findEffectiveAtOrBefore(at);
    return paymentRows.map((row) => row.amountPennies);
  }
}
