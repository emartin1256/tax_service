import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';
import type { Env } from '../../config/env.schema';
import { PINO_REDACT_PATHS } from './redact-paths';

type PinoHttpOptions = Options<
  IncomingMessage,
  ServerResponse<IncomingMessage>
>;

export function buildPinoHttpOptions(
  env: Pick<Env, 'LOG_LEVEL'>,
): PinoHttpOptions {
  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: [...PINO_REDACT_PATHS],
      censor: '[Redacted]',
    },
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
    genReqId: (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
      const existing = req.headers['x-request-id'];
      const requestId =
        typeof existing === 'string' && existing.length > 0
          ? existing
          : randomUUID();
      res.setHeader('x-request-id', requestId);
      return requestId;
    },
    customProps: (req: IncomingMessage) => ({
      requestId:
        typeof req.headers['x-request-id'] === 'string'
          ? req.headers['x-request-id']
          : undefined,
    }),
    customSuccessObject: (
      req: IncomingMessage,
      res: ServerResponse<IncomingMessage>,
      responseTime: number,
    ) => ({
      requestId: req.id,
      method: req.method,
      path: req.url,
      status: res.statusCode,
      duration: responseTime,
    }),
  };
}
