import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

type RequestWithId = Request & { id?: string };

const POSTGRES_URL_PATTERN = /postgres(ql)?:\/\//i;

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();

    const requestId = this.resolveRequestId(request);

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message = 'An unexpected error occurred';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      error = this.httpErrorPhrase(statusCode);
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
      ) {
        const rawMessage = (exceptionResponse as { message: unknown }).message;
        message = Array.isArray(rawMessage)
          ? rawMessage.join(', ')
          : String(rawMessage);
      }
    } else if (this.isPrismaClientError(exception)) {
      this.logPrismaError(exception);
      message = this.safeClientMessage(exception);
    } else if (exception instanceof Error) {
      message = this.safeClientMessage(exception);
    }

    response.status(statusCode).json({
      statusCode,
      error,
      message,
      requestId,
    });
  }

  private isPrismaClientError(
    error: unknown,
  ): error is Error & { code?: string } {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientRustPanicError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientValidationError
    );
  }

  private logPrismaError(error: Error & { code?: string }): void {
    const code =
      'code' in error && typeof error.code === 'string'
        ? error.code
        : 'unknown';
    this.logger.error(`Prisma error code=${code}`);
  }

  private safeClientMessage(error: Error): string {
    if (POSTGRES_URL_PATTERN.test(error.message)) {
      return 'An unexpected error occurred';
    }
    return 'An unexpected error occurred';
  }

  private httpErrorPhrase(statusCode: number): string {
    switch (statusCode) {
      case HttpStatus.BAD_REQUEST:
        return 'Bad Request';
      case HttpStatus.CONFLICT:
        return 'Conflict';
      case HttpStatus.NOT_FOUND:
        return 'Not Found';
      default:
        return HttpStatus[statusCode] ?? 'Internal Server Error';
    }
  }

  private resolveRequestId(request: RequestWithId): string {
    const header = request.headers['x-request-id'];
    if (typeof header === 'string' && header.length > 0) {
      return header;
    }
    if (Array.isArray(header) && header[0]) {
      return header[0];
    }
    if (request.id) {
      return request.id;
    }
    return 'unknown';
  }
}
