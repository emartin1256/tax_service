import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import type { Env } from '../src/config/env.schema';

const testEnv: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://tax:tax@localhost:5432/tax_service',
  DIRECT_DATABASE_URL: 'postgresql://tax:tax@localhost:5432/tax_service',
  LOG_LEVEL: 'silent',
  OTEL_ENABLED: false,
};

const validSalesPayload = {
  eventType: 'SALES',
  date: '2024-02-22T17:29:39Z',
  invoiceId: 'inv-1',
  items: [{ itemId: 'item-1', cost: 1099, taxRate: 0.2 }],
};

describe('Transactions validation (e2e)', () => {
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
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function expectBadRequest(response: request.Response): void {
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: expect.any(String),
      requestId: expect.any(String),
    });
  }

  it('rejects SALES payload missing date', async () => {
    const { date: _date, ...payload } = validSalesPayload;
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send(payload);
    expectBadRequest(response);
  });

  it('rejects unknown eventType', async () => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({ ...validSalesPayload, eventType: 'REFUND' });
    expectBadRequest(response);
  });

  it('rejects SALES payload with empty items array', async () => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({ ...validSalesPayload, items: [] });
    expectBadRequest(response);
  });

  it('rejects duplicate itemId within one SALES payload', async () => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        ...validSalesPayload,
        items: [
          { itemId: 'dup', cost: 100, taxRate: 0.2 },
          { itemId: 'dup', cost: 200, taxRate: 0.2 },
        ],
      });
    expectBadRequest(response);
  });

  it('rejects non-integer cost', async () => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        ...validSalesPayload,
        items: [{ itemId: 'item-1', cost: 10.5, taxRate: 0.2 }],
      });
    expectBadRequest(response);
  });

  it('rejects negative taxRate', async () => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        ...validSalesPayload,
        items: [{ itemId: 'item-1', cost: 100, taxRate: -0.1 }],
      });
    expectBadRequest(response);
  });

  it('rejects numeric string amount on TAX_PAYMENT', async () => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({
        eventType: 'TAX_PAYMENT',
        date: '2024-02-22T17:29:39Z',
        amount: '74901',
      });
    expectBadRequest(response);
  });

  it('rejects unknown top-level property on POST /transactions', async () => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .send({ ...validSalesPayload, unexpected: true });
    expectBadRequest(response);
  });

  it('rejects PATCH /sale with unknown property', async () => {
    const response = await request(app.getHttpServer()).patch('/sale').send({
      date: '2024-02-22T17:29:39Z',
      invoiceId: 'inv-1',
      itemId: 'item-1',
      cost: 100,
      taxRate: 0.2,
      extra: true,
    });
    expectBadRequest(response);
  });
});
