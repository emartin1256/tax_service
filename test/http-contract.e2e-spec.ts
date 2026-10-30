import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import type { Env } from '../src/config/env.schema';
import { setupSwagger } from '../src/swagger/setup-swagger';
import { TaxPositionService } from '../src/tax-position/tax-position.service';
import { TransactionsService } from '../src/transactions/transactions.service';

const testEnv: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/nope',
  DIRECT_DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/nope',
  LOG_LEVEL: 'silent',
  OTEL_ENABLED: false,
};

const validSalesPayload = {
  eventType: 'SALES',
  date: '2024-02-22T17:29:39Z',
  invoiceId: 'inv-1',
  items: [{ itemId: 'item-1', cost: 1099, taxRate: 0.2 }],
};

const validTaxPaymentPayload = {
  eventType: 'TAX_PAYMENT',
  date: '2024-02-22T17:29:39Z',
  amount: 74901,
};

const validAmendSalePayload = {
  date: '2024-02-22T17:29:39Z',
  invoiceId: 'inv-1',
  itemId: 'item-1',
  cost: 1099,
  taxRate: 0.2,
};

describe('HTTP contract (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.register(testEnv)],
    })
      .overrideProvider(TransactionsService)
      .useValue({
        ingestTransaction: async () => undefined,
        amendSale: async () => undefined,
      })
      .overrideProvider(TaxPositionService)
      .useValue({
        getTaxPosition: async () => ({
          date: '2024-02-22T17:29:39Z',
          taxPosition: 0.49,
        }),
      })
      .compile();

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /transactions accepts valid SALES with 202 and empty body', async () => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send(validSalesPayload);
    expect(response.status).toBe(202);
    expect(response.text).toBe('');
  });

  it('POST /transactions accepts valid TAX_PAYMENT with 202 and empty body', async () => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send(validTaxPaymentPayload);
    expect(response.status).toBe(202);
    expect(response.text).toBe('');
  });

  it('PATCH /sale accepts valid body with 202 and empty body', async () => {
    const response = await request(app.getHttpServer())
      .patch('/sale')
      .send(validAmendSalePayload);
    expect(response.status).toBe(202);
    expect(response.text).toBe('');
  });

  it('GET /tax-position returns tax position JSON for valid date', async () => {
    const response = await request(app.getHttpServer()).get(
      '/tax-position?date=2024-02-22T17:29:39Z',
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      date: '2024-02-22T17:29:39Z',
      taxPosition: 0.49,
    });
  });
});

describe('Swagger (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.register(testEnv)],
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
    setupSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /docs serves OpenAPI UI', () => {
    return request(app.getHttpServer()).get('/docs').expect(200);
  });

  it('GET /docs-json serves OpenAPI document', () => {
    return request(app.getHttpServer()).get('/docs-json').expect(200);
  });
});
