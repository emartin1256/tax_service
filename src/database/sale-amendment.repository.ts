import { Injectable } from '@nestjs/common';
import { Prisma, SaleAmendment } from '@prisma/client';
import { PrismaService } from './prisma.service';

export type SaleAmendmentRecord = SaleAmendment;

export type InsertSaleAmendmentInput = {
  invoiceId: string;
  itemId: string;
  effectiveAt: Date;
  costPennies: number;
  taxRate: string;
};

export type InvoiceItemKey = {
  invoiceId: string;
  itemId: string;
};

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class SaleAmendmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    input: InsertSaleAmendmentInput,
    tx?: PrismaTx,
  ): Promise<SaleAmendmentRecord> {
    const client = tx ?? this.prisma;
    return client.saleAmendment.create({
      data: {
        invoiceId: input.invoiceId,
        itemId: input.itemId,
        effectiveAt: input.effectiveAt,
        costPennies: input.costPennies,
        taxRate: input.taxRate,
      },
    });
  }

  findForInvoiceItemsEffectiveAtOrBefore(
    keys: InvoiceItemKey[],
    at: Date,
  ): Promise<SaleAmendmentRecord[]> {
    if (keys.length === 0) {
      return Promise.resolve([]);
    }
    return this.prisma.saleAmendment.findMany({
      where: {
        effectiveAt: { lte: at },
        OR: keys.map(({ invoiceId, itemId }) => ({ invoiceId, itemId })),
      },
    });
  }
}
