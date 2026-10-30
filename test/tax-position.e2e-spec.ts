import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

describe('Tax position validation (e2e)', () => {
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

  it('returns 400 when date query parameter is missing', async () => {
    const response = await request(app.getHttpServer()).get('/tax-position');
    expectBadRequest(response);
  });

  it('returns 400 when date has no timezone', async () => {
    const response = await request(app.getHttpServer()).get(
      '/tax-position?date=2024-02-22T17:29:39',
    );
    expectBadRequest(response);
  });
});

describe('ApiExceptionFilter (e2e)', () => {
  it('does not expose postgres URL from Prisma error messages', () => {
    const filter = new ApiExceptionFilter();
    const connectionString =
      'postgresql://secret:secret@db.example.com:5432/tax_service';
    const exception = new Prisma.PrismaClientInitializationError(
      `Can't reach database server at ${connectionString}`,
      '7.10.1',
    );

    let statusCode = 0;
    let body: Record<string, unknown> | undefined;
    const response = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: Record<string, unknown>) {
        body = payload;
      },
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          headers: {},
        }),
      }),
    };

    filter.catch(exception, host as never);

    expect(statusCode).toBe(500);
    expect(body).toBeDefined();
    expect(body?.message).not.toContain('postgresql://');
    expect(body?.message).not.toContain(connectionString);
    expect(body).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      requestId: expect.any(String),
    });
  });
});
