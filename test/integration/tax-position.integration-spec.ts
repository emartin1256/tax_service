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

async function createApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule.register(integrationEnv)],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: false,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();

  const prisma = app.get(PrismaService);
  await prisma.$connect();
  return { app, prisma };
}

describe('Tax position (integration)', () => {
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

    ({ app, prisma } = await createApp());
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

  async function getTaxPosition(date: string): Promise<request.Response> {
    return request(app.getHttpServer()).get(
      `/tax-position?date=${encodeURIComponent(date)}`,
    );
  }

  async function seedMainFixture(): Promise<void> {
    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-01-01T00:00:00Z',
        invoiceId: 'inv-fixture',
        items: [
          { itemId: 'item-a', cost: 1000, taxRate: 0.2 },
          { itemId: 'item-b', cost: 333, taxRate: 0.2 },
        ],
      })
      .expect(202);

    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'TAX_PAYMENT',
        date: '2024-01-15T00:00:00Z',
        amount: 100,
      })
      .expect(202);

    await request(app.getHttpServer())
      .patch('/sale')
      .send({
        date: '2024-02-01T00:00:00Z',
        invoiceId: 'inv-fixture',
        itemId: 'item-a',
        cost: 100,
        taxRate: 0.2,
      })
      .expect(202);
  }

  it('returns 2.67 at sale instant and before payment', async () => {
    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-01-01T00:00:00Z',
        invoiceId: 'inv-fixture',
        items: [
          { itemId: 'item-a', cost: 1000, taxRate: 0.2 },
          { itemId: 'item-b', cost: 333, taxRate: 0.2 },
        ],
      })
      .expect(202);

    const atSale = await getTaxPosition('2024-01-01T00:00:00Z');
    expect(atSale.status).toBe(200);
    expect(atSale.body).toEqual({
      date: '2024-01-01T00:00:00Z',
      taxPosition: 2.67,
    });

    const beforePayment = await getTaxPosition('2024-01-10T00:00:00Z');
    expect(beforePayment.body.taxPosition).toBe(2.67);
  });

  it('returns 1.67 after tax payment and through amendment effective date', async () => {
    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-01-01T00:00:00Z',
        invoiceId: 'inv-fixture',
        items: [
          { itemId: 'item-a', cost: 1000, taxRate: 0.2 },
          { itemId: 'item-b', cost: 333, taxRate: 0.2 },
        ],
      })
      .expect(202);

    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'TAX_PAYMENT',
        date: '2024-01-15T00:00:00Z',
        amount: 100,
      })
      .expect(202);

    const atPayment = await getTaxPosition('2024-01-15T00:00:00Z');
    expect(atPayment.body.taxPosition).toBe(1.67);

    const later = await getTaxPosition('2024-01-20T00:00:00Z');
    expect(later.body.taxPosition).toBe(1.67);
  });

  it('returns -0.13 after amendment reduces item A tax', async () => {
    await seedMainFixture();

    const response = await getTaxPosition('2024-02-01T00:00:00Z');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      date: '2024-02-01T00:00:00Z',
      taxPosition: -0.13,
    });
  });

  it('includes a sale exactly at its timestamp and excludes one second before', async () => {
    const saleInstant = '2024-03-15T12:00:00Z';

    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: saleInstant,
        invoiceId: 'inv-boundary',
        items: [{ itemId: 'item-only', cost: 100, taxRate: 0.2 }],
      })
      .expect(202);

    const before = await getTaxPosition('2024-03-15T11:59:59Z');
    expect(before.body.taxPosition).toBe(0);

    const at = await getTaxPosition(saleInstant);
    expect(at.body.taxPosition).toBe(0.2);
  });

  it('excludes a future-dated sale from an earlier query', async () => {
    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-06-01T00:00:00Z',
        invoiceId: 'inv-future',
        items: [{ itemId: 'item-f', cost: 500, taxRate: 0.2 }],
      })
      .expect(202);

    const earlier = await getTaxPosition('2024-05-01T00:00:00Z');
    expect(earlier.body.taxPosition).toBe(0);
  });

  it('ignores pre-sale amendments until the sale exists at query time', async () => {
    await request(app.getHttpServer())
      .patch('/sale')
      .send({
        date: '2023-12-01T00:00:00Z',
        invoiceId: 'inv-pre-amend',
        itemId: 'item-z',
        cost: 100,
        taxRate: 0.2,
      })
      .expect(202);

    const beforeSale = await getTaxPosition('2023-12-15T00:00:00Z');
    expect(beforeSale.body.taxPosition).toBe(0);

    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-01-01T00:00:00Z',
        invoiceId: 'inv-pre-amend',
        items: [{ itemId: 'item-z', cost: 1000, taxRate: 0.2 }],
      })
      .expect(202);

    const atSale = await getTaxPosition('2024-01-01T00:00:00Z');
    expect(atSale.body.taxPosition).toBe(0.2);
  });

  it('uses the later-ingested amendment when effective timestamps are equal', async () => {
    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'SALES',
        date: '2024-04-01T00:00:00Z',
        invoiceId: 'inv-tie',
        items: [{ itemId: 'item-t', cost: 1000, taxRate: 0.2 }],
      })
      .expect(202);

    const amendDate = '2024-04-10T00:00:00Z';

    await request(app.getHttpServer())
      .patch('/sale')
      .send({
        date: amendDate,
        invoiceId: 'inv-tie',
        itemId: 'item-t',
        cost: 500,
        taxRate: 0.2,
      })
      .expect(202);

    await request(app.getHttpServer())
      .patch('/sale')
      .send({
        date: amendDate,
        invoiceId: 'inv-tie',
        itemId: 'item-t',
        cost: 200,
        taxRate: 0.2,
      })
      .expect(202);

    const response = await getTaxPosition('2024-04-10T00:00:00Z');
    expect(response.body.taxPosition).toBe(0.4);
  });

  it('returns the same tax position after restarting the application', async () => {
    await seedMainFixture();

    const queryDate = '2024-02-01T00:00:00Z';
    const beforeRestart = await getTaxPosition(queryDate);
    expect(beforeRestart.body.taxPosition).toBe(-0.13);

    await app.close();

    ({ app, prisma } = await createApp());

    const afterRestart = await getTaxPosition(queryDate);
    expect(afterRestart.body.taxPosition).toBe(-0.13);
  });
});
