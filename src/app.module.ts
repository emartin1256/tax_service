import { DynamicModule, Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { AppLoggerModule } from './common/logging/logger.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { TaxPositionModule } from './tax-position/tax-position.module';
import { TransactionsModule } from './transactions/transactions.module';
import type { Env } from './config/env.schema';
import { TracingShutdownHook } from './observability/tracing-shutdown.hook';

@Module({})
export class AppModule {
  static register(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(env),
        AppLoggerModule,
        DatabaseModule,
        HealthModule,
        TransactionsModule,
        TaxPositionModule,
      ],
      providers: [TracingShutdownHook],
    };
  }
}
