import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';

const CONNECT_TIMEOUT_MS = 5_000;

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

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(ENV) env: Env) {
    const adapter = new PrismaPg({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      const prismaCode = getPrismaErrorCode(error);
      if (prismaCode) {
        this.logger.warn(
          `database connect on startup failed (code=${prismaCode})`,
        );
      } else {
        this.logger.warn('database connect on startup failed');
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
