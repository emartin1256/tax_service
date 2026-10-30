import { Injectable } from '@nestjs/common';
import { Prisma, TaxPayment } from '@prisma/client';
import { PrismaService } from './prisma.service';

export type TaxPaymentRecord = TaxPayment;

export type InsertTaxPaymentInput = {
  effectiveAt: Date;
  amountPennies: number;
};

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class TaxPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    input: InsertTaxPaymentInput,
    tx?: PrismaTx,
  ): Promise<TaxPaymentRecord> {
    const client = tx ?? this.prisma;
    return client.taxPayment.create({
      data: {
        effectiveAt: input.effectiveAt,
        amountPennies: input.amountPennies,
      },
    });
  }

  findEffectiveAtOrBefore(at: Date): Promise<TaxPaymentRecord[]> {
    return this.prisma.taxPayment.findMany({
      where: { effectiveAt: { lte: at } },
    });
  }
}
