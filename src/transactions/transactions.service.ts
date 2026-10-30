import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { parseInstantToUtcDate } from '../domain/dates';
import { decimalTaxRate } from '../domain/money';
import { SaleAmendmentRepository } from '../database/sale-amendment.repository';
import { SaleItemRepository } from '../database/sale-item.repository';
import { TaxPaymentRepository } from '../database/tax-payment.repository';
import { PrismaService } from '../database/prisma.service';
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

    await this.saleAmendments.insert({
      invoiceId: dto.invoiceId,
      itemId: dto.itemId,
      effectiveAt,
      costPennies: dto.cost,
      taxRate,
    });
  }

  private async ingestTaxPayment(payload: {
    date: string;
    amount: number;
  }): Promise<void> {
    await this.taxPayments.insert({
      effectiveAt: parseInstantToUtcDate(payload.date),
      amountPennies: payload.amount,
    });
  }

  private async ingestSales(
    payload: SalesIngestPayload,
    allowRetry = true,
  ): Promise<void> {
    const effectiveAt = parseInstantToUtcDate(payload.date);

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const item of payload.items) {
          await this.processSaleItem(
            tx,
            payload.invoiceId,
            effectiveAt,
            item.itemId,
            item.cost,
            decimalTaxRate(item.taxRate),
          );
        }
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      if (error instanceof SaleItemUniqueRaceError) {
        await this.handleUniqueRaceAfterRollback(error, payload, allowRetry);
        return;
      }
      throw error;
    }
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

    throw new ConflictException(SALE_CONFLICT_MESSAGE);
  }

  private async processSaleItem(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    effectiveAt: Date,
    itemId: string,
    costPennies: number,
    taxRate: Decimal,
  ): Promise<void> {
    await this.saleItems.acquireInvoiceItemLock(invoiceId, itemId, tx);

    const taxRateString = taxRate.toString();
    const existing = await this.saleItems.findByInvoiceAndItem(
      invoiceId,
      itemId,
      tx,
    );

    if (existing) {
      this.assertIdenticalOrThrow(existing, effectiveAt, costPennies, taxRate);
      return;
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
