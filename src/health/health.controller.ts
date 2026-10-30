import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getLiveResponse, getReadyResponse } from './health.logic';
import { PrismaService } from '../database/prisma.service';

function getPrismaErrorCode(error: unknown): string | undefined {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    const code = (error as { code: string }).code;
    if (/^P\d{4}$/.test(code)) {
      return code;
    }
  }
  return undefined;
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  live(): { status: 'ok' } {
    return getLiveResponse();
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready(): Promise<{ status: 'ok' }> {
    try {
      return await getReadyResponse(() => this.prisma.ping());
    } catch (error) {
      const prismaCode = getPrismaErrorCode(error);
      if (prismaCode) {
        this.logger.error(`readiness check failed (code=${prismaCode})`);
      } else {
        this.logger.error('readiness check failed');
      }
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
}
