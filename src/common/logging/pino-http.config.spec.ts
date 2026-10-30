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
