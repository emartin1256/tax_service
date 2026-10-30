import { Injectable } from '@nestjs/common';
import { Prisma, SaleItem } from '@prisma/client';
import { saleItemAdvisoryLockKeys } from './sale-item-advisory-lock';
import { PrismaService } from './prisma.service';

export type SaleItemRecord = SaleItem;

export type InsertSaleItemInput = {
  invoiceId: string;
  itemId: string;
  effectiveAt: Date;
  costPennies: number;
  taxRate: string;
};

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class SaleItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: PrismaTx): PrismaTx | PrismaService {
    return tx ?? this.prisma;
  }

  async acquireInvoiceItemLock(
    invoiceId: string,
    itemId: string,
    tx: PrismaTx,
  ): Promise<void> {
    const [key1, key2] = saleItemAdvisoryLockKeys(invoiceId, itemId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}, ${key2})`;
  }

  findByInvoiceAndItem(
    invoiceId: string,
    itemId: string,
    tx?: PrismaTx,
  ): Promise<SaleItemRecord | null> {
    return this.client(tx).saleItem.findUnique({
      where: {
        invoiceId_itemId: { invoiceId, itemId },
      },
    });
  }

  findByInvoiceAndItems(
    invoiceId: string,
    itemIds: string[],
    tx?: PrismaTx,
  ): Promise<SaleItemRecord[]> {
    if (itemIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.client(tx).saleItem.findMany({
      where: {
        invoiceId,
        itemId: { in: itemIds },
      },
    });
  }

  insert(input: InsertSaleItemInput, tx?: PrismaTx): Promise<SaleItemRecord> {
    return this.client(tx).saleItem.create({
      data: {
        invoiceId: input.invoiceId,
        itemId: input.itemId,
        effectiveAt: input.effectiveAt,
        costPennies: input.costPennies,
        taxRate: input.taxRate,
      },
    });
  }

  findEffectiveAtOrBefore(at: Date): Promise<SaleItemRecord[]> {
    return this.prisma.saleItem.findMany({
      where: { effectiveAt: { lte: at } },
    });
  }
}
