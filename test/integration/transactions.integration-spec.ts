import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ApiExceptionFilter } from '../../src/common/filters/api-exception.filter';
import type { Env } from '../../src/config/env.schema';
import { PrismaService } from '../../src/database/prisma.service';

const defaultDatabaseUrl =
  'postgresql://tax:tax@localhost:5432/tax_service_test?schema=public';

const integrationEnv: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL ?? defaultDatabaseUrl,
  LOG_LEVEL: 'silent',
  OTEL_ENABLED: false,
};

describe('Transactions (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = integrationEnv.DATABASE_URL;
    process.env.DIRECT_DATABASE_URL = integrationEnv.DIRECT_DATABASE_URL;

    execSync('npx prisma migrate deploy', {
      env: {
        ...process.env,
        DATABASE_URL: integrationEnv.DATABASE_URL,
        DIRECT_DATABASE_URL: integrationEnv.DIRECT_DATABASE_URL,
      },
      stdio: 'inherit',
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.register(integrationEnv)],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: false,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE sale_items, sale_amendments, tax_payments RESTART IDENTITY',
    );
  });

  it('POST sale returns 202 with empty body and persists the row', async () => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-02-22T17:29:39Z',
        invoiceId: 'inv-post',
        items: [{ itemId: 'item-a', cost: 1099, taxRate: 0.2 }],
      });

    expect(response.status).toBe(202);
    expect(response.text).toBe('');

    const rows = await prisma.saleItem.findMany({
      where: { invoiceId: 'inv-post', itemId: 'item-a' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.costPennies).toBe(1099);
  });

  it('identical SALES replay does not insert a second row', async () => {
    const payload = {
      eventType: 'SALES',
      date: '2024-02-22T17:29:39Z',
      invoiceId: 'inv-replay',
      items: [{ itemId: 'item-a', cost: 500, taxRate: 0.2 }],
    };

    await request(app.getHttpServer()).post('/transactions').send(payload);
    const second = await request(app.getHttpServer())
      .post('/transactions')
      .send(payload);

    expect(second.status).toBe(202);
    expect(second.text).toBe('');

    const count = await prisma.saleItem.count({
      where: { invoiceId: 'inv-replay', itemId: 'item-a' },
    });
    expect(count).toBe(1);
  });

  it('conflicting cost returns 409 and leaves stored cost unchanged', async () => {
    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-02-22T17:29:39Z',
        invoiceId: 'inv-conflict',
        items: [{ itemId: 'item-a', cost: 500, taxRate: 0.2 }],
      });

    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-02-22T17:29:39Z',
        invoiceId: 'inv-conflict',
        items: [{ itemId: 'item-a', cost: 600, taxRate: 0.2 }],
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      message: expect.stringContaining('PATCH /sale'),
      requestId: expect.any(String),
    });

    const row = await prisma.saleItem.findUnique({
      where: {
        invoiceId_itemId: { invoiceId: 'inv-conflict', itemId: 'item-a' },
      },
    });
    expect(row?.costPennies).toBe(500);
  });

  it('conflicting tax rate returns 409 and leaves stored tax rate unchanged', async () => {
    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-02-22T17:29:39Z',
        invoiceId: 'inv-rate-conflict',
        items: [{ itemId: 'item-a', cost: 500, taxRate: 0.2 }],
      });

    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-02-22T17:29:39Z',
        invoiceId: 'inv-rate-conflict',
        items: [{ itemId: 'item-a', cost: 500, taxRate: 0.15 }],
      });

    expect(response.status).toBe(409);

    const row = await prisma.saleItem.findUnique({
      where: {
        invoiceId_itemId: { invoiceId: 'inv-rate-conflict', itemId: 'item-a' },
      },
    });
    expect(row?.taxRate.toString()).toBe('0.2');
  });

  it('conflicting effective timestamp returns 409 and leaves stored timestamp unchanged', async () => {
    const originalDate = '2024-02-22T17:29:39Z';

    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: originalDate,
        invoiceId: 'inv-date-conflict',
        items: [{ itemId: 'item-a', cost: 500, taxRate: 0.2 }],
      });

    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-02-23T10:00:00Z',
        invoiceId: 'inv-date-conflict',
        items: [{ itemId: 'item-a', cost: 500, taxRate: 0.2 }],
      });

    expect(response.status).toBe(409);

    const row = await prisma.saleItem.findUnique({
      where: {
        invoiceId_itemId: { invoiceId: 'inv-date-conflict', itemId: 'item-a' },
      },
    });
    expect(row?.effectiveAt.toISOString()).toBe(
      new Date(originalDate).toISOString(),
    );
  });

  it('mixed payload with new item first then conflicting existing item inserts nothing', async () => {
    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-02-22T17:29:39Z',
        invoiceId: 'inv-mix-conflict',
        items: [{ itemId: 'existing', cost: 100, taxRate: 0.2 }],
      });

    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-02-22T17:29:39Z',
        invoiceId: 'inv-mix-conflict',
        items: [
          { itemId: 'brand-new', cost: 50, taxRate: 0.1 },
          { itemId: 'existing', cost: 999, taxRate: 0.2 },
        ],
      });

    expect(response.status).toBe(409);

    expect(
      await prisma.saleItem.count({ where: { invoiceId: 'inv-mix-conflict' } }),
    ).toBe(1);
    expect(
      await prisma.saleItem.findUnique({
        where: {
          invoiceId_itemId: {
            invoiceId: 'inv-mix-conflict',
            itemId: 'brand-new',
          },
        },
      }),
    ).toBeNull();
  });

  it('mixed new and identical existing item inserts only the new item', async () => {
    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-02-22T17:29:39Z',
        invoiceId: 'inv-mix-ok',
        items: [{ itemId: 'existing', cost: 100, taxRate: 0.2 }],
      });

    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-02-22T17:29:39Z',
        invoiceId: 'inv-mix-ok',
        items: [
          { itemId: 'existing', cost: 100, taxRate: 0.2 },
          { itemId: 'new-item', cost: 250, taxRate: 0.05 },
        ],
      });

    expect(response.status).toBe(202);
    expect(response.text).toBe('');

    expect(
      await prisma.saleItem.count({ where: { invoiceId: 'inv-mix-ok' } }),
    ).toBe(2);
  });

  it('PATCH /sale when no sale exists stores amendment and no sale item row', async () => {
    const response = await request(app.getHttpServer()).patch('/sale').send({
      date: '2024-03-01T10:00:00Z',
      invoiceId: 'inv-amend-only',
      itemId: 'item-y',
      cost: 400,
      taxRate: 0.1,
    });

    expect(response.status).toBe(202);
    expect(response.text).toBe('');

    expect(
      await prisma.saleAmendment.count({
        where: { invoiceId: 'inv-amend-only', itemId: 'item-y' },
      }),
    ).toBe(1);
    expect(
      await prisma.saleItem.findUnique({
        where: {
          invoiceId_itemId: { invoiceId: 'inv-amend-only', itemId: 'item-y' },
        },
      }),
    ).toBeNull();
  });

  it('PATCH /sale before any sale stores an amendment with empty 202 body', async () => {
    const response = await request(app.getHttpServer()).patch('/sale').send({
      date: '2024-03-01T10:00:00Z',
      invoiceId: 'inv-amend-first',
      itemId: 'item-x',
      cost: 798,
      taxRate: 0.15,
    });

    expect(response.status).toBe(202);
    expect(response.text).toBe('');

    const amendments = await prisma.saleAmendment.findMany({
      where: { invoiceId: 'inv-amend-first', itemId: 'item-x' },
    });
    expect(amendments).toHaveLength(1);
    expect(amendments[0]?.costPennies).toBe(798);
  });

  it('duplicate tax payments always insert separate rows', async () => {
    const payload = {
      eventType: 'TAX_PAYMENT',
      date: '2024-02-22T17:29:39Z',
      amount: 1000,
    };

    await request(app.getHttpServer()).post('/transactions').send(payload);
    await request(app.getHttpServer()).post('/transactions').send(payload);

    expect(await prisma.taxPayment.count()).toBe(2);
  });
});
