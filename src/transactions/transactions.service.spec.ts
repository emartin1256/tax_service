jest.mock('@nestjs/common', () => ({
  ConflictException: class ConflictException extends Error {
    constructor(message?: string) {
      super(message);
      this.name = 'ConflictException';
    }
  },
  Injectable: () => (target: unknown) => target,
  Logger: class Logger {
    log(): void {}
  },
}));

jest.mock('../database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));
jest.mock('../database/sale-amendment.repository', () => ({
  SaleAmendmentRepository: class SaleAmendmentRepository {},
}));
jest.mock('../database/tax-payment.repository', () => ({
  TaxPaymentRepository: class TaxPaymentRepository {},
}));
jest.mock('../database/sale-item.repository', () => ({
  SaleItemRepository: class SaleItemRepository {},
}));
jest.mock('../observability/ledger-metrics', () => ({
  LedgerMetrics: class LedgerMetrics {},
}));
jest.mock('../tax-position/tax-position.service', () => ({
  TaxPositionService: class TaxPositionService {},
}));

import { Prisma } from '@prisma/client';
import { TransactionsService } from './transactions.service';

function uniqueViolationError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('TransactionsService sales ingest', () => {
  let service: TransactionsService;
  let prisma: { $transaction: jest.Mock };
  let saleItems: {
    acquireInvoiceItemLocks: jest.Mock;
    findByInvoiceAndItems: jest.Mock;
    createMany: jest.Mock;
    findByInvoiceAndItem: jest.Mock;
  };
  let ledgerMetrics: {
    recordSaleLines: jest.Mock;
    recordRecognizedTaxPennies: jest.Mock;
    recordFutureDatedEvent: jest.Mock;
    recordSaleLineConflict: jest.Mock;
    recordPositionNowGauge: jest.Mock;
  };
  let taxPosition: { positionPenniesAt: jest.Mock };
  let fakeTx: object;

  beforeEach(() => {
    fakeTx = {};
    prisma = {
      $transaction: jest.fn(async (callback) => callback(fakeTx)),
    };
    saleItems = {
      acquireInvoiceItemLocks: jest.fn().mockResolvedValue(undefined),
      findByInvoiceAndItems: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue(undefined),
      findByInvoiceAndItem: jest.fn(),
    };
    ledgerMetrics = {
      recordSaleLines: jest.fn(),
      recordRecognizedTaxPennies: jest.fn(),
      recordFutureDatedEvent: jest.fn(),
      recordSaleLineConflict: jest.fn(),
      recordPositionNowGauge: jest.fn(),
    };
    taxPosition = {
      positionPenniesAt: jest.fn().mockResolvedValue({ pennies: 42 }),
    };

    service = new TransactionsService(
      prisma as never,
      saleItems as never,
      {} as never,
      {} as never,
      ledgerMetrics as never,
      taxPosition as never,
    );
  });

  it('uses one bulk lock, one find, and one createMany for a new multi-line sale', async () => {
    await service.ingestTransaction({
      eventType: 'SALES',
      date: '2020-01-01T00:00:00.000Z',
      invoiceId: 'inv-1',
      items: [
        { itemId: 'line-a', cost: 100, taxRate: 0.2 },
        { itemId: 'line-b', cost: 250, taxRate: 0.2 },
      ],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(saleItems.acquireInvoiceItemLocks).toHaveBeenCalledWith(
      'inv-1',
      ['line-a', 'line-b'],
      fakeTx,
    );
    expect(saleItems.findByInvoiceAndItems).toHaveBeenCalledWith(
      'inv-1',
      ['line-a', 'line-b'],
      fakeTx,
    );
    expect(saleItems.createMany).toHaveBeenCalledTimes(1);
    expect(saleItems.createMany).toHaveBeenCalledWith(
      [
        {
          invoiceId: 'inv-1',
          itemId: 'line-a',
          effectiveAt: new Date('2020-01-01T00:00:00.000Z'),
          costPennies: 100,
          taxRate: '0.2',
        },
        {
          invoiceId: 'inv-1',
          itemId: 'line-b',
          effectiveAt: new Date('2020-01-01T00:00:00.000Z'),
          costPennies: 250,
          taxRate: '0.2',
        },
      ],
      fakeTx,
    );
    expect(ledgerMetrics.recordSaleLines).toHaveBeenCalledWith(2, 0);
    expect(ledgerMetrics.recordRecognizedTaxPennies).toHaveBeenCalledWith(70);
    expect(ledgerMetrics.recordFutureDatedEvent).not.toHaveBeenCalled();
    expect(ledgerMetrics.recordPositionNowGauge).toHaveBeenCalledWith(42);
  });

  it('does not createMany when every line is an identical replay', async () => {
    saleItems.findByInvoiceAndItems.mockResolvedValue([
      {
        itemId: 'line-a',
        effectiveAt: new Date('2020-01-01T00:00:00.000Z'),
        costPennies: 100,
        taxRate: new Prisma.Decimal('0.2'),
      },
    ]);

    await service.ingestTransaction({
      eventType: 'SALES',
      date: '2020-01-01T00:00:00.000Z',
      invoiceId: 'inv-1',
      items: [{ itemId: 'line-a', cost: 100, taxRate: 0.2 }],
    });

    expect(saleItems.createMany).not.toHaveBeenCalled();
    expect(ledgerMetrics.recordSaleLines).toHaveBeenCalledWith(0, 1);
    expect(ledgerMetrics.recordRecognizedTaxPennies).toHaveBeenCalledWith(0);
    expect(ledgerMetrics.recordFutureDatedEvent).not.toHaveBeenCalled();
  });

  it('rejects a mixed payload with conflict and does not createMany', async () => {
    saleItems.findByInvoiceAndItems.mockResolvedValue([
      {
        itemId: 'line-a',
        effectiveAt: new Date('2020-01-01T00:00:00.000Z'),
        costPennies: 999,
        taxRate: new Prisma.Decimal('0.2'),
      },
    ]);

    await expect(
      service.ingestTransaction({
        eventType: 'SALES',
        date: '2020-01-01T00:00:00.000Z',
        invoiceId: 'inv-1',
        items: [
          { itemId: 'line-a', cost: 100, taxRate: 0.2 },
          { itemId: 'line-b', cost: 200, taxRate: 0.2 },
        ],
      }),
    ).rejects.toMatchObject({
      message:
        'Sale item already exists with different effective date, cost, or tax rate. Use PATCH /sale to amend.',
    });

    expect(saleItems.createMany).not.toHaveBeenCalled();
    expect(ledgerMetrics.recordSaleLineConflict).toHaveBeenCalledTimes(1);
    expect(ledgerMetrics.recordSaleLines).not.toHaveBeenCalled();
    expect(ledgerMetrics.recordRecognizedTaxPennies).not.toHaveBeenCalled();
    expect(ledgerMetrics.recordPositionNowGauge).not.toHaveBeenCalled();
  });

  it('records future-dated sale metrics only for newly created lines', async () => {
    await service.ingestTransaction({
      eventType: 'SALES',
      date: '2099-06-01T12:00:00.000Z',
      invoiceId: 'inv-1',
      items: [{ itemId: 'line-a', cost: 100, taxRate: 0.2 }],
    });

    expect(ledgerMetrics.recordFutureDatedEvent).toHaveBeenCalledWith('sale');
    expect(ledgerMetrics.recordRecognizedTaxPennies).toHaveBeenCalledWith(0);
    expect(ledgerMetrics.recordSaleLines).toHaveBeenCalledWith(1, 0);
  });

  it('after createMany P2002, conflicts when a later pending line exists with different cost', async () => {
    saleItems.findByInvoiceAndItems
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          itemId: 'line-b',
          effectiveAt: new Date('2020-01-01T00:00:00.000Z'),
          costPennies: 999,
          taxRate: new Prisma.Decimal('0.2'),
        },
      ]);
    saleItems.createMany.mockRejectedValueOnce(uniqueViolationError());

    await expect(
      service.ingestTransaction({
        eventType: 'SALES',
        date: '2020-01-01T00:00:00.000Z',
        invoiceId: 'inv-1',
        items: [
          { itemId: 'line-a', cost: 100, taxRate: 0.2 },
          { itemId: 'line-b', cost: 200, taxRate: 0.2 },
        ],
      }),
    ).rejects.toMatchObject({
      message:
        'Sale item already exists with different effective date, cost, or tax rate. Use PATCH /sale to amend.',
    });

    expect(saleItems.findByInvoiceAndItems).toHaveBeenCalledTimes(2);
    expect(saleItems.findByInvoiceAndItems).toHaveBeenLastCalledWith('inv-1', [
      'line-a',
      'line-b',
    ]);
    expect(ledgerMetrics.recordSaleLineConflict).toHaveBeenCalledTimes(1);
    expect(ledgerMetrics.recordSaleLines).not.toHaveBeenCalled();
    expect(ledgerMetrics.recordRecognizedTaxPennies).not.toHaveBeenCalled();
    expect(ledgerMetrics.recordPositionNowGauge).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('after createMany P2002, retries once when the first pending line is identical and a later line is absent', async () => {
    saleItems.findByInvoiceAndItems
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          itemId: 'line-a',
          effectiveAt: new Date('2020-01-01T00:00:00.000Z'),
          costPennies: 100,
          taxRate: new Prisma.Decimal('0.2'),
        },
      ])
      .mockResolvedValueOnce([
        {
          itemId: 'line-a',
          effectiveAt: new Date('2020-01-01T00:00:00.000Z'),
          costPennies: 100,
          taxRate: new Prisma.Decimal('0.2'),
        },
      ]);
    saleItems.createMany
      .mockRejectedValueOnce(uniqueViolationError())
      .mockResolvedValueOnce(undefined);

    await service.ingestTransaction({
      eventType: 'SALES',
      date: '2020-01-01T00:00:00.000Z',
      invoiceId: 'inv-1',
      items: [
        { itemId: 'line-a', cost: 100, taxRate: 0.2 },
        { itemId: 'line-b', cost: 200, taxRate: 0.2 },
      ],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(saleItems.createMany).toHaveBeenCalledTimes(2);
    expect(saleItems.createMany).toHaveBeenLastCalledWith(
      [
        {
          invoiceId: 'inv-1',
          itemId: 'line-b',
          effectiveAt: new Date('2020-01-01T00:00:00.000Z'),
          costPennies: 200,
          taxRate: '0.2',
        },
      ],
      fakeTx,
    );
    expect(ledgerMetrics.recordSaleLines).toHaveBeenCalledWith(1, 1);
  });
});
