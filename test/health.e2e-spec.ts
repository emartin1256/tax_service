import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import type { Env } from '../src/config/env.schema';

const testEnv: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://tax:tax@localhost:5432/tax_service',
  DIRECT_DATABASE_URL: 'postgresql://tax:tax@localhost:5432/tax_service',
  LOG_LEVEL: 'silent',
  OTEL_ENABLED: false,
};

describe('Health (e2e)', () => {
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
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live returns 200', () => {
    return request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('GET /health/ready returns 200 or 503 without requiring a database in CI', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');
    expect([200, 503]).toContain(response.status);
    if (response.status === 200) {
      expect(response.body).toEqual({ status: 'ok' });
    }
  });
});
