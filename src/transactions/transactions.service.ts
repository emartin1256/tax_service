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
        const itemIds = payload.items.map((item) => item.itemId);
        await this.saleItems.acquireInvoiceItemLocks(
          payload.invoiceId,
          itemIds,
          tx,
        );

        const existingRows = await this.saleItems.findByInvoiceAndItems(
          payload.invoiceId,
          itemIds,
          tx,
        );
        const existingByItemId = new Map(
          existingRows.map((row) => [row.itemId, row]),
        );

        const toInsert: Array<{
          invoiceId: string;
          itemId: string;
          effectiveAt: Date;
          costPennies: number;
          taxRate: string;
        }> = [];
        let identicalReplay = 0;

        for (const item of payload.items) {
          const taxRate = decimalTaxRate(item.taxRate);
          const existing = existingByItemId.get(item.itemId);
          if (existing) {
            this.assertIdenticalOrThrow(
              existing,
              effectiveAt,
              item.cost,
              taxRate,
            );
            identicalReplay += 1;
            continue;
          }
          toInsert.push({
            invoiceId: payload.invoiceId,
            itemId: item.itemId,
            effectiveAt,
            costPennies: item.cost,
            taxRate: taxRate.toString(),
          });
        }

        let created = 0;
        let recognizedPennies = 0;
        const now = new Date();

        if (toInsert.length > 0) {
          try {
            await this.saleItems.createMany(toInsert, tx);
          } catch (error) {
            if (this.isUniqueViolation(error)) {
              throw new SaleItemUniqueRaceError(
                payload.invoiceId,
                toInsert.map((row) => ({
                  invoiceId: row.invoiceId,
                  itemId: row.itemId,
                  effectiveAt: row.effectiveAt,
                  costPennies: row.costPennies,
                  taxRate: decimalTaxRate(row.taxRate),
                })),
              );
            }
            throw error;
          }
          created = toInsert.length;
          for (const item of payload.items) {
            if (existingByItemId.has(item.itemId)) {
              continue;
            }
            if (effectiveAt.getTime() <= now.getTime()) {
              recognizedPennies += calculateItemTaxPennies(
                item.cost,
                item.taxRate,
              );
            }
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
    const pendingItemIds = race.pendingInserts.map((pending) => pending.itemId);
    const existingRows = await this.saleItems.findByInvoiceAndItems(
      race.invoiceId,
      pendingItemIds,
    );
    const existingByItemId = new Map(
      existingRows.map((row) => [row.itemId, row]),
    );

    for (const pending of race.pendingInserts) {
      const existing = existingByItemId.get(pending.itemId);
      if (
        existing &&
        !this.isIdenticalSaleItem(
          existing,
          pending.effectiveAt,
          pending.costPennies,
          pending.taxRate,
        )
      ) {
        this.ledgerMetrics.recordSaleLineConflict();
        throw new ConflictException(SALE_CONFLICT_MESSAGE);
      }
    }

    const allAbsent = race.pendingInserts.every(
      (pending) => !existingByItemId.has(pending.itemId),
    );
    if (allAbsent) {
      throw race;
    }

    const allPresentIdentical = race.pendingInserts.every((pending) => {
      const existing = existingByItemId.get(pending.itemId);
      return (
        existing !== undefined &&
        this.isIdenticalSaleItem(
          existing,
          pending.effectiveAt,
          pending.costPennies,
          pending.taxRate,
        )
      );
    });

    if (allPresentIdentical) {
      if (!allowRetry) {
        return;
      }
      await this.ingestSales(payload, false);
      return;
    }

    const anyAbsent = race.pendingInserts.some(
      (pending) => !existingByItemId.has(pending.itemId),
    );
    if (anyAbsent && allowRetry) {
      await this.ingestSales(payload, false);
      return;
    }

    throw race;
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
