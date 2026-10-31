import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { parseInstantToUtcDate } from '../domain/dates';
import { calculateItemTaxPennies, decimalTaxRate } from '../domain/money';
import { SaleAmendmentRepository } from '../database/sale-amendment.repository';
import { SaleItemRepository } from '../database/sale-item.repository';
import { TaxPaymentRepository } from '../database/tax-payment.repository';
import { PrismaService } from '../database/prisma.service';
import { LedgerMetrics } from '../observability/ledger-metrics';
import { TaxPositionService } from '../tax-position/tax-position.service';
import type { AmendSaleDto } from './dto/amend-sale.dto';
import {
  asSalesIngestPayload,
  asTaxPaymentIngestPayload,
  type IngestTransactionDto,
} from './dto/ingest-transaction.dto';
import { SaleItemUniqueRaceError } from './sale-item-unique-race.error';

const SALE_CONFLICT_MESSAGE =
  'Sale item already exists with different effective date, cost, or tax rate. Use PATCH /sale to amend.';

type SalesIngestPayload = {
  date: string;
  invoiceId: string;
  items: Array<{ itemId: string; cost: number; taxRate: number }>;
};

type SaleItemOutcome = 'created' | 'identical_replay';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly saleItems: SaleItemRepository,
    private readonly saleAmendments: SaleAmendmentRepository,
    private readonly taxPayments: TaxPaymentRepository,
    private readonly ledgerMetrics: LedgerMetrics,
    private readonly taxPosition: TaxPositionService,
  ) {}

  async ingestTransaction(dto: IngestTransactionDto): Promise<void> {
    if (dto.eventType === 'SALES') {
      const payload = asSalesIngestPayload(dto);
      this.logger.log({
        eventType: payload.eventType,
        invoiceId: payload.invoiceId,
        itemCount: payload.items.length,
      });
      await this.ingestSales(payload);
      return;
    }

    const payload = asTaxPaymentIngestPayload(dto);
    this.logger.log({
      eventType: payload.eventType,
    });
    await this.ingestTaxPayment(payload);
  }

  async amendSale(dto: AmendSaleDto): Promise<void> {
    const effectiveAt = parseInstantToUtcDate(dto.date);
    const taxRate = decimalTaxRate(dto.taxRate).toString();
    const existingSale = await this.saleItems.findByInvoiceAndItem(
      dto.invoiceId,
      dto.itemId,
    );

    await this.saleAmendments.insert({
      invoiceId: dto.invoiceId,
      itemId: dto.itemId,
      effectiveAt,
      costPennies: dto.cost,
      taxRate,
    });

    this.ledgerMetrics.recordAmendment(existingSale !== null);
    const now = new Date();
    if (effectiveAt.getTime() > now.getTime()) {
      this.ledgerMetrics.recordFutureDatedEvent('amendment');
    }
    await this.recordPositionNowGauge();
  }

  private async ingestTaxPayment(payload: {
    date: string;
    amount: number;
  }): Promise<void> {
    const effectiveAt = parseInstantToUtcDate(payload.date);
    await this.taxPayments.insert({
      effectiveAt,
      amountPennies: payload.amount,
    });

    this.ledgerMetrics.recordPayment();
    this.ledgerMetrics.recordPaymentPennies(payload.amount);
    const now = new Date();
    if (effectiveAt.getTime() > now.getTime()) {
      this.ledgerMetrics.recordFutureDatedEvent('payment');
    }
    await this.recordPositionNowGauge();
  }

  private async ingestSales(
    payload: SalesIngestPayload,
    allowRetry = true,
  ): Promise<void> {
    const effectiveAt = parseInstantToUtcDate(payload.date);

    try {
      const tallies = await this.prisma.$transaction(async (tx) => {
        let created = 0;
        let identicalReplay = 0;
        let recognizedPennies = 0;
        const now = new Date();

        for (const item of payload.items) {
          const outcome = await this.processSaleItem(
            tx,
            payload.invoiceId,
            effectiveAt,
            item.itemId,
            item.cost,
            decimalTaxRate(item.taxRate),
          );
          if (outcome === 'created') {
            created += 1;
            if (effectiveAt.getTime() <= now.getTime()) {
              recognizedPennies += calculateItemTaxPennies(
                item.cost,
                item.taxRate,
              );
            }
          } else {
            identicalReplay += 1;
          }
        }

        return { created, identicalReplay, recognizedPennies };
      });

      this.ledgerMetrics.recordSaleLines(
        tallies.created,
        tallies.identicalReplay,
      );
      this.ledgerMetrics.recordRecognizedTaxPennies(tallies.recognizedPennies);
      const now = new Date();
      if (tallies.created > 0 && effectiveAt.getTime() > now.getTime()) {
        this.ledgerMetrics.recordFutureDatedEvent('sale');
      }
      await this.recordPositionNowGauge();
    } catch (error) {
      if (error instanceof ConflictException) {
        this.ledgerMetrics.recordSaleLineConflict();
        throw error;
      }
      if (error instanceof SaleItemUniqueRaceError) {
        await this.handleUniqueRaceAfterRollback(error, payload, allowRetry);
        return;
      }
      throw error;
    }
  }

  private async recordPositionNowGauge(): Promise<void> {
    const { pennies } = await this.taxPosition.positionPenniesAt(new Date());
    this.ledgerMetrics.recordPositionNowGauge(pennies);
  }

  private async handleUniqueRaceAfterRollback(
    race: SaleItemUniqueRaceError,
    payload: SalesIngestPayload,
    allowRetry: boolean,
  ): Promise<void> {
    const existing = await this.saleItems.findByInvoiceAndItem(
      race.invoiceId,
      race.itemId,
    );
    if (!existing) {
      throw race;
    }

    if (
      this.isIdenticalSaleItem(
        existing,
        race.effectiveAt,
        race.costPennies,
        race.taxRate,
      )
    ) {
      if (!allowRetry) {
        return;
      }
      await this.ingestSales(payload, false);
      return;
    }

    this.ledgerMetrics.recordSaleLineConflict();
    throw new ConflictException(SALE_CONFLICT_MESSAGE);
  }

  private async processSaleItem(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    effectiveAt: Date,
    itemId: string,
    costPennies: number,
    taxRate: Decimal,
  ): Promise<SaleItemOutcome> {
    await this.saleItems.acquireInvoiceItemLock(invoiceId, itemId, tx);

    const taxRateString = taxRate.toString();
    const existing = await this.saleItems.findByInvoiceAndItem(
      invoiceId,
      itemId,
      tx,
    );

    if (existing) {
      this.assertIdenticalOrThrow(existing, effectiveAt, costPennies, taxRate);
      return 'identical_replay';
    }

    try {
      await this.saleItems.insert(
        {
          invoiceId,
          itemId,
          effectiveAt,
          costPennies,
          taxRate: taxRateString,
        },
        tx,
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new SaleItemUniqueRaceError(
          invoiceId,
          itemId,
          effectiveAt,
          costPennies,
          taxRate,
        );
      }
      throw error;
    }

    return 'created';
  }

  private assertIdenticalOrThrow(
    existing: {
      effectiveAt: Date;
      costPennies: number;
      taxRate: Prisma.Decimal;
    },
    effectiveAt: Date,
    costPennies: number,
    taxRate: Decimal,
  ): void {
    if (this.isIdenticalSaleItem(existing, effectiveAt, costPennies, taxRate)) {
      return;
    }
    throw new ConflictException(SALE_CONFLICT_MESSAGE);
  }

  private isIdenticalSaleItem(
    existing: {
      effectiveAt: Date;
      costPennies: number;
      taxRate: Prisma.Decimal;
    },
    effectiveAt: Date,
    costPennies: number,
    taxRate: Decimal,
  ): boolean {
    return (
      existing.effectiveAt.getTime() === effectiveAt.getTime() &&
      existing.costPennies === costPennies &&
      decimalTaxRate(existing.taxRate.toString()).equals(taxRate)
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
