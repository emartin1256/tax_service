import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildPinoHttpOptions } from './pino-http.config';
import { PINO_REDACT_PATHS } from './redact-paths';

describe('buildPinoHttpOptions', () => {
  const options = buildPinoHttpOptions({ LOG_LEVEL: 'info' });

  it('uses the shared redact path list', () => {
    expect(options.redact).toEqual({
      paths: [...PINO_REDACT_PATHS],
      censor: '[Redacted]',
    });
  });

  it('logs request id, method, path, status, and duration on success', () => {
    const req = {
      id: 'trace-req-1',
      method: 'POST',
      url: '/transactions',
    } as IncomingMessage;
    const res = { statusCode: 202 } as ServerResponse<IncomingMessage>;

    expect(options.customSuccessObject?.(req, res, 42)).toEqual({
      requestId: 'trace-req-1',
      method: 'POST',
      path: '/transactions',
      status: 202,
      duration: 42,
    });
  });

  it('extracts duration from pino-http responseTime object without leaking res', () => {
    const req = {
      id: 'trace-req-2',
      method: 'PATCH',
      url: '/transactions/sale',
      body: { cost: 100, taxRate: 0.2 },
    } as IncomingMessage & { body: unknown };
    const res = { statusCode: 200 } as ServerResponse<IncomingMessage>;
    const fakeRes = { statusCode: 200, body: { secret: true } };

    const result = options.customSuccessObject?.(req, res, {
      res: fakeRes,
      responseTime: 55,
    });

    expect(result).toEqual({
      requestId: 'trace-req-2',
      method: 'PATCH',
      path: '/transactions/sale',
      status: 200,
      duration: 55,
    });
    expect(JSON.stringify(result)).not.toMatch(/cost|taxRate|amount|"res"/);
  });

  it('includes invoiceId and itemId array from sales body without cost or taxRate', () => {
    const req = {
      id: 'sales-req',
      method: 'POST',
      url: '/transactions',
      body: {
        invoiceId: 'inv-1',
        items: [
          { itemId: 'A', cost: 1000, taxRate: 0.2 },
          { itemId: 'B', cost: 333, taxRate: 0.2 },
        ],
      },
    } as IncomingMessage & { body: unknown };
    const res = { statusCode: 202 } as ServerResponse<IncomingMessage>;

    const result = options.customSuccessObject?.(req, res, 10);

    expect(result).toEqual({
      requestId: 'sales-req',
      method: 'POST',
      path: '/transactions',
      status: 202,
      duration: 10,
      invoiceId: 'inv-1',
      itemId: ['A', 'B'],
    });
    expect(JSON.stringify(result)).not.toMatch(/cost|taxRate/);
  });

  it('includes invoiceId and single itemId from PATCH sale body', () => {
    const req = {
      id: 'patch-req',
      method: 'PATCH',
      url: '/transactions/sale',
      body: {
        invoiceId: 'inv-1',
        itemId: 'A',
        cost: 100,
        taxRate: 0.2,
      },
    } as IncomingMessage & { body: unknown };
    const res = { statusCode: 200 } as ServerResponse<IncomingMessage>;

    const result = options.customSuccessObject?.(req, res, 5);

    expect(result).toEqual({
      requestId: 'patch-req',
      method: 'PATCH',
      path: '/transactions/sale',
      status: 200,
      duration: 5,
      invoiceId: 'inv-1',
      itemId: 'A',
    });
    expect(JSON.stringify(result)).not.toMatch(/cost|taxRate/);
  });

  it('omits invoiceId and itemId for tax payment body', () => {
    const req = {
      id: 'pay-req',
      method: 'POST',
      url: '/transactions',
      body: { eventType: 'TAX_PAYMENT', amount: 100 },
    } as IncomingMessage & { body: unknown };
    const res = { statusCode: 202 } as ServerResponse<IncomingMessage>;

    const result = options.customSuccessObject?.(req, res, 3);

    expect(result).toEqual({
      requestId: 'pay-req',
      method: 'POST',
      path: '/transactions',
      status: 202,
      duration: 3,
    });
    expect(JSON.stringify(result)).not.toMatch(/amount|invoiceId|itemId/);
  });

  it('customErrorObject returns numeric duration without response object', () => {
    const req = {
      id: 'err-req',
      method: 'POST',
      url: '/transactions',
      body: { cost: 100, taxRate: 0.2, amount: 50 },
    } as IncomingMessage & { body: unknown };
    const res = { statusCode: 500 } as ServerResponse<IncomingMessage>;
    const fakeRes = { statusCode: 500 };
    const err = new Error('failed');

    const result = options.customErrorObject?.(req, res, err, {
      res: fakeRes,
      err,
      responseTime: 80,
    });

    expect(result).toEqual({
      requestId: 'err-req',
      method: 'POST',
      path: '/transactions',
      status: 500,
      duration: 80,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /"res"|"err"|cost|taxRate|amount/,
    );
  });

  it('does not serialize request bodies', () => {
    const req = {
      id: '1',
      method: 'POST',
      url: '/transactions',
      body: { cost: 1099, taxRate: 0.2 },
    } as IncomingMessage & { body: unknown };

    expect(options.serializers?.req?.(req)).toEqual({
      id: '1',
      method: 'POST',
      url: '/transactions',
    });
  });
});
