import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';
import type { Env } from '../../config/env.schema';
import { PINO_REDACT_PATHS } from './redact-paths';

type PinoHttpOptions = Options<
  IncomingMessage,
  ServerResponse<IncomingMessage>
>;

type RequestWithBody = IncomingMessage & { body?: unknown };

function extractDuration(thirdArg: unknown): number | undefined {
  if (typeof thirdArg === 'number' && Number.isFinite(thirdArg)) {
    return thirdArg;
  }
  if (thirdArg !== null && typeof thirdArg === 'object') {
    const responseTime = (thirdArg as { responseTime?: unknown }).responseTime;
    if (typeof responseTime === 'number' && Number.isFinite(responseTime)) {
      return responseTime;
    }
  }
  return undefined;
}

function extractInvoiceAndItemIds(req: IncomingMessage): {
  invoiceId?: string;
  itemId?: string | string[];
} {
  const body = (req as RequestWithBody).body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }

  const record = body as Record<string, unknown>;
  const fields: { invoiceId?: string; itemId?: string | string[] } = {};

  if (typeof record.invoiceId === 'string' && record.invoiceId.length > 0) {
    fields.invoiceId = record.invoiceId;
  }

  const itemIds: string[] = [];
  if (typeof record.itemId === 'string' && record.itemId.length > 0) {
    itemIds.push(record.itemId);
  }
  if (Array.isArray(record.items)) {
    for (const item of record.items) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const id = (item as Record<string, unknown>).itemId;
        if (typeof id === 'string' && id.length > 0) {
          itemIds.push(id);
        }
      }
    }
  }

  if (itemIds.length === 1) {
    fields.itemId = itemIds[0];
  } else if (itemIds.length > 1) {
    fields.itemId = itemIds;
  }

  return fields;
}

function buildRequestCompletionLog(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  thirdArg: unknown,
): Record<string, unknown> {
  const log: Record<string, unknown> = {
    requestId: req.id,
    method: req.method,
    path: req.url,
    status: res.statusCode,
  };

  const duration = extractDuration(thirdArg);
  if (duration !== undefined) {
    log.duration = duration;
  }

  return { ...log, ...extractInvoiceAndItemIds(req) };
}

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
      responseTime: unknown,
    ) => buildRequestCompletionLog(req, res, responseTime),
    customErrorObject: (
      req: IncomingMessage,
      res: ServerResponse<IncomingMessage>,
      _error: unknown,
      errorPayload?: unknown,
    ) => buildRequestCompletionLog(req, res, errorPayload),
  };
}
